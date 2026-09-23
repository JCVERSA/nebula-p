import fs from "fs";
import os from "os";
import path from "path";

/**
 * Garde-fou disque GLOBAL inter-bots (8.78, session 3).
 *
 * Problème : le plafond de batch (NEBULA_NOVABOX_MAX_BATCH_MB, 2048 Mo) est
 * vérifié PAR MOTEUR — trois bots qui batchent en même temps peuvent
 * réclamer 3×2048 Mo alors qu'il reste ~3 Go sur le disque → remplissage
 * complet, échecs de zip, crash npm/update.
 *
 * Solution : chaque batch REVENDIQUE son pire cas dans un dossier partagé
 * (TMPDIR/nebula-disk-claims, commun à tous les process du même hôte).
 * Avant de démarrer, un batch vérifie : espace libre − (somme des
 * réclamations actives des AUTRES jobs, tous bots confondus) ≥ réserve.
 * La réclamation est libérée quand le job atteint un état terminal dans
 * batchDownloadManager (completed/failed/cancelled) ; si un moteur meurt en
 * cours de batch, sa réclamation est détectée orpheline (PID mort) et
 * nettoyée au prochain passage.
 *
 * Échec sûr : si le système de fichiers ne permet pas de lire l'espace
 * libre (statfs indisponible), le garde refuse les NOUVEAUX batchs mais ne
 * casse jamais un batch en cours.
 */

export interface DiskClaim {
  jobId: string;
  botId: string;
  pid: number;
  expectedBytes: number;
  createdAt: number;
}

export interface AcquireResult {
  ok: boolean;
  error?: string;
  freeBytes?: number;
  claimedBytes?: number;
}

/** Réserve minimale laissée libre sur le disque (Mo). */
function minFreeBytes(): number {
  return Math.max(0, Number(process.env.NEBULA_MIN_FREE_DISK_MB ?? 500)) * 1024 * 1024;
}
/** Désactivation d'urgence (comme NEBULA_PANEL_COMMANDS). */
function guardEnabled(): boolean {
  return String(process.env.NEBULA_DISK_GUARD ?? "on").toLowerCase() !== "off";
}
/** Au-delà, une réclamation est considérée comme débris (batch planté). */
const CLAIM_STALE_MS = 12 * 60 * 60 * 1000;

export function claimsDir(): string {
  return process.env.NEBULA_CLAIMS_DIR || path.join(os.tmpdir(), "nebula-disk-claims");
}

function claimFile(jobId: string): string {
  // Les ids de batch sont hex, mais on blinde contre tout séparateur de chemin.
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(claimsDir(), `${safe}.json`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // EPERM = le process existe mais n'est pas à nous → vivant.
    return e?.code === "EPERM";
  }
}

function readClaim(file: string): DiskClaim | null {
  try {
    const claim = JSON.parse(fs.readFileSync(file, "utf-8")) as DiskClaim;
    if (typeof claim?.jobId !== "string" || !Number.isFinite(claim?.expectedBytes)) return null;
    return {
      jobId: claim.jobId,
      botId: String(claim.botId || "unknown"),
      pid: Number(claim.pid) || 0,
      expectedBytes: Math.max(0, Number(claim.expectedBytes)),
      createdAt: Number(claim.createdAt) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Réclamations actives (tous bots/process confondus). Nettoie au passage
 * les débris : fichiers illisibles, PID morts, réclamations trop vieilles.
 */
export function listDiskClaims(): DiskClaim[] {
  const dir = claimsDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const live: DiskClaim[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dir, file);
    const claim = readClaim(full);
    const stale =
      !claim ||
      !isPidAlive(claim.pid) ||
      (claim.createdAt > 0 && Date.now() - claim.createdAt > CLAIM_STALE_MS);
    if (stale) {
      try {
        fs.unlinkSync(full);
      } catch {}
      continue;
    }
    live.push(claim);
  }
  return live;
}

function readFreeBytes(): number | null {
  try {
    // L'espace qui compte est celui du TMPDIR (staging des batchs :
    // segments HLS, TS consolidés, zips — cf. novabox os.tmpdir()).
    const stats = fs.statfsSync(os.tmpdir());
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function formatMB(bytes: number): string {
  return String(Math.max(0, Math.round(bytes / (1024 * 1024))));
}

/**
 * Réclame `expectedBytes` pour `jobId`. Refuse (sans lever) si l'espace
 * libre moins les réclamations des AUTRES jobs passe sous la réserve.
 * Ré-acquérir avec le même jobId remplace sa propre réclamation.
 */
export function acquireDiskClaim(jobId: string, expectedBytes: number): AcquireResult {
  if (!guardEnabled()) return { ok: true };
  const bytes = Math.max(0, Math.floor(expectedBytes));
  const dir = claimsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { ok: false, error: "Garde disque : impossible de préparer le dossier de réclamations." };
  }

  const live = listDiskClaims();
  const claimedByOthers = live
    .filter((c) => c.jobId !== jobId)
    .reduce((sum, c) => sum + c.expectedBytes, 0);

  const freeBytes = readFreeBytes();
  if (freeBytes === null) {
    return {
      ok: false,
      error: "Garde disque : espace libre illisible — nouveau batch refusé par sécurité (NEBULA_DISK_GUARD=off pour contourner).",
    };
  }
  if (freeBytes - (claimedByOthers + bytes) < minFreeBytes()) {
    return {
      ok: false,
      error:
        `Espace disque insuffisant : ${formatMB(freeBytes)} Mo libres, ` +
        `${formatMB(claimedByOthers)} Mo déjà réservés par d'autres téléchargements, ` +
        `${formatMB(bytes)} Mo nécessaires. Attends la fin des batchs en cours puis réessaie.`,
      freeBytes,
      claimedBytes: claimedByOthers,
    };
  }

  const claim: DiskClaim = {
    jobId,
    botId: process.env.NEBULA_BOT_ID || "nebula",
    pid: process.pid,
    expectedBytes: bytes,
    createdAt: Date.now(),
  };
  try {
    const tmp = claimFile(jobId) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(claim), { encoding: "utf-8" });
    fs.renameSync(tmp, claimFile(jobId));
  } catch {
    return { ok: false, error: "Garde disque : impossible d'enregistrer la réservation disque." };
  }
  return { ok: true, freeBytes, claimedBytes: claimedByOthers };
}

/** Libère la réclamation d'un job (sans erreur si elle n'existe pas). */
export function releaseDiskClaim(jobId: string): boolean {
  try {
    fs.unlinkSync(claimFile(jobId));
    return true;
  } catch {
    return false;
  }
}
