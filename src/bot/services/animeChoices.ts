import fs from "fs";
import path from "path";

/**
 * 8.97/8.98 — mémoire des choix interactifs anime (owner request 2026-10-10).
 *
 * Le bot se souvient des téléchargements lancés dans chaque chat (anime,
 * catalogue, langue, saison, qualité, épisodes) — assez pour que l'agent
 * résolve « le même anime », « l'épisode suivant », « le même mais en
 * 720p » en commande exacte, sans rien deviner.
 *
 * 8.98 (owner : « 5 derniers en contexte », inspiré hermes-agent) :
 *  - le store garde un HISTORIQUE par chat (cap 20), plus une seule entrée ;
 *  - le bloc injecté dans le prompt détaille le DERNIER téléchargement et
 *    liste les 4 précédents en une ligne compacte — l'IA peut répondre
 *    « qu'est-ce qu'on avait pris la semaine dernière ? » ;
 *  - budget de contexte gardé strict (test agentContextBudget) : la leçon
 *    hermes est qu'une fiche qui gonfle fait perdre « le milieu » du prompt.
 *
 * Décisions :
 *  - TTL fixe depuis l'enregistrement — défaut 7 jours,
 *    NEBULA_ANIME_CHOICES_TTL_HOURS ("0" = désactivé) ;
 *  - JSON à écriture atomique comme les autres stores, plafond de chats ;
 *  - effacé par `.ai forget` (avec la mémoire de conversation) ;
 *  - le titre vient du catalogue (pas du texte libre utilisateur) et est
 *    plafonné ; aucun autre champ libre.
 */

export interface AnimeChoiceRecord {
  title: string;
  source: "va" | "as";
  language: "VF" | "VOSTFR";
  seasonName: string;
  quality: string;
  episodesSpec: string;
  lastEpisode: number | null;
  ts: number;
}

type ChoiceStore = Record<string, AnimeChoiceRecord[]>;

const DEFAULT_TTL_HOURS = 168; // 7 jours
const MAX_TITLE_CHARS = 120;
const MAX_FIELD_CHARS = 60;
const MAX_STORED_CHATS = 500;
/** Historique conservé par chat (le dernier + marge pour les anciens). */
const MAX_HISTORY_PER_CHAT = 20;
/** Entrées listées dans le bloc contexte : le dernier (détaillé) + ces lignes. */
const PREVIOUS_IN_CONTEXT = 4;
/** Budget strict du bloc contexte complet (test agentContextBudget, 8.98). */
export const MAX_CONTEXT_BUDGET_EXPORT_FOR_TESTS = 900;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "anime_choices.json");
}

export function getChoicesTtlMs(): number {
  const raw = Number(process.env.NEBULA_ANIME_CHOICES_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

function isDisabled(): boolean {
  return getChoicesTtlMs() === 0;
}

/** 8.98 : migration — l'ancien format (8.97) stockait UNE fiche par chat. */
function normalizeEntry(raw: any): AnimeChoiceRecord | null {
  if (!raw || typeof raw !== "object" || typeof raw.ts !== "number") return null;
  return {
    title: String(raw.title || "").slice(0, MAX_TITLE_CHARS),
    source: raw.source === "as" ? "as" : "va",
    language: raw.language === "VF" ? "VF" : "VOSTFR",
    seasonName: String(raw.seasonName || "").slice(0, MAX_FIELD_CHARS),
    quality: String(raw.quality || "").slice(0, MAX_FIELD_CHARS),
    episodesSpec: String(raw.episodesSpec || "").slice(0, MAX_FIELD_CHARS),
    lastEpisode:
      typeof raw.lastEpisode === "number" && Number.isFinite(raw.lastEpisode) && raw.lastEpisode > 0
        ? Math.floor(raw.lastEpisode)
        : null,
    ts: raw.ts
  };
}

function loadStore(): ChoiceStore {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: ChoiceStore = {};
    for (const [chat, value] of Object.entries(parsed as Record<string, any>)) {
      const list = Array.isArray(value) ? value : [value]; // 8.97 = fiche unique
      const entries = list.map(normalizeEntry).filter((e): e is AnimeChoiceRecord => e !== null);
      if (entries.length > 0) store[chat] = entries;
    }
    return store;
  } catch {
    return {};
  }
}

function saveStore(store: ChoiceStore): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // best-effort : la mémoire est un confort, jamais un blocker.
  }
}

function cap(value: string | undefined | null, max = MAX_FIELD_CHARS): string {
  const v = (value || "").replace(/\s+/g, " ").trim();
  return v.length > max ? v.slice(0, max - 1) + "…" : v;
}

function pruneExpired(list: AnimeChoiceRecord[], now: number): AnimeChoiceRecord[] {
  const ttl = getChoicesTtlMs();
  return list.filter((r) => now - r.ts <= ttl);
}

/** Enregistre un téléchargement — il devient LE dernier du chat (tête de liste). */
export function recordAnimeChoice(
  chatJid: string,
  rec: {
    title: string;
    source: "va" | "as";
    language: "VF" | "VOSTFR";
    seasonName?: string;
    quality?: string;
    episodesSpec?: string;
    lastEpisode?: number | null;
  },
  now = Date.now()
): void {
  if (!chatJid || !rec?.title || isDisabled()) return;
  const entry: AnimeChoiceRecord = {
    title: cap(rec.title, MAX_TITLE_CHARS),
    source: rec.source === "as" ? "as" : "va",
    language: rec.language === "VF" ? "VF" : "VOSTFR",
    seasonName: cap(rec.seasonName),
    quality: cap(rec.quality),
    episodesSpec: cap(rec.episodesSpec),
    lastEpisode:
      typeof rec.lastEpisode === "number" && Number.isFinite(rec.lastEpisode) && rec.lastEpisode > 0
        ? Math.floor(rec.lastEpisode)
        : null,
    ts: now
  };
  const store = loadStore();
  const previous = pruneExpired(store[chatJid] || [], now).filter((r) => r.ts !== entry.ts);
  store[chatJid] = [entry, ...previous].slice(0, MAX_HISTORY_PER_CHAT);
  // Plafond : éviction des plus anciens (lazy, sans scan externe).
  const keys = Object.keys(store);
  if (keys.length > MAX_STORED_CHATS) {
    const oldestTs = (k: string) => Math.min(...store[k].map((r) => r.ts));
    keys
      .sort((a, b) => oldestTs(a) - oldestTs(b))
      .slice(0, keys.length - MAX_STORED_CHATS)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
}

/** Historique complet du chat (récent → ancien), filtré par TTL. */
export function getAnimeChoiceHistory(chatJid: string, now = Date.now()): AnimeChoiceRecord[] {
  if (!chatJid || isDisabled()) return [];
  return pruneExpired(loadStore()[chatJid] || [], now);
}

/** Dernier téléchargement du chat, ou null (absent / expiré / désactivé). */
export function getAnimeChoice(chatJid: string, now = Date.now()): AnimeChoiceRecord | null {
  return getAnimeChoiceHistory(chatJid, now)[0] || null;
}

/**
 * 8.99 (leçon Mastra — observational memory) : le bloc historique n'a
 * d'utilité que si le message parle d'anime/téléchargement. L'injecter
 * partout pollue le prompt de « salut ça va » (bruit = moins bonnes
 * décisions + tokens gaspillés). Heuristique FR volontairement large —
 * faux positif = historique inutile mais inoffensif, faux négatif = on
 * retombe sur le comportement d'avant 8.97 (pas de contexte).
 */
export function messageSuggestsAnimeHistory(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  if (/(t[ée]l[ée]charg|t[ée]l[ée]|t[ée]lecharge|download|dl\b)/.test(t)) return true;
  if (/(anime|manga|[ée]pisode|\bep\b|eps?\d|\be\d+\b|saison|\bs\d+\b|\bsaison\s*\d)/.test(t)) return true;
  if (/(suite|prochain|next|m[êe]me\b|encore|dernier|pr[ée]c[ée]dent)/.test(t)) return true;
  if (/qu.est.ce qu.on avait|on avait (pris|t[ée]l[ée]charg)/.test(t)) return true;
  if (/\b(vf|vostfr|480p|720p|1080p|360p|q(ualit[ée])?)\b/.test(t)) return true;
  // Un one-liner `.a <titre>` (ou l'évoquer en début de message) — la
  // règle ANCIENNE (/.?a\b\s+/) matchait « salut ça va » (le « a » de
  // « ça ») : on ancre au début du message.
  if (/^\s*\.?a\s+/.test(t) && t.length < 120) return true;
  return false;
}

function relativeFr(ms: number): string {
  if (ms < 60_000) return "à l'instant";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/**
 * Bloc injecté dans le prompt système de l'agent (et du chat DM) : factuel,
 * compact, en français — les règles d'USAGE vivent dans la fiche agent
 * (commandKnowledge), pas ici. Budget gardé strict (agentContextBudget).
 */
export function getAnimeChoiceContext(chatJid: string, now = Date.now()): string | null {
  const history = getAnimeChoiceHistory(chatJid, now);
  if (history.length === 0) return null;
  const rec = history[0];
  const parts = [
    `Titre : ${rec.title}`,
    `Catalogue : ${rec.source}`,
    `Langue : ${rec.language}`,
    rec.seasonName ? `Saison : ${rec.seasonName}` : "",
    rec.quality ? `Qualité : ${rec.quality}` : "",
    rec.episodesSpec ? `Épisodes : ${rec.episodesSpec}` : "",
    rec.lastEpisode ? `dernier épisode : ${rec.lastEpisode}` : ""
  ].filter(Boolean);
  let block =
    `[Historique anime — dernier téléchargement de ce chat, ${relativeFr(now - rec.ts)}]\n` +
    parts.join(" · ");
  const previous = history.slice(1, 1 + PREVIOUS_IN_CONTEXT);
  if (previous.length > 0) {
    const line = previous
      .map((r) => `${r.title} (${[r.seasonName, r.language, relativeFr(now - r.ts)].filter(Boolean).join(", ")})`)
      .join(" · ");
    block += `\nPrécédents : ${line}`;
  }
  return block;
}

/** `.ai forget` efface aussi cette mémoire. Retourne true si quelque chose existait. */
export function forgetAnimeChoices(chatJid: string): boolean {
  if (!chatJid) return false;
  const store = loadStore();
  if (!(chatJid in store)) return false;
  delete store[chatJid];
  saveStore(store);
  return true;
}
