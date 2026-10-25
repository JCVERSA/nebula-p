/**
 * 9.18nnnn (P2) — client LRCLIB (https://lrclib.net), paroles sans clé API.
 *
 * Contraintes du rapport R&D 24/10 :
 *  - API libre, GRATUITE, sans clé ; User-Agent obligatoire (politesse) ;
 *  - 429 avec Retry-After → réponse honnête « réessaie », jamais de retry
 *    agressif (anti-ban) ;
 *  - best-effort par contrat : tout échec se résout en outcome typé, la
 *    commande n'a JAMAIS à try/catcher le réseau.
 *
 * Points d'entrée LRCLIB :
 *  - GET /api/get?track_name=&artist_name=&duration=  → objet unique (404
 *    si absent) — correspondance exacte ;
 *  - GET /api/search?q=…                              → liste floue.
 *
 * Chaque résultat expose plainLyrics (lisible) et/ou syncedLyrics (format
 * LRC horodaté). Pour WhatsApp on veut du TEXTE : plainLyrics en priorité,
 * sinon les horodatages sont retirés de syncedLyrics.
 *
 * Cache 10 min (100 entrées max, même discipline que jikanClient) :
 * une recherche de paroles répétée ne re-frappe pas l'API.
 */

const LRCLIB_BASE = "https://lrclib.net";
const USER_AGENT = "NebulaBot/9.18 (self-hosted WhatsApp bot)";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

export interface LyricsHit {
  track: string;
  artist: string;
  /** Paroles lisibles (jamais de timestamp LRC). */
  lyrics: string;
}

export type LyricsOutcome =
  | { kind: "found"; hit: LyricsHit }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "error" };

interface CacheEntry {
  ts: number;
  outcome: LyricsOutcome;
}

const cache = new Map<string, CacheEntry>();

interface LrcLibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

// ── Helpers purs (testés) ───────────────────────────────────────────────────

/** Retire les horodatages LRC ([00:12.34], métadonnées [ar:]…) — reste lisible. */
export function stripLrcTimestamps(lrc: string): string {
  return String(lrc || "")
    .split("\n")
    .filter(line => !/^\s*\[(ar|ti|al|by|offset|length|re|ve|tool):/i.test(line))
    .map(line => line.replace(/\[[0-9]+:[0-9.]+]\s*/g, "").replace(/\[[0-9]+:[0-9.]+]/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nettoie un titre YouTube (« Song (Official Video) » → « Song »). */
export function cleanTrackTitle(title: string): string {
  return String(title || "")
    .replace(/\((?:official\s+)?(?:music\s+)?(?:video|audio|visualizer|lyrics?|lyric\s+video|mv|hd|4k)[^)]*\)/gi, "")
    .replace(/\[(?:official\s+)?(?:video|audio|lyrics?|hd|4k|mv)[^\]]*]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** « Artist - Track » → { artist, track } ; sinon { track } seul. */
export function parseArtistTrack(title: string): { artist?: string; track: string } {
  const cleaned = cleanTrackTitle(title);
  const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && m[1].trim().length > 1 && m[2].trim().length > 1) {
    return { artist: m[1].trim(), track: m[2].trim() };
  }
  return { track: cleaned };
}

// ── Réseau (best effort) ────────────────────────────────────────────────────

async function lrclibFetch(path: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${LRCLIB_BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 429) return { status: 429, body: null };
    if (!res.ok) return { status: res.status, body: null };
    return { status: 200, body: await res.json() };
  } catch {
    return null; // timeout / DNS / réseau — jamais une exception
  }
}

function pickReadableLyrics(rec: LrcLibRecord): string | null {
  const plain = String(rec.plainLyrics || "").trim();
  if (plain) return plain;
  const synced = stripLrcTimestamps(String(rec.syncedLyrics || ""));
  return synced.length > 10 ? synced : null;
}

function cacheGet(key: string): LyricsOutcome | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.outcome;
}

function cacheSet(key: string, outcome: LyricsOutcome): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { ts: Date.now(), outcome });
}

export interface LyricsQuery {
  /** Recherche floue (texte libre). */
  query?: string;
  /** Titre + artiste connus → correspondance exacte d'abord. */
  track?: string;
  artist?: string;
  /** Durée en secondes (affine /api/get, tolérance serveur ±2 s). */
  durationSec?: number;
}

/**
 * Cherche des paroles. Stratégie :
 *  1. titre + artiste connus → /api/get (exact), puis /api/search en repli ;
 *  2. sinon → /api/search?q=<query>.
 * Le premier résultat LISIBLE (plainLyrics, sinon synced nettoyé) gagne.
 */
export async function findLyrics(q: LyricsQuery): Promise<LyricsOutcome> {
  const key = JSON.stringify(q);
  const cached = cacheGet(key);
  if (cached) return cached;

  let outcome: LyricsOutcome = { kind: "not_found" };

  if (q.track && q.artist) {
    const params = new URLSearchParams({ track_name: q.track, artist_name: q.artist });
    if (q.durationSec && Number.isFinite(q.durationSec) && q.durationSec > 0) {
      params.set("duration", String(Math.round(q.durationSec)));
    }
    const exact = await lrclibFetch(`/api/get?${params.toString()}`);
    if (exact?.status === 429) return rateLimited(key);
    if (exact === null) return { kind: "error" }; // réseau mort → honnête, pas « introuvable »
    if (exact?.status === 200) {
      const rec = exact.body as LrcLibRecord;
      const lyrics = pickReadableLyrics(rec);
      if (lyrics) {
        outcome = {
          kind: "found",
          hit: { track: String(rec.trackName || q.track), artist: String(rec.artistName || q.artist), lyrics },
        };
      }
    }
  }

  if (outcome.kind === "not_found") {
    const searchQuery = q.query || (q.artist && q.track ? `${q.artist} ${q.track}` : q.track ? q.track : "");
    if (searchQuery) {
      const search = await lrclibFetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (search?.status === 429) return rateLimited(key);
      if (search === null) return { kind: "error" }; // réseau mort → honnête, pas « introuvable »
      if (search?.status === 200 && Array.isArray(search.body)) {
        for (const rec of search.body as LrcLibRecord[]) {
          const lyrics = pickReadableLyrics(rec);
          if (lyrics) {
            outcome = {
              kind: "found",
              hit: { track: String(rec.trackName || searchQuery), artist: String(rec.artistName || "—"), lyrics },
            };
            break;
          }
        }
      }
    }
  }

  cacheSet(key, outcome);
  return outcome;
}

function rateLimited(key: string): LyricsOutcome {
  // 429 : PAS de mise en cache long (le quota revient vite) mais pas de
  // retry non plus — une réponse honnête, l'utilisateur réessaie.
  const outcome: LyricsOutcome = { kind: "rate_limited" };
  cache.set(key, { ts: Date.now() - CACHE_TTL_MS + 30_000, outcome }); // cache 30 s seulement
  return outcome;
}

/** Tests uniquement : vide le cache. */
export function __resetLrclibCacheForTests(): void {
  cache.clear();
}
