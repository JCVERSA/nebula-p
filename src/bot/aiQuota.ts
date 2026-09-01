import fs from "fs";
import path from "path";

/**
 * Per-user AI budget.
 *
 * Anyone who can message the bot can trigger Gemini calls (`.ai`, `.image`,
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
      console.error("[AIQuota] Failed to persist usage:", e?.message || e);
    }
  }, 1000);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function recordFor(sender: string): UsageRecord {
  const key = sender.replace(/[^0-9a-zA-Z@.:\-_]/g, "");
  const now = today();
  const current = usage[key];
  if (!current || current.date !== now) {
    usage[key] = { date: now, count: 0 };
  }
  return usage[key];
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
  if (rec.count >= DAILY_LIMIT) {
    return {
      allowed: false,
      usedToday: rec.count,
      limit: DAILY_LIMIT,
      error: `Daily AI request limit reached (${rec.count}/${DAILY_LIMIT}). Try again tomorrow.`,
    };
  }
  return { allowed: true, usedToday: rec.count, limit: DAILY_LIMIT };
}

/** Consumes one unit of the daily budget. */
export function consumeAIQuota(sender: string): AIQuotaDecision {
  const rec = recordFor(sender);
  if (rec.count >= DAILY_LIMIT) {
    return {
      allowed: false,
      usedToday: rec.count,
      limit: DAILY_LIMIT,
      error: `Daily AI request limit reached (${rec.count}/${DAILY_LIMIT}). Try again tomorrow.`,
    };
  }
  rec.count += 1;
  scheduleSave();
  return { allowed: true, usedToday: rec.count, limit: DAILY_LIMIT };
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
