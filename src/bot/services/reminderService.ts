import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * 9.18bb (P7, décision owner 15/10) — rappels programmés par chat.
 *
 * « .remind 18h télécharger mushoku » → message ⏰ livré automatiquement à
 * 18h00 dans le chat. Aussi : « dans 30 min », « dans 2h », « dans 1h30 »,
 * « demain 9h ». Liste (.remind list) et annulation (.remind cancel N).
 *
 * Décisions de design :
 *  - les HEURES sont interprétées en heure du Cameroun (Africa/Douala,
 *    UTC+1 sans heure d'été) — les utilisateurs du bot sont là-bas, le VPS
 *    est en UTC : « 18h » doit vouloir dire 18h pour EUX. Offset calculé
 *    via Intl (robuste), repli +60 min ;
 *  - parsing du MOMENT déterministe et pur (parseReminderSpec) — l'agent
 *    route « rappelle-moi… », la commande parse, zéro ambiguïté IA ;
 *  - store JSON atomique par dataDir (donc par bot en multi-bots) comme
 *    tous les stores ; bornes : 10 rappels actifs/chat, texte 300 chars,
 *    30 s minimum et 7 jours maximum d'avance ;
 *  - livraison : scheduler 30 s (startReminderScheduler, sock injecté par
 *    le boot — engine.ts/server.ts), tentatives capées à 5 si l'envoi
 *    échoue, jamais de crash du moteur ;
 *  - AUCUN nouvel env (cf. règle ENV_KEYS).
 */

export interface Reminder {
  id: string;
  chatJid: string;
  text: string;
  dueAt: number;
  createdAt: number;
  attempts: number;
}

export type ReminderSpec =
  | { kind: "list" }
  | { kind: "cancel"; index: number }
  | { kind: "set"; dueAt: number; text: string; humanWhen: string };

const TZ = "Africa/Douala";
const MAX_ACTIVE_PER_CHAT = 10;
export const MAX_TEXT_CHARS = 300;
const MAX_FUTURE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FUTURE_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "reminders.json");
}

function loadAll(): Reminder[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    if (!Array.isArray(parsed)) return [];
    const out: Reminder[] = [];
    for (const e of parsed) {
      if (
        e && typeof e === "object" && typeof e.id === "string" && typeof e.chatJid === "string" &&
        typeof e.text === "string" && typeof e.dueAt === "number" && Number.isFinite(e.dueAt)
      ) {
        out.push({
          id: e.id,
          chatJid: e.chatJid,
          text: e.text.slice(0, MAX_TEXT_CHARS),
          dueAt: e.dueAt,
          createdAt: Number(e.createdAt) || Date.now(),
          attempts: Number(e.attempts) || 0
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function saveAll(list: Reminder[]): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(list), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // Fail-closed : rien de fatal, retenté au prochain cycle.
  }
}

// ── Heure du Cameroun ───────────────────────────────────────────────────────

/** Offset de TZ en minutes (local - UTC), calculé via Intl, repli +60. */
export function tzOffsetMinutes(now = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const parts = dtf.formatToParts(now);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return Math.round((asUTC - now.getTime()) / 60000);
  } catch {
    return 60;
  }
}

function fmtTime(h: number, min: number): string {
  return `${h}h${String(min).padStart(2, "0")}`;
}

// ── Parsing du moment (pur) ─────────────────────────────────────────────────

/**
 * Parse les args de .remind.Formats : « 18h », « 18h30 », « demain 9h »,
 * « dans 30 min », « dans 2h », « dans 1h30 ». Sous-commandes : list/liste/ls,
 * cancel N / annule N. Retourne null si rien de compréhensible (fail-open :
 * la commande affiche l'aide).
 */
export function parseReminderSpec(input: string, now = Date.now()): ReminderSpec | null {
  const t = String(input || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "list" || lower === "liste" || lower === "ls") return { kind: "list" };
  const cancel = lower.match(/^(?:cancel|annule)\s+(\d{1,2})$/);
  if (cancel) return { kind: "cancel", index: Number(cancel[1]) };

  let dueAt = 0;
  let humanWhen = "";
  let rest = "";

  let m: RegExpMatchArray | null;
  if ((m = t.match(/^dans\s+(\d{1,3})\s*(?:min|mins|minutes?|m)\b/i))) {
    const n = Number(m[1]);
    dueAt = now + n * 60_000;
    humanWhen = `dans ${n} minute${n > 1 ? "s" : ""}`;
    rest = t.slice(m[0].length).trim();
  } else if ((m = t.match(/^dans\s+(\d{1,2})\s*(?:h|heures?)\s+(\d{1,2})\s*(?:min|mins|minutes?)\b/i))) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (min > 59) return null;
    dueAt = now + (h * 3600 + min * 60) * 1000;
    humanWhen = `dans ${h} h ${String(min).padStart(2, "0")}`;
    rest = t.slice(m[0].length).trim();
  } else if ((m = t.match(/^dans\s+(\d{1,2})\s*(?:h|heures?)(\d{1,2})?\b/i))) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (min > 59) return null;
    dueAt = now + (h * 3600 + min * 60) * 1000;
    humanWhen = `dans ${h} h${min ? String(min).padStart(2, "0") : ""}`;
    rest = t.slice(m[0].length).trim();
  } else if ((m = t.match(/^(\d{1,2})h(\d{2})?\b/i))) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    const offset = tzOffsetMinutes(new Date(now));
    const wall = new Date(now + offset * 60_000);
    let ts = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), h, min, 0) - offset * 60_000;
    if (ts < now - 2 * 60_000) {
      ts += 24 * 60 * 60 * 1000; // heure déjà passée aujourd'hui → demain
      humanWhen = `demain à ${fmtTime(h, min)}`;
    } else {
      humanWhen = `à ${fmtTime(h, min)}`;
    }
    // Audit 9.18 (P7) : « 18h » tapé à 17:59:50 (ou juste après 18h) est une
    // demande légitime — la borner à +30 s plutôt que la rejeter avec l'aide.
    if (ts < now + MIN_FUTURE_MS) ts = now + MIN_FUTURE_MS;
    dueAt = ts;
    rest = t.slice(m[0].length).trim();
  } else if ((m = t.match(/^demain\s+(?:à\s+|a\s+)?(\d{1,2})h(\d{2})?\b/i))) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    const offset = tzOffsetMinutes(new Date(now));
    const wall = new Date(now + offset * 60_000);
    const ts = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1, h, min, 0) - offset * 60_000;
    dueAt = ts;
    humanWhen = `demain à ${fmtTime(h, min)}`;
    rest = t.slice(m[0].length).trim();
  } else {
    return null;
  }

  if (!rest) return null; // pas de texte → aide
  if (dueAt < now + MIN_FUTURE_MS) return null; // trop tôt / déjà passé
  if (dueAt > now + MAX_FUTURE_MS) return null; // plus de 7 jours
  return { kind: "set", dueAt, text: rest.slice(0, MAX_TEXT_CHARS), humanWhen };
}

// ── Store par chat ──────────────────────────────────────────────────────────

/** Rappels actifs du chat, triés par échéance. */
export function listReminders(chatJid: string): Reminder[] {
  if (!chatJid) return [];
  return loadAll()
    .filter((r) => r.chatJid === chatJid)
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Ajoute un rappel. False si le plafond par chat est atteint. */
export function addReminder(chatJid: string, dueAt: number, text: string, now = Date.now()): Reminder | null {
  if (!chatJid || !Number.isFinite(dueAt) || !text) return null;
  const all = loadAll();
  if (all.filter((r) => r.chatJid === chatJid).length >= MAX_ACTIVE_PER_CHAT) return null;
  const rec: Reminder = {
    id: crypto.randomBytes(6).toString("hex"),
    chatJid,
    text: String(text).slice(0, MAX_TEXT_CHARS),
    dueAt: Math.floor(dueAt),
    createdAt: now,
    attempts: 0
  };
  all.push(rec);
  saveAll(all);
  return rec;
}

/** Annule par numéro 1-based (ordre de listReminders). */
export function cancelReminder(chatJid: string, index: number): boolean {
  const list = listReminders(chatJid);
  const rec = list[index - 1];
  if (!rec) return false;
  saveAll(loadAll().filter((r) => r.id !== rec.id));
  return true;
}

/** Rappels échus toutes catégories (scheduler). */
export function getDueReminders(now = Date.now()): Reminder[] {
  return loadAll().filter((r) => r.dueAt <= now);
}

export function removeReminder(id: string): void {
  saveAll(loadAll().filter((r) => r.id !== id));
}

/** Échec d'envoi : tente encore (cap MAX_ATTEMPTS puis abandon honnête). */
export function markReminderAttempt(id: string): void {
  const all = loadAll();
  const rec = all.find((r) => r.id === id);
  if (!rec) return;
  rec.attempts += 1;
  // Audit terrain 15/10 : la livraison était invisible dans les logs.
  // Aucun jid ni contenu — id + compteurs uniquement (§ vie privée).
  console.warn(`[REMIND] échec d'envoi rappel ${rec.id} (tentative ${rec.attempts}/${MAX_ATTEMPTS})`);
  if (rec.attempts >= MAX_ATTEMPTS) {
    console.warn(`[REMIND] rappel ${rec.id} abandonné après ${MAX_ATTEMPTS} tentatives`);
  }
  saveAll(rec.attempts >= MAX_ATTEMPTS ? all.filter((r) => r.id !== id) : all);
}

// ── Scheduler (boot) ────────────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

async function deliverDueReminders(getSock: () => any): Promise<void> {
  try {
    const due = getDueReminders(Date.now());
    if (due.length === 0) return;
    const sock = typeof getSock === "function" ? getSock() : null;
    if (!sock || typeof sock.sendMessage !== "function") return; // hors connexion : retenté au tick suivant
    for (const r of due) {
      try {
        await sock.sendMessage(r.chatJid, { text: `⏰ *Rappel*\n\n${r.text}` });
        removeReminder(r.id);
        console.log(`[REMIND] ⏰ rappel ${r.id} livré (${r.text.length} caractères)`);
      } catch {
        markReminderAttempt(r.id);
      }
    }
  } catch {
    // Le scheduler ne doit jamais casser le moteur.
  }
}

/** Démarre la livraison (idempotent). Le sock est lu à chaque tick. */
export function startReminderScheduler(getSock: () => any, intervalMs = 30_000): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void deliverDueReminders(getSock);
  }, intervalMs);
}

/** Tests uniquement. */
export function __resetReminderSchedulerForTests(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
