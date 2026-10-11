/**
 * 9.16 — Annonces : envoyer un message à une sélection d'utilisateurs
 * et/ou de groupes depuis le dashboard, avec rédaction assistée par IA.
 *
 * Anti-ban WhatsApp : JAMAIS de rafale. Un envoi toutes les 3-8 s
 * (pause aléatoire — un robot qui envoie à la même milliseconde est un
 * signal de spam pour les serveurs WhatsApp). Une annonce à 50
 * destinataires prend ~4 min : c'est le prix de protéger le numéro.
 *
 * Un seul job à la fois (refus honnête si un envoi est en cours).
 * Historique persisté (50 dernières) : quoi, quand, à combien, taux
 * d'échec — le dashboard affiche la progression en direct.
 */

import fs from "fs";
import path from "path";

export type AnnounceSender = (jid: string, text: string) => Promise<void>;

let sender: AnnounceSender | null = null;
export function setAnnounceSender(fn: AnnounceSender): void {
  sender = fn;
}

export interface AnnouncementJob {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  text: string;
  targets: string[];
  sentCount: number;
  failures: Array<{ jid: string; error: string }>;
  status: "running" | "done";
}

let currentJob: AnnouncementJob | null = null;

export interface HistoryEntry {
  id: string;
  at: number;
  text: string;
  total: number;
  sent: number;
  failed: number;
}

const HISTORY_CAP = 50;

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}
function getHistoryFile(): string {
  return path.join(getDataDir(), "announcements.json");
}

let history: HistoryEntry[] = [];
try {
  if (fs.existsSync(getHistoryFile())) {
    const raw = JSON.parse(fs.readFileSync(getHistoryFile(), "utf-8"));
    if (Array.isArray(raw)) {
      history = raw
        .filter((e): e is HistoryEntry => e && typeof e.id === "string" && typeof e.at === "number")
        .slice(-HISTORY_CAP);
    }
  }
} catch (e: any) {
  console.warn("[Announce] Failed to load history:", e?.message || e);
}

function saveHistory(): void {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    const tmp = `${getHistoryFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history, null, 2), "utf-8");
    fs.renameSync(tmp, getHistoryFile());
  } catch (e: any) {
    console.error("[Announce] Failed to persist history:", e?.message || e);
  }
}

export function getAnnouncementHistory(): HistoryEntry[] {
  return [...history].reverse(); // plus récent d'abord
}

/** Pause anti-ban : 3 à 8 s aléatoires (injectable pour les tests). */
export type AnnounceSleep = (ms: number) => Promise<void>;
const defaultSleep: AnnounceSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nextDelayMs(): number {
  return 3000 + Math.floor(Math.random() * 5000);
}

export interface StartOptions {
  sleep?: AnnounceSleep;
  delayFactory?: () => number;
}

export type StartResult =
  | { ok: true; id: string; total: number }
  | { ok: false; error: string };

/** Lance une annonce (une seule à la fois — refus honnête sinon). */
export function startAnnouncement(text: string, targets: string[], options: StartOptions = {}): StartResult {
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, error: "annonce vide" };
  if (clean.length > 4000) return { ok: false, error: "annonce trop longue (max 4000 caractères)" };
  const unique = [...new Set(targets.map((t) => String(t || "").trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, error: "aucun destinataire sélectionné" };
  if (unique.length > 500) return { ok: false, error: `trop de destinataires (${unique.length}, max 500)` };
  if (currentJob && currentJob.status === "running") {
    return { ok: false, error: "une annonce est déjà en cours — attends la fin (progression visible)" };
  }
  const id = `ann_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  currentJob = {
    id,
    startedAt: Date.now(),
    finishedAt: null,
    text: clean,
    targets: unique,
    sentCount: 0,
    failures: [],
    status: "running",
  };
  void runJob(currentJob, options);
  return { ok: true, id, total: unique.length };
}

async function runJob(job: AnnouncementJob, options: StartOptions): Promise<void> {
  const sleep = options.sleep || defaultSleep;
  const delayFactory = options.delayFactory || nextDelayMs;
  const send = sender;
  if (!send) {
    job.failures.push({ jid: "(moteur)", error: "moteur WhatsApp non connecté" });
    job.status = "done";
    job.finishedAt = Date.now();
    // 9.17 (audit J-1) : ce chemin écrit AUSSI l'historique — sinon la trace
    // d'un envoi échoué par moteur déconnecté disparaissait au job suivant.
    history.push({
      id: job.id,
      at: job.startedAt,
      text: job.text,
      total: job.targets.length,
      sent: 0,
      failed: job.targets.length,
    });
    if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
    saveHistory();
    return;
  }
  for (let i = 0; i < job.targets.length; i++) {
    const jid = job.targets[i];
    try {
      await send(jid, job.text);
      job.sentCount += 1;
    } catch (err: any) {
      job.failures.push({ jid, error: String(err?.message || err).slice(0, 200) });
    }
    if (i < job.targets.length - 1) {
      await sleep(delayFactory()); // anti-ban : jamais deux envois collés
    }
  }
  job.status = "done";
  job.finishedAt = Date.now();
  history.push({
    id: job.id,
    at: job.startedAt,
    text: job.text,
    total: job.targets.length,
    sent: job.sentCount,
    failed: job.failures.length,
  });
  if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
  saveHistory();
}

export function getAnnouncementStatus(): AnnouncementJob | null {
  return currentJob ? { ...currentJob } : null;
}

/** 9.16 — DM direct depuis le dashboard (même sender que les annonces). */
export async function sendDirectMessage(jid: string, text: string): Promise<void> {
  if (!sender) throw new Error("moteur WhatsApp non connecté");
  const clean = String(text || "").trim();
  if (!clean) throw new Error("message vide");
  await sender(String(jid || "").trim(), clean.slice(0, 4000));
}

// ── Brouillon IA (injectable pour les tests) ───────────────────────────────

export type DraftGenerator = (prompt: string) => Promise<string | null>;

export async function draftAnnouncement(
  idea: string,
  generate: DraftGenerator
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const clean = String(idea || "").trim();
  if (!clean) return { ok: false, error: "décris ton annonce en quelques mots" };
  if (clean.length > 500) return { ok: false, error: "idée trop longue (max 500 caractères)" };
  const prompt = [
    "Tu rédiges une annonce WhatsApp envoyée par un bot à ses utilisateurs.",
    "Rédige une annonce concise (max 900 caractères), en français, ton amical et direct,",
    "à partir de l'idée suivante. Réponds UNIQUEMENT avec le texte de l'annonce,",
    "sans guillemets, sans préambule, sans titre. Tu peux utiliser quelques emojis pertinents.",
    `Idée : ${clean}`
  ].join(" ");
  try {
    const text = await generate(prompt);
    if (!text || !text.trim()) return { ok: false, error: "l'IA n'a rien renvoyé — réessaie ou écris-la toi-même" };
    const trimmed = text.trim();
    if (trimmed.length > 4000) return { ok: false, error: "brouillon trop long — raccourcis-le" };
    return { ok: true, text: trimmed };
  } catch (err: any) {
    return { ok: false, error: `échec IA (${String(err?.message || err).slice(0, 150)})` };
  }
}

/** Tests uniquement. */
export function __resetAnnouncementsForTests(): void {
  currentJob = null;
  history = [];
  try {
    if (fs.existsSync(getHistoryFile())) fs.rmSync(getHistoryFile(), { force: true });
  } catch {}
}
