/**
 * 9.18mmmm — réglages persistants par groupe (suite admin).
 *
 * Un fichier JSON sous NEBULA_DATA_DIR (même pattern que watch_subscriptions
 * et aiQuota — survit aux crashs et aux mises à jour) :
 *   { "groups": { "<gid>": { "welcome": {...}, "goodbye": {...}, "warns": {...} } } }
 *
 * Règles :
 *  - écriture atomique (tmp + rename) : un crash en pleine écriture ne
 *    corrompt JAMAIS l'état précédent ;
 *  - lecture tolérante (fichier absent/corrompu → repart à vide) ;
 *  - warns : décroissance 7 jours (un avertissement ancien ne compte plus) ;
 *  - seuil d'expulsion auto : NEBULA_WARN_KICK (défaut 3, 0 = désactivé).
 */

import fs from "fs";
import path from "path";

export interface WelcomeConf {
  enabled: boolean;
  text: string;
}

export interface WarnEntry {
  at: number;
  reason: string;
}

interface GroupConf {
  welcome?: WelcomeConf;
  goodbye?: WelcomeConf;
  warns?: Record<string, WarnEntry[]>;
}

interface StoreShape {
  groups: Record<string, GroupConf>;
}

export const WARN_DECAY_MS = 7 * 24 * 3600 * 1000;
export const DEFAULT_WARN_TEXT = "Bienvenue {user} dans {groupe} 👋";
export const DEFAULT_GOODBYE_TEXT = "{user} a quitté {groupe} 👋";

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "group_settings.json");
}

let cache: StoreShape | null = null;

function load(): StoreShape {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === "object" && typeof parsed.groups === "object" ? (parsed as StoreShape) : { groups: {} };
  } catch {
    cache = { groups: {} };
  }
  return cache!;
}

/** Écriture atomique — ne casse jamais sur disque plein (best effort, l'état mémoire reste la vérité de session). */
function save(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache ?? { groups: {} }, null, 2), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    /* persistance best effort — jamais d'échec visible */
  }
}

function groupConf(gid: string): GroupConf {
  const s = load();
  if (!s.groups[gid]) s.groups[gid] = {};
  return s.groups[gid];
}

// ── Welcome / Goodbye ──────────────────────────────────────────────────────

export function getWelcome(gid: string): WelcomeConf {
  return { enabled: false, text: DEFAULT_WARN_TEXT, ...groupConf(gid).welcome };
}

export function setWelcome(gid: string, conf: Partial<WelcomeConf>): WelcomeConf {
  const c = groupConf(gid);
  c.welcome = { ...getWelcome(gid), ...conf };
  save();
  return c.welcome;
}

export function getGoodbye(gid: string): WelcomeConf {
  return { enabled: false, text: DEFAULT_GOODBYE_TEXT, ...groupConf(gid).goodbye };
}

export function setGoodbye(gid: string, conf: Partial<WelcomeConf>): WelcomeConf {
  const c = groupConf(gid);
  c.goodbye = { ...getGoodbye(gid), ...conf };
  save();
  return c.goodbye;
}

// ── Warns ──────────────────────────────────────────────────────────────────

/** Entrées d'avertissement encore actives (fenêtre 7 jours). */
export function activeWarns(gid: string, user: string, now = Date.now()): WarnEntry[] {
  const list = groupConf(gid).warns?.[user] || [];
  return list.filter(w => now - w.at < WARN_DECAY_MS);
}

/** Ajoute un avertissement ; retourne le nombre actif (décroissance appliquée). */
export function addWarn(gid: string, user: string, reason: string, now = Date.now()): number {
  const c = groupConf(gid);
  if (!c.warns) c.warns = {};
  const kept = activeWarns(gid, user, now);
  kept.push({ at: now, reason: reason.slice(0, 120) });
  c.warns[user] = kept;
  save();
  return kept.length;
}

export function resetWarns(gid: string, user: string): void {
  const c = groupConf(gid);
  if (c.warns) delete c.warns[user];
  save();
}

/** Liste des utilisateurs avec avertissements actifs (pour `.warn` sans cible). */
export function listWarnedUsers(gid: string, now = Date.now()): Array<{ user: string; warns: WarnEntry[] }> {
  const warns = groupConf(gid).warns || {};
  const out: Array<{ user: string; warns: WarnEntry[] }> = [];
  for (const [user, list] of Object.entries(warns)) {
    const active = list.filter(w => now - w.at < WARN_DECAY_MS);
    if (active.length > 0) out.push({ user, warns: active });
  }
  return out.sort((a, b) => b.warns.length - a.warns.length).slice(0, 10);
}

/** Seuil d'expulsion auto (NEBULA_WARN_KICK, défaut 3 ; 0 = désactivé). */
export function warnKickThreshold(): number {
  const raw = Number(process.env.NEBULA_WARN_KICK);
  if (!Number.isFinite(raw) || raw < 0) return 3;
  return Math.floor(raw);
}

/** Tests uniquement : vide le cache (le fichier suit NEBULA_DATA_DIR du test). */
export function __resetGroupSettingsForTests(): void {
  cache = null;
}
