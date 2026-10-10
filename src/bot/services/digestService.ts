import fs from "fs";
import path from "path";
import { loadSubscriptions } from "./episodeWatchService.js";
import { getAIUsageSummary } from "../aiQuota.js";
import { getAgentHealth, type AgentHealthSummary } from "./agentMetrics.js";

/**
 * 8.99 — digest quotidien du propriétaire (owner : 8 h, contenu complet,
 * TOUJOURS envoyé — preuve de vie quotidienne du bot).
 *
 * Décisions owner (2026-10-10) :
 *  - heure : NEBULA_DIGEST_HOUR (défaut 8), timezone NEBULA_WATCH_TZ
 *    (défaut Africa/Douala) — même référence que les veilles ;
 *  - contenu : veilles (.w) + espace disque + quota IA + santé agent ;
 *  - désactivation : NEBULA_DIGEST=0 ;
 *  - envoyé en DM à OWNER_NUMBER, pattern identique au watcher (.w) :
 *    sender injecté par botEngine à la connexion, cron node-cron.
 *
 * formatDailyDigest est PUR (testé à plat) ; collectDigestInputs fait l'IO.
 */

export interface DigestInputs {
  subscriptions: Array<{ title: string; lang: string; lastSeenEp: number }>;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  aiUsage: { todayCount: number; dailyLimit: number };
  agentHealth: AgentHealthSummary;
}

export type DigestSender = (text: string) => Promise<void>;

let liveSender: DigestSender | null = null;
let cronHandle: any = null;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} Mo`;
}

/** Pur : compose le message du digest (testé à plat). */
export function formatDailyDigest(inputs: DigestInputs, now = new Date()): string {
  const date = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const lines: string[] = [`🌌 *${process.env.NEBULA_BOT_ID ? "Nebula" : "Nebula"} — digest du matin*`, `📅 ${date}`, ``];

  // Veilles
  lines.push(`📡 *Veilles (.w)* — ${inputs.subscriptions.length} active(s)`);
  if (inputs.subscriptions.length === 0) {
    lines.push(`_Aucune veille — pose-en une avec \`.w <titre>\`._`);
  } else {
    for (const sub of inputs.subscriptions.slice(0, 6)) {
      lines.push(`• *${sub.title}* (${sub.lang}) — dernier épisode vu : ${sub.lastSeenEp || 0}`);
    }
    if (inputs.subscriptions.length > 6) lines.push(`_…et ${inputs.subscriptions.length - 6} autre(s)_`);
  }
  lines.push(``);

  // Disque
  if (inputs.diskFreeBytes !== null && inputs.diskTotalBytes && inputs.diskTotalBytes > 0) {
    const pct = Math.round((inputs.diskFreeBytes / inputs.diskTotalBytes) * 100);
    const warn = pct < 15 ? ` ⚠️ _moins de 15 % — pense à \`.purge\`_` : ``;
    lines.push(`💾 *Espace disque* — ${fmtBytes(inputs.diskFreeBytes)} libres (${pct} %)${warn}`);
  } else {
    lines.push(`💾 *Espace disque* — indisponible`);
  }

  // Quota IA
  lines.push(`📊 *Quota IA (jour)* — ${inputs.aiUsage.todayCount}/${inputs.aiUsage.dailyLimit} requêtes`);

  // Agent
  const h = inputs.agentHealth;
  const pctOk = Math.round(h.parseOkRate * 100);
  const agentBits = [
    `🤖 *Agent (24 h)* — ${h.turns} tour(s)`,
    h.turns > 0 ? `${pctOk} % décisions conformes` : ``,
    h.degraded > 0 ? `${h.degraded} dégradation(s)` : ``,
    h.avgLatencyMs !== null ? `latence moy. ${(h.avgLatencyMs / 1000).toFixed(1)} s` : ``
  ].filter(Boolean);
  lines.push(agentBits.join(" · "));
  if (h.argsSanitized > 0) lines.push(`   🧼 arguments nettoyés par le garde-fou : ${h.argsSanitized}`);
  if (h.denied > 0) lines.push(`   ⛔ commandes refusées (denylist/inconnues) : ${h.denied}`);

  const quiet =
    inputs.subscriptions.length === 0 &&
    h.turns === 0 &&
    inputs.aiUsage.todayCount === 0;
  if (quiet) lines.push(``, `✅ _Rien d'autre à signaler._`);
  return lines.join("\n");
}

/** IO : collecte les données réelles (chaque source peut dégrader seule). */
export function collectDigestInputs(): DigestInputs {
  let subscriptions: DigestInputs["subscriptions"] = [];
  try {
    subscriptions = loadSubscriptions().map((s) => ({ title: s.title, lang: s.lang, lastSeenEp: s.lastSeenEp }));
  } catch {}

  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const st = fs.statfsSync(dataDir());
    diskFreeBytes = Number(st.bavail) * Number(st.bsize);
    diskTotalBytes = Number(st.blocks) * Number(st.bsize);
  } catch {}

  let aiUsage = { todayCount: 0, dailyLimit: 0 };
  try {
    aiUsage = getAIUsageSummary();
  } catch {}

  return { subscriptions, diskFreeBytes, diskTotalBytes, aiUsage, agentHealth: getAgentHealth(24) };
}

/** botEngine injecte le sender à chaque (re)connexion — pattern .w. */
export function setDigestSender(send: DigestSender): void {
  liveSender = send;
}

/** Cron quotidien (idempotent). NEBULA_DIGEST=0 désactive. */
export function startDigestScheduler(): void {
  if (cronHandle) return;
  if (String(process.env.NEBULA_DIGEST || "").trim() === "0") return;
  const hourRaw = Number(process.env.NEBULA_DIGEST_HOUR);
  const hour = Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? Math.floor(hourRaw) : 8;
  const tz = process.env.NEBULA_WATCH_TZ || "Africa/Douala";
  const schedule = `0 ${hour} * * *`;
  try {
    const cron = require("node-cron") as typeof import("node-cron");
    cronHandle = cron.schedule(schedule, async () => {
      if (!liveSender) return;
      try {
        const text = formatDailyDigest(collectDigestInputs());
        await liveSender(text);
        console.log(`[DIGEST] envoyé (${schedule} ${tz})`);
      } catch (err: any) {
        console.warn(`[DIGEST] échec : ${err?.message || err}`);
      }
    }, { timezone: tz });
    console.log(`[DIGEST] planifié (${schedule} ${tz})`);
  } catch (err: any) {
    console.warn(`[DIGEST] scheduler indisponible : ${err?.message || err}`);
  }
}
