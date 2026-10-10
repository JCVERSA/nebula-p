import fs from "fs";
import path from "path";

/**
 * Budget web partagé (9.0) — .search / .fetch / .wiki.
 *
 * Ces commandes ne consomment AUCUN token IA (recherche déterministe),
 * mais elles sortent sur internet depuis l'IP du VPS : sans plafond, un
 * contact peut marteler DuckDuckGo/Wikipédia et faire bloquer l'IP pour
 * tout le monde. Ce module applique :
 *  - un quota journalier PAR EXPÉDITEUR, partagé par les trois commandes
 *    (défaut 20, env NEBULA_WEB_DAILY_LIMIT) ;
 *  - une persistance JSON dans le data dir (les redémarrages ne
 *    réinitialisent pas le budget — même modèle que aiQuota).
 *
 * Comptabilisé uniquement en cas de SUCCÈS : un échec réseau ne mange pas
 * le budget de l'utilisateur.
 */

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getQuotaFile(): string {
  return path.join(getDataDir(), "web_usage.json");
}

/** Résolu à chaque appel (et non à l'import) : testable et chaud en env. */
export function getWebDailyLimit(): number {
  const n = Number(process.env.NEBULA_WEB_DAILY_LIMIT || 20);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

interface UsageRecord {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
}

let usage: Record<string, UsageRecord> = {};
try {
  if (fs.existsSync(getQuotaFile())) {
    usage = JSON.parse(fs.readFileSync(getQuotaFile(), "utf-8"));
  }
} catch (e: any) {
  console.warn("[WebQuota] Failed to load usage file:", e?.message || e);
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      const tmp = `${getQuotaFile()}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(usage, null, 2), "utf-8");
      fs.renameSync(tmp, getQuotaFile());
    } catch (e: any) {
      console.warn("[WebQuota] Failed to save usage file:", e?.message || e);
    }
  }, 500);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function recordFor(sender: string): UsageRecord {
  const r = usage[sender];
  if (!r || r.date !== today()) {
    const fresh: UsageRecord = { date: today(), count: 0 };
    usage[sender] = fresh;
    return fresh;
  }
  return r;
}

export interface WebQuotaStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export function checkWebQuota(sender: string): WebQuotaStatus {
  const limit = getWebDailyLimit();
  const r = usage[sender];
  const used = r && r.date === today() ? r.count : 0;
  const remaining = Math.max(0, limit - used);
  return { allowed: remaining > 0, remaining, limit };
}

export function consumeWebQuota(sender: string): void {
  recordFor(sender).count += 1;
  scheduleSave();
}
