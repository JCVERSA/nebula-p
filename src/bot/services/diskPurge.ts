/**
 * Purge disque owner (8.88) — le bouton d'urgence `.purge` / `.p`.
 *
 * Contexte : le nettoyage existant est automatique mais DIFFÉRÉ (TTL
 * glissant 30 min, vie max 2 h, orphelins 3 h, seuils manage.sh clean).
 * Décision owner 2026-09-27 : une commande owner-only qui libère TOUT
 * l'espace nettoyable immédiatement — fichiers livrés (liens morts
 * acceptés par décision owner), débris de fabrication (cat_catch_*,
 * batch_zip_*), fichiers non suivis du store.
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
 * réel) ; l'exécuteur ne touche QUE des chemins en liste blanche
 * (dossier du store livré + préfixes cat_catch_/batch_zip_ du tmpdir).
 * Jamais bot.log (LogGuard), jamais le dépôt applicatif, jamais les claims.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { listDiskClaims } from "../diskClaims.js";
import { getTempDownloadDir, listTempRecords, purgeTempRecords, type TempDownloadRecord } from "../tempDownloadManager.js";

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

export interface PlanStagingEntry {
  /** Chemin complet du dossier de fabrication. */
  name: string;
  mtimeMs: number;
}

export interface PlanClaim {
  jobId: string;
  createdAt: number;
}

export interface PurgePlan {
  tokensToDelete: string[];
  untrackedFilesToDelete: string[];
  stagingDirsToDelete: string[];
  sparedDelivered: number;
  sparedStaging: number;
  activeBatches: number;
}

/**
 * Planificateur PUR : décide quoi supprimer/épargner sans toucher au
 * disque. Toutes les règles de protection vivent ici (voir docblock).
 */
export function planDiskPurge(input: {
  delivered: PlanDeliveredEntry[];
  staging: PlanStagingEntry[];
  liveClaims: PlanClaim[];
  now?: number;
}): PurgePlan {
  const now = input.now ?? Date.now();
  const claims = input.liveClaims;
  const liveJobIds = new Set(claims.map(c => c.jobId));
  const oldestClaimStart = claims.length ? Math.min(...claims.map(c => c.createdAt)) : null;

  const tokensToDelete: string[] = [];
  const untrackedFilesToDelete: string[] = [];
  let sparedDelivered = 0;

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

  const stagingDirsToDelete: string[] = [];
  let sparedStaging = 0;
  for (const s of input.staging) {
    const protectedByWindow = oldestClaimStart !== null && s.mtimeMs > oldestClaimStart;
    const protectedByGrace = now - s.mtimeMs < PURGE_GRACE_MS;
    if (protectedByWindow || protectedByGrace) {
      sparedStaging++;
      continue;
    }
    stagingDirsToDelete.push(s.name);
  }

  return {
    tokensToDelete,
    untrackedFilesToDelete,
    stagingDirsToDelete,
    sparedDelivered,
    sparedStaging,
    activeBatches: claims.length
  };
}

export interface PurgeReport {
  deletedFiles: number;
  deletedDirs: number;
  freedBytes: number;
  sparedDelivered: number;
  sparedStaging: number;
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

/** Dossiers de fabrication cat_catch_* / batch_zip_* à la racine du tmpdir. */
function scanStaging(root: string): PlanStagingEntry[] {
  const out: PlanStagingEntry[] = [];
  try {
    for (const file of fs.readdirSync(root)) {
      if (!file.startsWith("cat_catch_") && !file.startsWith("batch_zip_")) continue;
      const full = path.join(root, file);
      try {
        out.push({ name: full, mtimeMs: fs.statSync(full).mtimeMs });
      } catch {}
    }
  } catch {}
  return out;
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
    staging: scanStaging(stagingRoot),
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

  // 3. Débris de fabrication
  for (const d of plan.stagingDirsToDelete) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
      deletedDirs++;
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
    sparedStaging: plan.sparedStaging,
    activeBatches: plan.activeBatches,
    freeBytesBefore,
    freeBytesAfter,
    errors
  };
}
