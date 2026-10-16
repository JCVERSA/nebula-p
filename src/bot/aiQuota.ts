import fs from "fs";
import path from "path";
import { getConfig } from "./config.js";
import { isKnownOwnerLid } from "./ownerIdentity.js";

/**
 * Per-user AI budget.
 *
 * Anyone who can message the bot can trigger Gemini calls (`.ai`,
 * automatic DM replies). Without a budget that is unlimited API spend for
 * any contact. This module enforces:
 *  - a daily request allowance per sender (default 40, env NEBULA_AI_DAILY_LIMIT)
 *  - a global concurrency cap (default 3, env NEBULA_AI_MAX_CONCURRENT)
 *
 * Counters persist to the data dir so restarts do not reset the budget and
 * are only for owned numbers (the owner can raise the limit via env).
 */

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getQuotaFile(): string {
  return path.join(getDataDir(), "ai_usage.json");
}

const DAILY_LIMIT = Number(process.env.NEBULA_AI_DAILY_LIMIT || 40);

// 9.18ll — plafond quotidien DÉDIÉ aux synthèses vocales Gemini (défaut 10,
// env NEBULA_TTS_DAILY_LIMIT ; 0 = désactive la voix Gemini pour les
// non-owner). Indépendant du quota IA général : la recherche 15/10 montre
// que le free tier TTS de la clé Gemini est plafonné (~10-100 synthèses/
// jour selon tier) et PARTAGÉ entre tous les utilisateurs — chaque user
// goûte à la voix naturelle sans vider le plafond commun ; au-delà,
// ttsService replie sur Edge Henri (jamais de blocage).
let TTS_DAILY_LIMIT = Math.max(0, Number(process.env.NEBULA_TTS_DAILY_LIMIT || 10));

/** Test hook — fixe le plafond TTS sans recharger le module. */
export function __setTtsDailyLimitForTests(n: number): void {
  TTS_DAILY_LIMIT = Math.max(0, Math.floor(Number(n) || 0));
}

// 9.18 (M) — limite IA personnalisée par utilisateur (userDirectory).
// Injection d'un résolveur plutôt qu'un import direct : aiQuota reste un
// module bas niveau sans dépendance circulaire avec le répertoire.
let overrideGetter: ((sender: string) => number | null) | null = null;
export function setAIQuotaOverrideGetter(fn: (sender: string) => number | null | undefined): void {
  overrideGetter = (sender) => {
    try {
      const v = fn(sender);
      return typeof v === "number" && v > 0 ? v : null;
    } catch {
      return null;
    }
  };
}
/**
 * 9.18gg (décision owner 15/10 : « pour le owner c'est illimité — c'est mon
 * bot et mes clés ») : le numéro owner (config ownerNumber, repli
 * OWNER_NUMBER) échappe au quota IA. Comparaison sur les chiffres du jid ;
 * les garde-fous ANTI-BOUCLE de l'agent (3 décisions/message, signature,
 * plafonds par message) restent appliqués à tous, owner compris.
 * 9.18nn : un jid @lid owner (WhatsApp « numéro masqué ») reconnu par le
 * moteur (mémoire 8.89/9.16b) échappe AUSSI aux deux quotas (IA + TTS).
 */
/** 9.18pp — exporté pour webQuota (même règle owner partout, mono-source). */
export function isOwnerSender(sender: string): boolean {
  // 9.18nn (retour terrain 16/10 : « pk il ne me reconnais pas ? ») : l'owner
  // écrit via un jid @lid (WhatsApp « masquer mon numéro », ex. …5378) alors
  // que OWNER_NUMBER est son numéro réel (ex. …3760) — la comparaison brute
  // ne matchait JAMAIS et l'owner était quotalé comme un invité depuis
  // 9.18gg. Le moteur résout le LID à CHAQUE message (botEngine, 8.89) et
  // mémorise les LID owner reconnus (9.16b) ; on consulte cette mémoire :
  // reconnu une fois → illimité pour tout le cycle de vie du process.
  if (isKnownOwnerLid(sender)) return true;
  try {
    const owner = String(getConfig().ownerNumber || process.env.OWNER_NUMBER || "").replace(/\D/g, "");
    if (!owner) return false;
    const digits = String(sender || "").replace(/\D/g, "");
    return !!digits && (digits === owner || digits.endsWith(owner));
  } catch {
    return false;
  }
}

function limitFor(sender: string): number {
  if (isOwnerSender(sender)) return 1_000_000; // illimité, JSON-safe (pas Infinity)
  const o = overrideGetter?.(sender);
  if (o && Number.isFinite(o) && o > 0) return Math.min(Math.floor(o), 500);
  return DAILY_LIMIT;
}
const MAX_CONCURRENT = Math.max(1, Number(process.env.NEBULA_AI_MAX_CONCURRENT || 3));

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
  console.warn("[AIQuota] Failed to load usage file:", e?.message || e);
}

// 9.18ll — compteur TTS séparé (ai_tts_usage.json) : indépendant du quota
// IA général, même format et même persistance atomique.
let ttsUsage: Record<string, UsageRecord> = {};
try {
  const ttsFile = path.join(getDataDir(), "ai_tts_usage.json");
  if (fs.existsSync(ttsFile)) {
    ttsUsage = JSON.parse(fs.readFileSync(ttsFile, "utf-8"));
  }
} catch (e: any) {
  console.warn("[AIQuota] Failed to load TTS usage file:", e?.message || e);
}

let saveTimer: NodeJS.Timeout | null = null;
function persistJSON(file: string, data: unknown): void {
  const tmp = `${file}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      persistJSON(getQuotaFile(), usage);
      persistJSON(path.join(getDataDir(), "ai_tts_usage.json"), ttsUsage);
    } catch (e: any) {
      console.error("[AIQuota] Failed to persist usage:", e?.message || e);
    }
  }, 1000);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function recordIn(map: Record<string, UsageRecord>, sender: string): UsageRecord {
  const key = sender.replace(/[^0-9a-zA-Z@.:\-_]/g, "");
  const now = today();
  const current = map[key];
  if (!current || current.date !== now) {
    map[key] = { date: now, count: 0 };
  }
  return map[key];
}

function recordFor(sender: string): UsageRecord {
  return recordIn(usage, sender);
}

export interface AIQuotaDecision {
  allowed: boolean;
  usedToday: number;
  limit: number;
  error?: string;
}

/** Checks the daily budget; does not consume. */
export function checkAIQuota(sender: string): AIQuotaDecision {
  const rec = recordFor(sender);
  const limit = limitFor(sender);
  if (rec.count >= limit) {
    return {
      allowed: false,
      usedToday: rec.count,
      limit,
      error: `Daily AI request limit reached (${rec.count}/${limit}). Try again tomorrow.`,
    };
  }
  return { allowed: true, usedToday: rec.count, limit };
}

/** 9.18 (B) — usage IA du jour pour le dashboard (sans consommation). */
export function getAIQuotaUsage(sender: string): { used: number; limit: number } {
  const rec = recordFor(sender);
  return { used: rec.count, limit: limitFor(sender) };
}

/** Consumes one unit of the daily budget. */
export function consumeAIQuota(sender: string): AIQuotaDecision {
  const rec = recordFor(sender);
  const limit = limitFor(sender);
  if (rec.count >= limit) {
    return {
      allowed: false,
      usedToday: rec.count,
      limit,
      error: `Daily AI request limit reached (${rec.count}/${limit}). Try again tomorrow.`,
    };
  }
  rec.count += 1;
  scheduleSave();
  return { allowed: true, usedToday: rec.count, limit };
}

/** 9.16 — remet à zéro le quota IA du jour pour un utilisateur (dashboard). */
export function resetAIQuota(sender: string): boolean {
  const key = sender.replace(/[^0-9a-zA-Z@.:\-_]/g, "");
  if (!usage[key]) return false;
  delete usage[key];
  scheduleSave();
  return true;
}

/**
 * 9.18ll — plafond TTS dédié (voir TTS_DAILY_LIMIT en tête de module).
 * Owner illimité (même règle que le quota IA 9.18gg) ; ne consomme pas.
 */
export function checkTTSQuota(sender: string): AIQuotaDecision {
  const rec = recordIn(ttsUsage, sender);
  const limit = isOwnerSender(sender) ? 1_000_000 : TTS_DAILY_LIMIT;
  if (rec.count >= limit) {
    return {
      allowed: false,
      usedToday: rec.count,
      limit,
      error: `Daily TTS voice limit reached (${rec.count}/${limit}). Try again tomorrow.`,
    };
  }
  return { allowed: true, usedToday: rec.count, limit };
}

/** 9.18ll — consomme une synthèse vocale Gemini du plafond TTS du jour. */
export function consumeTTSQuota(sender: string): AIQuotaDecision {
  const decision = checkTTSQuota(sender);
  if (!decision.allowed) return decision;
  recordIn(ttsUsage, sender).count += 1;
  scheduleSave();
  return { allowed: true, usedToday: decision.usedToday + 1, limit: decision.limit };
}

/** 9.18ll — remet à zéro le plafond TTS du jour pour un utilisateur (dashboard/tests). */
export function resetTTSQuota(sender: string): boolean {
  const key = sender.replace(/[^0-9a-zA-Z@.:\-_]/g, "");
  if (!ttsUsage[key]) return false;
  delete ttsUsage[key];
  scheduleSave();
  return true;
}

/** Global concurrency gate (in-house semaphore, no extra dependency). */
let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/** Runs `fn` inside the global AI concurrency cap with a safety timeout. */
export async function withAIConcurrency<T>(fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  await acquire();
  const timer = setTimeout(release, timeoutMs + 5_000);
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI request timed out.")), timeoutMs)
      ),
    ]);
  } finally {
    clearTimeout(timer);
    release();
  }
}

/** Running total for the dashboard (aggregate across senders). */
export function getAIUsageSummary() {
  const now = today();
  let todayCount = 0;
  for (const rec of Object.values(usage)) {
    if (rec.date === now) todayCount += rec.count;
  }
  return { todayCount, dailyLimit: DAILY_LIMIT, maxConcurrent: MAX_CONCURRENT };
}
