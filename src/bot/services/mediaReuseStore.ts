/**
 * 9.15 — Cache de réutilisation des médias publics (décision owner).
 *
 * Idée : si un épisode/vidéo a déjà été téléchargé et qu'un autre utilisateur
 * redemande LA MÊME chose (même anime, saison, épisode, langue, résolution —
 * ou même vidéo YouTube, qualité, piste audio, sous-titres), on renvoie un
 * lien sur le fichier EXISTANT au lieu de re-télécharger : livraison
 * instantanée, zéro bande passante, zéro copie disque.
 *
 * Architecture :
 * - Dossier dédié (os.tmpdir()/nebula_media_reuse — même système de fichiers
 *   que le coffre temporaire et le staging, pour des LIENS PHYSIQUES : un
 *   hard link ne coûte AUCUN octet supplémentaire, et le fichier survit au
 *   moveFile du coffre — c'est le même inode sous deux noms).
 * - Index JSON atomique (clé logique → chemin, taille, lastHitAt).
 * - Vie : 24 h FENÊTRE GLISSANTE (chaque réutilisation rafraîchit), cap
 *   dédié 1 GiB, éviction LRU (le plus anciennement utile part en premier).
 *   L'éviction ne supprime JAMAIS un fichier actuellement servi par un lien
 *   vivant du coffre (vérifié via listTempRecords) — il sera candidat au
 *   prochain passage.
 * - Un lien expiré/purgé du coffre reste réutilisable tant que sa fenêtre
 *   24 h vit : c'est le principe même du cache.
 *
 * Honnêteté et sécurité :
 * - lookup ne renvoie une entrée que si le fichier EXISTE et est non vide ;
 *   sinon l'entrée s'auto-purge et le chemin normal re-télécharge. Jamais
 *   d'erreur visible pour l'utilisateur.
 * - Échec de lien physique (FS différent) → repli copie UNIQUEMENT si le cap
 *   le permet ; sinon pas de cache pour ce fichier (dégradation silencieuse).
 * - Les fichiers PRIVÉS (.up) n'entrent JAMAIS ici : seul le pipeline anime
 *   (novabox) et YouTube (ytvideo) insèrent — contenu public re-téléchargeable.
 * - NEBULA_REUSE_ENABLED=0 coupe tout (lookup → null, store → no-op).
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { listTempRecords } from "../tempDownloadManager.js";

export interface MediaReuseEntry {
  key: string;
  filePath: string;
  filename: string;
  bytes: number;
  createdAt: number;
  /** Dernière utilisation (lookup réussi ou insertion) — fenêtre glissante. */
  lastHitAt: number;
  /** 9.18t : TTL propre à cette entrée (ms) — défaut global si absent.
   * Les caches « sociaux » (Instagram/TikTok/musique) vivent 5 h au lieu
   * des 24 h des anime, décision owner 14/10. */
  ttlMs?: number;
}

export interface MediaReuseHit {
  filePath: string;
  filename: string;
  bytes: number;
}

// ── Environnement (lu à chaque appel — testable/hot-switchable) ─────────────
export function isReuseEnabled(): boolean {
  return (process.env.NEBULA_REUSE_ENABLED || "").trim() !== "0";
}

export function reuseTtlHours(): number {
  const raw = Number(process.env.NEBULA_REUSE_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(168, Math.max(1, Math.floor(raw))) : 24;
}

export function reuseMaxBytes(): number {
  const raw = Number(process.env.NEBULA_UPLOAD_MAX_MB); // (garde-fou typo éventuel)
  void raw;
  const mb = Number(process.env.NEBULA_REUSE_MAX_MB);
  // 9.18yyy : défaut relevé à 2048 Mo — terrain 18/10 : un batch de 8
  // épisodes pèse 1,81 Go (dont deux « 480P » réellement 1080P à 710-725
  // Mo). À 1 GiB le cache évictait EN PLEIN BATCH (LRU) : au run suivant,
  // chaque lookup arrivait APRÈS l'éviction de son épisode — 1,7 Go
  // re-téléchargés pour rien. 2048 tient un batch terrain entier.
  const value = Number.isFinite(mb) && mb > 0 ? Math.min(4096, Math.max(64, Math.floor(mb))) : 2048;
  return value * 1024 * 1024;
}

function reuseDir(): string {
  return process.env.NEBULA_REUSE_DIR || path.join(os.tmpdir(), "nebula_media_reuse");
}

function indexPath(): string {
  return path.join(reuseDir(), "index.json");
}

// ── Index en mémoire (persisté atomiquement) ───────────────────────────────
let cachedIndex: Map<string, MediaReuseEntry> | null = null;
let cachedIndexDir = "";

function loadIndex(): Map<string, MediaReuseEntry> {
  const dir = reuseDir();
  if (cachedIndex && cachedIndexDir === dir) return cachedIndex;
  const map = new Map<string, MediaReuseEntry>();
  try {
    const raw = fs.readFileSync(indexPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const e of parsed) {
        if (e && typeof e.key === "string" && typeof e.filePath === "string") {
          map.set(e.key, {
            key: e.key,
            filePath: e.filePath,
            filename: String(e.filename || "media"),
            bytes: Number(e.bytes) || 0,
            createdAt: Number(e.createdAt) || Date.now(),
            lastHitAt: Number(e.lastHitAt) || Number(e.createdAt) || Date.now()
          });
        }
      }
    }
  } catch {} // absent/corrompu → repart à vide (les fichiers orphelins sont nettoyés par prune)
  cachedIndex = map;
  cachedIndexDir = dir;
  return map;
}

function saveIndex(map: Map<string, MediaReuseEntry>): void {
  try {
    fs.mkdirSync(reuseDir(), { recursive: true });
    const tmp = path.join(reuseDir(), `.index-${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify([...map.values()]));
    fs.renameSync(tmp, indexPath());
  } catch {} // best-effort : un échec d'écriture ne bloque jamais le téléchargement
}

/** Tests uniquement : vide le cache mémoire et le throttle de prune. */
export function __resetMediaReuseForTests(): void {
  cachedIndex = null;
  cachedIndexDir = "";
  lastPruneAt = 0;
}

// ── Clés logiques (PURES — testées) ────────────────────────────────────────
/** Normalise un titre : minuscules, sans accents, alphanumérique + espaces. */
export function normalizeTitleForReuse(title: string): string {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function animeReuseKey(title: string, season: string | number, episode: number, lang: string, resolution: string): string {
  const t = normalizeTitleForReuse(title) || "inconnu";
  const s = String(season || "01").replace(/\D/g, "").replace(/^0+/, "") || "1";
  const l = String(lang || "VOSTFR").toUpperCase().trim();
  const r = String(resolution || "480P").toUpperCase().replace(/[^0-9P]/g, "") || "480P";
  return `a|${t}|s${s}|e${episode}|${l}|${r}`;
}

export function ytvReuseKey(
  videoId: string,
  quality: string,
  audioLang?: string,
  subs?: { lang: string; auto: boolean } | null
): string {
  const id = String(videoId || "").trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return ""; // pas d'identité fiable → pas de cache
  const q = String(quality || "720").replace(/\D/g, "") || "720";
  const a = (audioLang || "def").toLowerCase();
  const s = subs ? `subs-${subs.lang.toLowerCase()}${subs.auto ? "-auto" : ""}` : "nosubs";
  return `y|${id}|${q}|${a}|${s}`;
}

// ── 9.18t : caches « sociaux » (IG / TikTok / musique) — 5 h glissantes ────

/** Durée de vie des entrées sociales (owner 14/10 : 5 h, pas 24 h). */
export const SOCIAL_REUSE_TTL_MS = 5 * 60 * 60 * 1000;

/** Instagram : un média par shortcode + index (carrousels). */
export function igReuseKey(shortcode: string, index: number): string {
  const sc = String(shortcode || "").trim();
  if (!/^[A-Za-z0-9_-]{5,}$/.test(sc)) return ""; // pas d'identité fiable → pas de cache
  return `i|${sc}|${Number(index) || 0}`;
}

/** TikTok : identifiant numérique de la vidéo (/video/<id>). */
export function tiktokReuseKey(videoId: string): string {
  const id = String(videoId || "").replace(/\D/g, "");
  if (id.length < 8) return ""; // pas d'identité fiable → pas de cache
  return `t|${id}`;
}

/**
 * Musique : identifiant YouTube (11 caractères) extrait d'une URL sous
 * n'importe quelle forme (watch?v=, youtu.be/, shorts/, embed/).
 */
export function songReuseKey(url: string): string {
  const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (!m) return "";
  return `m|${m[1]}`;
}

// ── Éviction / purge ───────────────────────────────────────────────────────
/** Un fichier est-il actuellement servi par un lien vivant du coffre ? */
function isServedByVault(filePath: string): boolean {
  try {
    return listTempRecords().some((r) => r.filePath === filePath && r.expiresAt > Date.now());
  } catch {
    return false;
  }
}

function removeEntryFile(filePath: string): void {
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

/** Applique TTL + fichiers manquants + cap LRU. Retourne le nettoyage fait. */
export function pruneMediaReuse(): { expired: number; missing: number; evicted: number; freedBytes: number } {
  const map = loadIndex();
  const now = Date.now();
  const defaultTtlMs = reuseTtlHours() * 3600 * 1000;
  let expired = 0;
  let missing = 0;
  let evicted = 0;
  let freedBytes = 0;

  for (const [key, e] of [...map.entries()]) {
    const ttlMs = e.ttlMs && e.ttlMs > 0 ? e.ttlMs : defaultTtlMs;
    if (now - e.lastHitAt > ttlMs) {
      removeEntryFile(e.filePath);
      map.delete(key);
      expired++;
      freedBytes += e.bytes;
      continue;
    }
    let ok = false;
    try { ok = fs.statSync(e.filePath).size > 0; } catch {}
    if (!ok) {
      map.delete(key); // le fichier est parti (purge owner, nettoyage système…)
      missing++;
    }
  }

  // Cap LRU : éviction du plus anciennement utilisé, sauf liens vivants.
  let total = 0;
  for (const e of map.values()) total += e.bytes;
  if (total > reuseMaxBytes()) {
    const byLru = [...map.values()].sort((a, b) => a.lastHitAt - b.lastHitAt);
    for (const e of byLru) {
      if (total <= reuseMaxBytes()) break;
      if (isServedByVault(e.filePath)) continue;
      removeEntryFile(e.filePath);
      map.delete(e.key);
      total -= e.bytes;
      freedBytes += e.bytes;
      evicted++;
    }
  }

  // Orphelins du dossier (fichiers sans entrée — ex. index perdu).
  try {
    for (const f of fs.readdirSync(reuseDir())) {
      if (f.startsWith("index") || f.startsWith(".index")) continue;
      const p = path.join(reuseDir(), f);
      if (![...map.values()].some((e) => e.filePath === p)) removeEntryFile(p);
    }
  } catch {}

  saveIndex(map);
  return { expired, missing, evicted, freedBytes };
}

/** Purge complète (commande .purge owner) — fichiers + index. */
export function purgeAllMediaReuse(): void {
  try { fs.rmSync(reuseDir(), { recursive: true, force: true }); } catch {}
  cachedIndex = null;
  cachedIndexDir = "";
}

// ── Lookup / Store ─────────────────────────────────────────────────────────
let lastPruneAt = 0;

export function lookupMediaReuse(key: string): MediaReuseHit | null {
  if (!isReuseEnabled() || !key) return null;
  // Throttle : un prune toutes les 5 min max (le lookup reste O(1) sinon).
  const now = Date.now();
  if (now - lastPruneAt > 5 * 60 * 1000) {
    lastPruneAt = now;
    try { pruneMediaReuse(); } catch {}
  }
  const map = loadIndex();
  const e = map.get(key);
  if (!e) return null;
  const ttlMs = e.ttlMs && e.ttlMs > 0 ? e.ttlMs : reuseTtlHours() * 3600 * 1000;
  if (now - e.lastHitAt > ttlMs) return null; // expiré (le prune le nettoiera)
  let size = 0;
  try { size = fs.statSync(e.filePath).size; } catch { return null; } // parti → chemin normal
  if (size <= 0) return null;
  e.lastHitAt = now; // fenêtre glissante : cette utilisation relance la vie
  e.bytes = size;
  saveIndex(map);
  return { filePath: e.filePath, filename: e.filename, bytes: size };
}

/**
 * Insère un fichier public dans le cache (lien physique — zéro octet
 * supplémentaire). Best-effort : tout échec est silencieux, le téléchargement
 * vient de réussir, rien ne doit le bloquer.
 */
export function storeMediaReuse(
  key: string,
  sourcePath: string,
  filename: string,
  opts?: { ttlMs?: number }
): MediaReuseHit | null {
  if (!isReuseEnabled() || !key) return null;
  try {
    const size = fs.statSync(sourcePath).size;
    if (size <= 0) return null;
    const dir = reuseDir();
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(filename) || path.extname(sourcePath) || ".mp4";
    const target = path.join(dir, crypto.createHash("sha1").update(key).digest("hex") + ext);
    try {
      fs.linkSync(sourcePath, target); // même FS : gratuit
    } catch {
      // FS différent ou lien interdit → repli copie, seulement si le cap tient
      const map = loadIndex();
      let total = 0;
      for (const e of map.values()) total += e.bytes;
      if (total + size > reuseMaxBytes()) return null;
      fs.copyFileSync(sourcePath, target);
    }
    const now = Date.now();
    const map = loadIndex();
    const previous = map.get(key);
    if (previous && previous.filePath !== target) removeEntryFile(previous.filePath);
    const entry: MediaReuseEntry = {
      key,
      filePath: target,
      filename: String(filename || "media"),
      bytes: size,
      createdAt: previous?.createdAt || now,
      lastHitAt: now,
      ttlMs: opts?.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : undefined
    };
    map.set(key, entry);
    saveIndex(map);
    try { pruneMediaReuse(); } catch {} // cap appliqué juste après insertion
    return { filePath: target, filename: entry.filename, bytes: size };
  } catch (err: any) {
    console.warn(`[REUSE] insertion ignorée (${err?.message || err})`);
    return null;
  }
}

/** Stats pour logs/digest. */
export function mediaReuseStats(): { entries: number; totalMB: number; capMB: number; ttlHours: number; enabled: boolean } {
  const map = loadIndex();
  let total = 0;
  for (const e of map.values()) total += e.bytes;
  return {
    entries: map.size,
    totalMB: Math.round(total / 1024 / 1024),
    capMB: Math.round(reuseMaxBytes() / 1024 / 1024),
    ttlHours: reuseTtlHours(),
    enabled: isReuseEnabled()
  };
}
