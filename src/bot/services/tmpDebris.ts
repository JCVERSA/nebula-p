/**
 * Débris animés à la racine du tmpdir (8.90) — patterns et planification.
 *
 * Retour terrain 2026-10-04 : `.purge` ne libérait rien parce que les vrais
 * fichiers d'animes vivent aussi À LA RACINE du tmpdir, pas seulement dans
 * le store livré (nebula_temp_downloads) : épisodes de batch
 * (`batch_<ts>_<i>_Anime….mp4`), épisode single (nom d'anime brut),
 * compression (`comp_….mp4`), zips finaux, restes yt-dlp (`nebula_ytdlp_`).
 * Interruption (update en plein batch, crash) → ces fichiers restaient à
 * jamais : aucun nettoyage ne les couvrait.
 *
 * Ce module centralise la connaissance des patterns pour les TROIS
 * nettoyeurs (une seule source de vérité) :
 *   - `.purge` owner (services/diskPurge.ts)      → minAge 5 min (grâce)
 *   - nettoyage périodique (tempDownloadManager)   → minAge 3 h (prudent)
 *   - purge au boot (tempDownloadManager)          → minAge 0 (process mort
 *     = fichiers inatteignables ; cf. audit 8.16)
 *
 * Protection commune : la FENÊTRE des claims vivants — tout débris créé
 * APRÈS le début d'un batch actif (claim disque vivant, PID vérifié par
 * diskClaims) est épargné (règle conservatrice, décision owner 8.88).
 *
 * Liste blanche inversée : ne sont JAMAIS touchés les entrées non
 * reconnaissables (fichiers non-média, dossiers inconnus) et les dossiers
 * protégés (le store livré, les claims). Jamais bot.log (hors tmpdir),
 * jamais le dépôt applicatif.
 */

import fs from "fs";
import path from "path";

/** Dossiers de la racine tmpdir jamais touchés par les nettoyeurs. */
export const PROTECTED_ROOT_NAMES = new Set(["nebula_temp_downloads", "nebula-disk-claims"]);

/**
 * Préfixes des débris du bot à la racine du tmpdir :
 * - cat_catch_ / batch_zip_ : staging HLS et zippage (couverts depuis 8.16)
 * - batch_ : épisodes d'un batch multi-épisodes (novabox)
 * - comp_ : compression temporaire pour envoi direct WhatsApp
 * - batch_sim_ : zips du simulateur (batchDownloadManager)
 * - nebula_ytdlp_ : répertoires de travail yt-dlp (.ytm/.ytv, 8.86)
 * - nebula_in_ / nebula_out_ : conversion AAC de .ytm
 */
export const TMP_DEBRIS_PREFIXES = [
  "cat_catch_",
  "batch_zip_",
  "batch_",
  "comp_",
  "batch_sim_",
  "nebula_ytdlp_",
  "nebula_in_",
  "nebula_out_"
] as const;

/**
 * Filet de sécurité : sur ce conteneur dédié au bot, un fichier MÉDIA à la
 * racine du tmpdir est forcément un débris du bot (épisode single = nom
 * d'anime brut, sans préfixe). Extensions vidéo/audio/archive uniquement.
 */
export const DEBRIS_FILE_EXTENSIONS = [
  ".mp4", ".mkv", ".webm", ".avi", ".mov",
  ".m4a", ".mp3", ".aac", ".ogg", ".opus",
  ".ts", ".zip"
];

/** Référence minimale à un claim vivant (cf. diskClaims.DiskClaim). */
export interface LiveClaimRef {
  jobId: string;
  createdAt: number;
}

export interface TmpRootEntry {
  /** Nom de l'entrée à la racine du tmpdir. */
  name: string;
  /** Chemin complet. */
  fullPath: string;
  mtimeMs: number;
  isDir: boolean;
  /** Taille en octets (fichiers ; ~ taille d'inode pour les dossiers). */
  sizeBytes: number;
}

/** L'entrée (fichier ou dossier) est-elle un débris candidat du bot ? */
export function isTmpRootDebrisCandidate(name: string, isDir: boolean): boolean {
  if (PROTECTED_ROOT_NAMES.has(name)) return false;
  for (const p of TMP_DEBRIS_PREFIXES) {
    if (name.startsWith(p)) return true;
  }
  if (!isDir) {
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      return DEBRIS_FILE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
    }
  }
  return false;
}

/** Scanne la racine et retourne les entrées candidates (stat réels, jamais throw). */
export function scanTmpRoot(root: string): TmpRootEntry[] {
  const out: TmpRootEntry[] = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (PROTECTED_ROOT_NAMES.has(name)) continue;
      const fullPath = path.join(root, name);
      try {
        const st = fs.statSync(fullPath);
        if (!isTmpRootDebrisCandidate(name, st.isDirectory())) continue;
        out.push({ name, fullPath, mtimeMs: st.mtimeMs, isDir: st.isDirectory(), sizeBytes: st.size });
      } catch {}
    }
  } catch {}
  return out;
}

export interface TmpRootDebrisPlan {
  toDelete: TmpRootEntry[];
  spared: number;
}

/**
 * Planificateur PUR : décide quoi supprimer parmi les candidats.
 * Règles : (1) âge ≥ minAgeMs ; (2) PAS dans la fenêtre d'un claim vivant
 * (créé après le début du batch le plus ancien → épargné).
 */
export function planTmpRootDebris(
  candidates: TmpRootEntry[],
  opts: { liveClaims: LiveClaimRef[]; now?: number; minAgeMs?: number }
): TmpRootDebrisPlan {
  const now = opts.now ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? 0;
  const oldestClaimStart = opts.liveClaims.length
    ? Math.min(...opts.liveClaims.map(c => c.createdAt))
    : null;

  const toDelete: TmpRootEntry[] = [];
  let spared = 0;
  for (const e of candidates) {
    if (oldestClaimStart !== null && e.mtimeMs > oldestClaimStart) {
      spared++; // créé pendant un batch vivant → épargné (conservateur)
      continue;
    }
    if (now - e.mtimeMs < minAgeMs) {
      spared++; // trop récent pour la politique d'âge de l'appelant
      continue;
    }
    toDelete.push(e);
  }
  return { toDelete, spared };
}
