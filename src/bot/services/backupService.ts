import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * ============================================================================
 *  9.18yy — sauvegarde quotidienne du dossier de données du bot
 * ============================================================================
 *  Recommandation de l'audit terrain 16/10 (AUDIT_2026-10-16.md) : « les
 *  compteurs quotas/mode vocal vivent dans database/ — une sauvegarde
 *  quotidienne suffirait ». Choix d'implémentation : scheduler INTERNE au
 *  moteur (pattern du digest 8.99) — zéro cron à poser sur le VPS, chaque
 *  moteur multi-bots (8.75) sauvegarde SON dossier (NEBULA_DATA_DIR), qui ne
 *  contient que des états JSON légers (le reuse média vit dans os.tmpdir(),
 *  l'authentification Baileys dans NEBULA_AUTH_DIR — jamais dans l'archive).
 *
 *  Comportement :
 *   - archive <dataDir>/backups/data-YYYYMMDD-HHmmss.tar.gz (heure locale
 *     NEBULA_WATCH_TZ via cron), contenu = tout le dataDir SAUF backups/ ;
 *   - rétention NEBULA_BACKUP_KEEP (défaut 7) — les plus anciennes purgées ;
 *   - au démarrage : une sauvegarde si la dernière date de plus de 12 h
 *     (un moteur qui redémarre en boucle ne spaime pas la rétention) ;
 *   - NEBULA_BACKUP=0 coupe tout ; aucun échec ne fait planter le moteur.
 *
 *  backupFileName / backupsToDelete / shouldSkipBootBackup sont PURS
 *  (testés à plat) ; createDataBackup fait l'IO et ne jette JAMAIS.
 */

export interface BackupResult {
  ok: boolean;
  /** Nom de l'archive créée (ex. data-20261017-041500.tar.gz). */
  file?: string;
  /** Taille de l'archive en octets. */
  bytes?: number;
  /** Archives purgées par la rétention lors de cette exécution. */
  pruned: string[];
  error?: string;
}

const BACKUP_NAME_RE = /^data-\d{8}-\d{6}\.tar\.gz$/;
const BOOT_MIN_AGE_MS = 12 * 60 * 60 * 1000;

function dataDir(): string {
  // 9.18bbb (fix terrain 17/10) : le slot par défaut porte un dataDir
  // RELATIF (« database ») — fs le résout contre process.cwd() partout
  // ailleurs, mais tar est un SOUS-PROCESSUS avec son propre cwd : sans
  // résolution absolue ici, l'archive partait dans database/database/.
  return path.resolve(process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database"));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Pur : nom d'archive pour un instant donné (heure locale du process). */
export function backupFileName(now = new Date()): string {
  return `data-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.tar.gz`;
}

/** Pur : parmi des noms d'archives (triés anciens → récents), lesquels purger. */
export function backupsToDelete(names: string[], keep: number): string[] {
  const valid = names.filter((n) => BACKUP_NAME_RE.test(n)).sort();
  const k = Math.max(1, Math.floor(keep) || 1);
  return valid.length > k ? valid.slice(0, valid.length - k) : [];
}

/** IO : noms d'archives valides du dossier, triés anciens → récents. */
export function listBackupNames(backupsDir: string): string[] {
  try {
    return fs
      .readdirSync(backupsDir)
      .filter((n) => BACKUP_NAME_RE.test(n))
      .sort();
  } catch {
    return [];
  }
}

/** Pur : la sauvegarde de démarrage doit-elle être sautée (dernière < 12 h) ? */
export function shouldSkipBootBackup(newestMtimeMs: number | null, now = Date.now()): boolean {
  if (newestMtimeMs === null || !Number.isFinite(newestMtimeMs)) return false;
  return now - newestMtimeMs < BOOT_MIN_AGE_MS;
}

function keepCount(): number {
  const raw = Number(process.env.NEBULA_BACKUP_KEEP);
  if (!Number.isFinite(raw)) return 7;
  return Math.min(90, Math.max(1, Math.floor(raw)));
}

/**
 * IO : crée l'archive du dataDir (opt.dataDir injectable pour les tests),
 * applique la rétention, ne jette JAMAIS.
 */
export async function createDataBackup(opts?: {
  dataDir?: string;
  keep?: number;
  now?: Date;
}): Promise<BackupResult> {
  const dir = path.resolve(opts?.dataDir || dataDir());
  const keep = opts && typeof opts.keep === "number" ? Math.max(1, Math.floor(opts.keep)) : keepCount();
  const name = backupFileName(opts?.now || new Date());
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { ok: false, pruned: [], error: "le dossier de données n'est pas un répertoire" };
  } catch {
    return { ok: false, pruned: [], error: "dossier de données absent" };
  }

  const backupsDir = path.join(dir, "backups");
  const outPath = path.join(backupsDir, name);
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    // Tout le dataDir SAUF backups/ (l'archive ne s'emboîte pas elle-même).
    await execFileAsync("tar", ["-czf", outPath, "--exclude", "./backups", "."], { cwd: dir, timeout: 60000 });
    const bytes = fs.statSync(outPath).size;

    const pruned: string[] = [];
    for (const old of backupsToDelete(listBackupNames(backupsDir), keep)) {
      try {
        fs.unlinkSync(path.join(backupsDir, old));
        pruned.push(old);
      } catch {}
    }
    return { ok: true, file: name, bytes, pruned };
  } catch (err: any) {
    return { ok: false, pruned: [], error: String(err?.message || err) };
  }
}

// --------------------------------------------------------------------------- scheduler

let cronHandle: any = null;
let backupLog: ((message: string) => void) | null = null;

function log(message: string): void {
  try {
    backupLog?.(message);
  } catch {}
}

async function runBackup(reason: string): Promise<void> {
  const res = await createDataBackup();
  if (res.ok) {
    const kb = Math.max(1, Math.round((res.bytes || 0) / 1024));
    log(`[BACKUP] Sauvegarde ${reason} : ${res.file} (${kb} Ko)${res.pruned.length ? ` — ${res.pruned.length} ancienne(s) purgée(s)` : ""}`);
  } else {
    log(`[BACKUP] Échec de la sauvegarde ${reason} : ${res.error}`);
  }
}

/**
 * Cron quotidien (idempotent), démarré par botEngine à la connexion —
 * pattern du digest. NEBULA_BACKUP=0 désactive tout.
 */
export function startBackupScheduler(logger?: (message: string) => void): void {
  if (cronHandle) return;
  if (String(process.env.NEBULA_BACKUP || "").trim() === "0") return;
  backupLog = logger || null;

  const hourRaw = Number(process.env.NEBULA_BACKUP_HOUR);
  const hour = Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? Math.floor(hourRaw) : 4;
  const tz = process.env.NEBULA_WATCH_TZ || (process.env.NEBULA_TZ || "").trim() || "UTC";
  const schedule = `0 ${hour} * * *`;
  try {
    const cron = require("node-cron") as typeof import("node-cron");
    cronHandle = cron.schedule(schedule, async () => {
      await runBackup(`planifiée (${schedule} ${tz})`);
    }, { timezone: tz });

    // Au démarrage : une sauvegarde si la dernière date de plus de 12 h —
    // un redémarrage en boucle ne consomme pas la rétention.
    try {
      const backupsDir = path.join(dataDir(), "backups");
      const names = listBackupNames(backupsDir);
      let newestMtimeMs: number | null = null;
      if (names.length > 0) {
        newestMtimeMs = fs.statSync(path.join(backupsDir, names[names.length - 1])).mtimeMs;
      }
      if (!shouldSkipBootBackup(newestMtimeMs)) {
        void runBackup("au démarrage");
      }
    } catch {}

    console.log(`[BACKUP] planifié (${schedule} ${tz})`);
  } catch (err: any) {
    console.warn(`[BACKUP] scheduler indisponible : ${err?.message || err}`);
  }
}

/** Tests uniquement. */
export function __resetBackupSchedulerForTests(): void {
  if (cronHandle) {
    try {
      cronHandle.stop();
    } catch {}
  }
  cronHandle = null;
  backupLog = null;
}
