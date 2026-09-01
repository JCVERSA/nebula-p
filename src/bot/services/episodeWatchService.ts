import fs from "fs";
import path from "path";
import crypto from "crypto";
import moment from "moment-timezone";
import { voiranimeEpisodes } from "./voiranimeClient.js";

/**
 * Episode watch service — `.a watch` (audit S4, 2026-09-01).
 *
 * Periodically polls subscribed voiranime VF seasons and notifies the chat
 * when new episodes appear, with the exact `.a <title> s1 <ep> r1` command to
 * download them. Design notes:
 * - Storage: one JSON file under NEBULA_DATA_DIR (same pattern as aiQuota) —
 *   subscriptions survive restarts; atomic write (tmp + rename).
 * - The cycle is fully dependency-injected (fetch + send + clock) so the test
 *   suite covers deltas, caps, quiet hours and error paths without network.
 * - Quiet hours skip a subscription WITHOUT updating lastSeenEp, so the
 *   notification is delivered when the window reopens (never lost).
 * - Failures never delete user data: consecutiveErrors is tracked for
 *   observability only.
 */

export interface WatchSubscription {
  id: string;
  chatJid: string;
  title: string;
  seasonUrl: string; // voiranime VF season URL (episode listing page)
  lang: string;
  lastSeenEp: number; // highest episode number already known/notified
  createdAt: number;
  lastCheckedAt?: number;
  consecutiveErrors: number;
}

export const WATCH_MAX_PER_CHAT = 20;
export const WATCH_MAX_GLOBAL = 200;
export const WATCH_DEFAULT_TZ = "Africa/Douala";

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}
function getWatchFile(): string {
  return path.join(getDataDir(), "watch_subscriptions.json");
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Episodes strictly greater than lastSeenEp, deduped and sorted ascending. */
export function computeNewEpisodes(lastSeenEp: number, episodeNumbers: number[]): number[] {
  const unique = new Set(
    (episodeNumbers || []).filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
  );
  return [...unique].filter((n) => n > lastSeenEp).sort((a, b) => a - b);
}

/**
 * True inside the quiet window. Range format "23-7" (start hour - end hour,
 * midnight-crossing allowed), "off" disables. Unknown ranges disable quiet
 * hours (fail-open on notifications, never on silence).
 */
export function isQuietHour(now: Date, tz: string, range: string): boolean {
  if (!range || range.toLowerCase() === "off") return false;
  const m = range.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  let startH = parseInt(m[1]!, 10);
  let endH = parseInt(m[2]!, 10);
  if (startH > 23 || endH > 23) return false;
  const zone = moment.tz.zone(tz) ? tz : WATCH_DEFAULT_TZ;
  const hour = moment.tz(now, zone).hour();
  if (startH === endH) return false; // zero-length window
  return startH < endH ? hour >= startH && hour < endH : hour >= startH || hour < endH;
}

function fmtEpList(eps: number[], maxShown = 6): string {
  const shown = eps.slice(0, maxShown).join(", ");
  return eps.length > maxShown ? `${shown}… (+${eps.length - maxShown})` : shown;
}

export function formatWatchNotification(sub: WatchSubscription, newEpisodes: number[]): string {
  const first = newEpisodes[0]!;
  const last = newEpisodes[newEpisodes.length - 1]!;
  const range = first === last ? `${first}` : `${first}-${last}`;
  return (
    `📢 *Nouvel épisode disponible !*\n` +
    `🎬 *${sub.title}* (${sub.lang})\n` +
    `🆕 Ép. ${fmtEpList(newEpisodes)}\n\n` +
    `📥 Télécharger maintenant :\n\`.a ${sub.title} s1 ${range} r1\`\n\n` +
    `🌌 _Nebula Bot · veille automatique (\`.a unwatch ${sub.title}\` pour arrêter)_`
  );
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function loadSubscriptions(): WatchSubscription[] {
  try {
    const raw = fs.readFileSync(getWatchFile(), "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSubscriptions(list: WatchSubscription[]): void {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${getWatchFile()}.tmp-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, getWatchFile());
}

export interface AddWatchResult {
  ok: boolean;
  error?: string;
  subscription?: WatchSubscription;
  updated?: boolean; // true when an existing subscription was refreshed
}

export function addSubscription(input: {
  chatJid: string;
  title: string;
  seasonUrl: string;
  lang?: string;
  lastSeenEp: number;
}): AddWatchResult {
  const list = loadSubscriptions();
  const existing = list.find((s) => s.chatJid === input.chatJid && s.seasonUrl === input.seasonUrl);
  if (existing) {
    existing.title = input.title;
    existing.lang = input.lang || existing.lang;
    existing.lastSeenEp = Math.max(existing.lastSeenEp, input.lastSeenEp);
    existing.consecutiveErrors = 0;
    saveSubscriptions(list);
    return { ok: true, subscription: existing, updated: true };
  }
  if (list.filter((s) => s.chatJid === input.chatJid).length >= WATCH_MAX_PER_CHAT) {
    return { ok: false, error: `Maximum de ${WATCH_MAX_PER_CHAT} veilles par discussion.` };
  }
  if (list.length >= WATCH_MAX_GLOBAL) {
    return { ok: false, error: `Maximum global de ${WATCH_MAX_GLOBAL} veilles atteint.` };
  }
  const subscription: WatchSubscription = {
    id: crypto.randomBytes(6).toString("hex"),
    chatJid: input.chatJid,
    title: input.title,
    seasonUrl: input.seasonUrl,
    lang: input.lang || "VF",
    lastSeenEp: Math.max(0, input.lastSeenEp | 0),
    createdAt: Date.now(),
    consecutiveErrors: 0
  };
  list.push(subscription);
  saveSubscriptions(list);
  return { ok: true, subscription };
}

/** Removes this chat's subscriptions whose title matches the query (substring, case-insensitive). */
export function removeSubscriptions(chatJid: string, query: string): number {
  const q = (query || "").trim().toLowerCase();
  const list = loadSubscriptions();
  const kept = list.filter((s) => {
    if (s.chatJid !== chatJid) return true;
    return q ? !s.title.toLowerCase().includes(q) : false;
  });
  const removed = list.length - kept.length;
  if (removed > 0) saveSubscriptions(kept);
  return removed;
}

export function listSubscriptions(chatJid: string): WatchSubscription[] {
  return loadSubscriptions().filter((s) => s.chatJid === chatJid);
}

/** Backup/restore support: validate an untrusted payload into clean subscriptions. */
export function sanitizeWatchSubscriptions(raw: unknown): WatchSubscription[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchSubscription[] = [];
  for (const item of raw.slice(0, WATCH_MAX_GLOBAL)) {
    const r = item as any;
    const seasonUrl = typeof r?.seasonUrl === "string" && /^https?:\/\//i.test(r.seasonUrl.trim()) ? r.seasonUrl.trim() : "";
    const chatJid = typeof r?.chatJid === "string" ? r.chatJid.trim().slice(0, 64) : "";
    const title = typeof r?.title === "string" ? r.title.trim().slice(0, 128) : "";
    if (!seasonUrl || !chatJid || !title) continue;
    out.push({
      id: typeof r?.id === "string" && r.id.length <= 24 ? r.id : crypto.randomBytes(6).toString("hex"),
      chatJid,
      title,
      seasonUrl,
      lang: typeof r?.lang === "string" ? r.lang.slice(0, 8) : "VF",
      lastSeenEp: Math.min(Math.max(0, Number(r?.lastSeenEp) || 0), 100000),
      createdAt: Math.min(Math.max(0, Number(r?.createdAt) || Date.now()), Date.now()),
      lastCheckedAt: Number(r?.lastCheckedAt) || undefined,
      consecutiveErrors: 0 // restored subscriptions start with a clean error slate
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Watch cycle (dependency-injected for tests)
// ---------------------------------------------------------------------------

export type WatchEpisodeFetcher = (seasonUrl: string) => Promise<Array<{ n: number }>>;
export type WatchSender = (chatJid: string, text: string) => Promise<void>;

export interface WatchCycleOptions {
  fetchEpisodes?: WatchEpisodeFetcher;
  send: WatchSender;
  now?: Date;
  tz?: string;
  quietRange?: string;
  subscriptions?: WatchSubscription[]; // injectable state (tests); defaults to storage
  persist?: boolean; // default true when subscriptions were loaded from storage
}

export interface WatchCycleSummary {
  checked: number;
  notified: number;
  errors: number;
  skippedQuiet: number;
}

export async function runWatchCycle(options: WatchCycleOptions): Promise<WatchCycleSummary> {
  const fetchEpisodes = options.fetchEpisodes || ((url: string) => voiranimeEpisodes(url));
  const now = options.now || new Date();
  const tz = options.tz || process.env.NEBULA_WATCH_TZ || WATCH_DEFAULT_TZ;
  const quietRange = options.quietRange ?? (process.env.NEBULA_WATCH_QUIET ?? "23-7");
  const fromStorage = !options.subscriptions;
  const subs = options.subscriptions || loadSubscriptions();

  const summary: WatchCycleSummary = { checked: 0, notified: 0, errors: 0, skippedQuiet: 0 };
  let dirty = false;

  for (const sub of subs) {
    if (isQuietHour(now, tz, quietRange)) {
      summary.skippedQuiet++;
      continue;
    }
    try {
      const eps = await fetchEpisodes(sub.seasonUrl);
      const numbers = (eps || []).map((e) => e.n).filter((n) => typeof n === "number" && n > 0);
      sub.lastCheckedAt = now.getTime();
      dirty = true;
      const fresh = computeNewEpisodes(sub.lastSeenEp, numbers);
      if (fresh.length > 0) {
        await options.send(sub.chatJid, formatWatchNotification(sub, fresh));
        sub.lastSeenEp = fresh[fresh.length - 1]!;
        sub.consecutiveErrors = 0;
        summary.notified++;
      }
      summary.checked++;
    } catch (err: any) {
      sub.consecutiveErrors = (sub.consecutiveErrors || 0) + 1;
      sub.lastCheckedAt = now.getTime();
      dirty = true;
      summary.errors++;
      console.warn(`[WATCH] fetch failed for "${sub.title}" (${sub.consecutiveErrors}x): ${err?.message || err}`);
    }
  }

  if (dirty && fromStorage && options.persist !== false) {
    try {
      saveSubscriptions(subs);
    } catch (err: any) {
      console.warn(`[WATCH] persist failed: ${err?.message || err}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Runtime wiring (cron + sender) — called from botEngine on connection open
// ---------------------------------------------------------------------------

let cronHandle: any = null;
let liveSender: WatchSender | null = null;
let cycleRunning = false;

export function setWatchSender(send: WatchSender): void {
  liveSender = send;
}

/** Starts the polling scheduler (idempotent). Cron via NEBULA_WATCH_CRON, default every 6h. */
export function startWatchScheduler(): void {
  if (cronHandle) return;
  const schedule = process.env.NEBULA_WATCH_CRON || "0 */6 * * *";
  try {
    // Lazy require keeps the cron dependency out of the test bundle graph.
    const cron = require("node-cron") as typeof import("node-cron");
    cronHandle = cron.schedule(schedule, async () => {
      if (cycleRunning || !liveSender) return;
      cycleRunning = true;
      try {
        const summary = await runWatchCycle({ send: liveSender });
        if (summary.checked + summary.notified + summary.errors + summary.skippedQuiet > 0) {
          console.log(
            `[WATCH] cycle: ${summary.checked} checked, ${summary.notified} notified, ` +
              `${summary.errors} errors, ${summary.skippedQuiet} quiet-skipped`
          );
        }
      } catch (err: any) {
        console.warn(`[WATCH] cycle crashed: ${err?.message || err}`);
      } finally {
        cycleRunning = false;
      }
    });
    console.log(`[WATCH] episode watcher scheduled (${schedule}, quiet ${process.env.NEBULA_WATCH_QUIET || "23-7"} ${process.env.NEBULA_WATCH_TZ || WATCH_DEFAULT_TZ})`);
  } catch (err: any) {
    console.warn(`[WATCH] scheduler unavailable: ${err?.message || err}`);
  }
}
