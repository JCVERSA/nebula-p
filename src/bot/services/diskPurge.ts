/**
 * Purge disque owner (8.88) — le bouton d'urgence `.purge` / `.p`.
 *
 * Contexte : le nettoyage existant est automatique mais DIFFÉRÉ (TTL
 * glissant 30 min, vie max 2 h, orphelins 3 h, seuils manage.sh clean).
 * Décision owner 2026-09-27 : une commande owner-only qui libère TOUT
 * l'espace nettoyable immédiatement — fichiers livrés (liens morts
 * acceptés par décision owner), débris de fabrication, fichiers non suivis
 * du store.
 *
 * 8.90 (retour terrain « .p ne libère jamais ») : les vrais fichiers
 * d'animes vivent aussi À LA RACINE du tmpdir (batch_*.mp4, nom d'anime
 * brut pour l'épisode single, comp_*.mp4, zips finaux, nebula_ytdlp_*) —
 * interrompus, ils restaient à jamais. Les patterns et la planification
 * des débris racine vivent dans services/tmpDebris.ts (source de vérité
 * partagée avec le nettoyage périodique et la purge au boot).
 *
 * Règle de protection (décision owner : « épargner le batch en cours ») :
 * un batch actif = un claim disque VIVANT (listDiskClaims, auto-nettoyé :
 * PID morts et réclamations périmées éliminées). Sont épargnés :
 *   1. les records dont le jobId appartient à un claim vivant ;
 *   2. les fichiers/dossiers créés PENDANT la fenêtre d'un claim vivant
 *      (mtime > début du claim le plus ancien) — règle conservatrice ;
 *   3. les fichiers sans claim créés il y a moins de PURGE_GRACE_MS
 *      (5 min) : grâce pour un envoi single en cours, y compris dans un
 *      AUTRE moteur (multi-bots : les records ne sont pas partagés entre
 *      moteurs, mais le dossier l'est).
 *
 * Sécurité : le planificateur est une FONCTION PURE (testable sans disque
 * réel) ; l'exécuteur ne touche QUE des chemins en liste blanche (dossier
 * du store livré + débris reconnus de la racine tmpdir, cf. tmpDebris.ts).
 * Jamais bot.log (LogGuard), jamais le dépôt applicatif, jamais les claims.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { listDiskClaims } from "../diskClaims.js";
import { getTempDownloadDir, listTempRecords, purgeTempRecords, type TempDownloadRecord } from "../tempDownloadManager.js";
import {
  planTmpRootDebris,
  scanTmpRoot,
  type LiveClaimRef,
  type TmpRootEntry
} from "./tmpDebris.js";

/** Grâce : fichiers sans claim vivant créés il y a moins de 5 minutes. */
export const PURGE_GRACE_MS = 5 * 60 * 1000;

export interface PlanDeliveredEntry {
  /** Token du record de CE moteur, ou null pour un fichier non suivi (autre moteur / orphelin). */
  token: string | null;
  /** Chemin complet du fichier. */
  name: string;
  /** Date de création/enregistrement (ms). */
  mtimeMs: number;
  sizeBytes: number;
  /** Job détenteur (batch novabox), si connu. */
  jobId?: string;
}

/** Référence à un claim vivant (shape partagée avec tmpDebris). */
export type PlanClaim = LiveClaimRef;

export interface PurgePlan {
  tokensToDelete: string[];
  untrackedFilesToDelete: string[];
  /** Débris racine à supprimer (préfixes connus + fichiers média) — 8.90. */
  rootDebrisToDelete: TmpRootEntry[];
  sparedDelivered: number;
  sparedRootDebris: number;
  activeBatches: number;
}

/**
 * Planificateur PUR : décide quoi supprimer/épargner sans toucher au
 * disque. Toutes les règles de protection vivent ici (voir docblock).
 */
export function planDiskPurge(input: {
  delivered: PlanDeliveredEntry[];
  rootDebris: TmpRootEntry[];
  liveClaims: PlanClaim[];
  now?: number;
}): PurgePlan {
  const now = input.now ?? Date.now();
  const claims = input.liveClaims;
  const liveJobIds = new Set(claims.map(c => c.jobId));

  const tokensToDelete: string[] = [];
  const untrackedFilesToDelete: string[] = [];
  let sparedDelivered = 0;
  const oldestClaimStart = claims.length ? Math.min(...claims.map(c => c.createdAt)) : null;

  for (const entry of input.delivered) {
    const protectedByClaim = !!entry.jobId && liveJobIds.has(entry.jobId);
    const protectedByWindow = oldestClaimStart !== null && entry.mtimeMs > oldestClaimStart;
    const protectedByGrace = now - entry.mtimeMs < PURGE_GRACE_MS;
    if (protectedByClaim || protectedByWindow || protectedByGrace) {
      sparedDelivered++;
      continue;
    }
    if (entry.token) tokensToDelete.push(entry.token);
    else untrackedFilesToDelete.push(entry.name);
  }

  // 8.90 : débris racine — mêmes patterns que les autres nettoyeurs,
  // politique d'âge = grâce 5 min (propriétaire à la manœuvre).
  const debrisPlan = planTmpRootDebris(input.rootDebris, {
    liveClaims: claims,
    now,
    minAgeMs: PURGE_GRACE_MS
  });

  return {
    tokensToDelete,
    untrackedFilesToDelete,
    rootDebrisToDelete: debrisPlan.toDelete,
    sparedDelivered,
    sparedRootDebris: debrisPlan.spared,
    activeBatches: claims.length
  };
}

export interface PurgeReport {
  deletedFiles: number;
  deletedDirs: number;
  freedBytes: number;
  sparedDelivered: number;
  sparedRootDebris: number;
  activeBatches: number;
  freeBytesBefore: number | null;
  freeBytesAfter: number | null;
  errors: number;
}

function freeBytesOf(dir: string): number | null {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** Records vivants de CE moteur + fichiers non suivis du dossier (autres moteurs, orphelins). */
function scanDelivered(tempDir: string, records: TempDownloadRecord[]): PlanDeliveredEntry[] {
  const trackedPaths = new Set(records.map(r => r.filePath));
  const entries: PlanDeliveredEntry[] = records.map(r => ({
    token: r.token,
    name: r.filePath,
    mtimeMs: r.createdAt,
    sizeBytes: r.sizeBytes,
    jobId: r.jobId
  }));
  try {
    for (const file of fs.readdirSync(tempDir)) {
      const full = path.join(tempDir, file);
      if (trackedPaths.has(full)) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        entries.push({ token: null, name: full, mtimeMs: st.mtimeMs, sizeBytes: st.size });
      } catch {}
    }
  } catch {}
  return entries;
}

/**
 * Exécute la purge et retourne le bilan. Les chemins sont injectables pour
 * les tests (défauts = durs réels du moteur) ; les claims vivants aussi
 * (défaut = listDiskClaims(), auto-nettoyé des PID morts).
 */
export async function executeDiskPurge(
  opts: { tempDir?: string; stagingRoot?: string; liveClaims?: PlanClaim[] } = {}
): Promise<PurgeReport> {
  const tempDir = opts.tempDir ?? getTempDownloadDir();
  const stagingRoot = opts.stagingRoot ?? os.tmpdir();
  const liveClaims: PlanClaim[] =
    opts.liveClaims ?? listDiskClaims().map(c => ({ jobId: c.jobId, createdAt: c.createdAt }));

  const freeBytesBefore = freeBytesOf(stagingRoot);
  const plan = planDiskPurge({
    delivered: scanDelivered(tempDir, listTempRecords()),
    rootDebris: scanTmpRoot(stagingRoot),
    liveClaims
  });

  let freedBytes = 0;
  let deletedFiles = 0;
  let deletedDirs = 0;
  let errors = 0;

  // 1. Records suivis de CE moteur (fichier + index, via l'API du manager)
  const rec = purgeTempRecords(plan.tokensToDelete);
  freedBytes += rec.deletedBytes;
  deletedFiles += rec.deletedCount;
  errors += rec.failedCount;

  // 2. Fichiers non suivis du store livré
  for (const f of plan.untrackedFilesToDelete) {
    try {
      const st = fs.statSync(f);
      fs.rmSync(f, { force: true });
      freedBytes += st.size;
      deletedFiles++;
    } catch {
      errors++;
    }
  }

  // 3. Débris racine (fichiers ET dossiers — 8.90)
  for (const e of plan.rootDebrisToDelete) {
    try {
      fs.rmSync(e.fullPath, { recursive: true, force: true });
      if (e.isDir) deletedDirs++;
      else {
        deletedFiles++;
        freedBytes += e.sizeBytes;
      }
    } catch {
      errors++;
    }
  }

  const freeBytesAfter = freeBytesOf(stagingRoot);
  return {
    deletedFiles,
    deletedDirs,
    freedBytes,
    sparedDelivered: plan.sparedDelivered,
    sparedRootDebris: plan.sparedRootDebris,
    activeBatches: plan.activeBatches,
    freeBytesBefore,
    freeBytesAfter,
    errors
  };
}
