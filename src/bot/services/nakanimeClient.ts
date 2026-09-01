import axios from "axios";
import { isSafeDownloadUrl } from "../urlSafety.js";
import { animeProxyOptions } from "./scrapingProxy.js";

/**
 * nakanime.tv fallback client.
 *
 * nakanime is a content mirror of anime-sama (same catalog, same player
 * ecosystem) with a different API surface: JSON endpoints whose bodies are
 * XOR-encrypted with a key derived from the request path. It is often NOT
 * blocked by the same Cloudflare rules that 403 anime-sama on datacenter
 * IPs, so the bot uses it as an automatic fallback source when anime-sama is
 * unreachable (see ANIME_DOWNLOAD_AUDIT.md, finding R3).
 *
 * Endpoints (key-derivation path must match the request path byte-for-byte):
 *   GET  /api/catalog/search?q=<enc>&sort=relevance&page=1&per_page=32
 *   GET  /api/anime/<id>/episodes
 *   POST /api/sources/anime   {"anime_id","episode_id","turnstile_token":""}
 */

const NAKANIME_ORIGIN = "https://nakanime.tv";
const XORMAGIC = "nkapiv1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Upper bound on per-season episode source lookups (guards "all" downloads). */
// Covers full modern seasons (Re:ZERO s5 lists 80 episodes; 100+ exist as
// cour bundles). Lookup cost stays bounded by LOOKUP_CONCURRENCY below.
const MAX_EPISODE_LOOKUPS = 120;
const LOOKUP_CONCURRENCY = 4;

/** Derives the 32-byte XOR key for a given request path (incl. query string). */
export function deriveNakanimeKey(pathWithQuery: string): Buffer {
  const n = XORMAGIC + pathWithQuery;
  const key = Buffer.alloc(32);
  for (let v = 0; v < 32; v++) {
    let g = 0;
    for (let q = 0; q < n.length; q++) {
      g = (g * 31 + n.charCodeAt(q) + v) & 255;
    }
    key[v] = g;
  }
  return key;
}

/** Decrypts a nakanime API body and returns the plaintext UTF-8 string. */
export function decodeNakanimeResponse(body: Buffer, pathWithQuery: string): string | null {
  try {
    const key = deriveNakanimeKey(pathWithQuery);
    const out = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) {
      out[i] = body[i] ^ key[i % key.length];
    }
    return out.toString("utf8");
  } catch {
    return null;
  }
}

export function isNakanimeUrl(url: string): boolean {
  return typeof url === "string" && url.toLowerCase().includes("nakanime.tv");
}

async function nakanimeGetBytes(pathWithQuery: string, timeout = 10000): Promise<Buffer | null> {
  const url = `${NAKANIME_ORIGIN}${pathWithQuery}`;
  if (!(await isSafeDownloadUrl(url).catch(() => false))) return null;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": UA, Accept: "*/*", Referer: `${NAKANIME_ORIGIN}/` },
      timeout,
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200,
      ...animeProxyOptions()
    });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface NakanimeSearchResult {
  title: string;
  subtitle: string;
  url: string; // https://nakanime.tv/anime/<id>/<slug>
}

export async function nakanimeSearch(query: string): Promise<NakanimeSearchResult[]> {
  const eq = encodeURIComponent(query.trim());
  const path = `/api/catalog/search?q=${eq}&sort=relevance&page=1&per_page=32`;
  const body = await nakanimeGetBytes(path);
  if (!body) return [];
  const text = decodeNakanimeResponse(body, path);
  if (!text) return [];
  try {
    const json = JSON.parse(text);
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    return items
      .filter((it) => it?.id && it?.slug)
      .slice(0, 12)
      .map((it) => ({
        title: String(it.title || it.slug),
        subtitle: String(it.language || it.type || ""),
        url: `${NAKANIME_ORIGIN}/anime/${it.id}/${it.slug}`
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export interface NakanimeEpisodeRef {
  number: number;
  id?: number;
}

interface SeasonCacheEntry {
  numbers: number[];
  episodesBySeason: Map<number, NakanimeEpisodeRef[]>;
}

const seasonCache = new Map<string, SeasonCacheEntry>();

/**
 * Parses the embedded JSON `<script>` of a nakanime episode page:
 * `{ animeId, seasons: [{ number, episodes: [{ number, id? }] }] }`.
 * Exported for tests.
 */
export function parseNakanimeSeasonsScript(html: string): Map<number, NakanimeEpisodeRef[]> {
  const out = new Map<number, NakanimeEpisodeRef[]>();
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const raw of scripts) {
    const body = raw.replace(/<\/?script[^>]*>/gi, "").trim();
    if (!body.includes("animeId") || !body.includes("seasons")) continue;
    try {
      const data = JSON.parse(body);
      for (const season of data?.seasons || []) {
        const num = Number(season?.number);
        if (!Number.isFinite(num)) continue;
        const eps: NakanimeEpisodeRef[] = (season?.episodes || [])
          .map((e: any) => ({ number: Number(e?.number), id: e?.id !== undefined ? Number(e.id) : undefined }))
          .filter((e: NakanimeEpisodeRef) => Number.isFinite(e.number));
        out.set(num, eps);
      }
      if (out.size > 0) break;
    } catch {
      // try next script
    }
  }
  return out;
}

async function loadSeasonIndex(animeId: number): Promise<SeasonCacheEntry | null> {
  const cacheKey = String(animeId);
  const cached = seasonCache.get(cacheKey);
  if (cached) return cached;

  // 1) Embedded seasons script on the season/1/episode/1 page
  try {
    const pagePath = `/anime/${animeId}/season/1/episode/1`;
    const url = `${NAKANIME_ORIGIN}${pagePath}`;
    if (await isSafeDownloadUrl(url).catch(() => false)) {
      const resp = await axios.get(url, {
        headers: { "User-Agent": UA, Referer: `${NAKANIME_ORIGIN}/` },
        timeout: 10000,
        validateStatus: (s) => s === 200,
        ...animeProxyOptions()
      });
      const bySeason = parseNakanimeSeasonsScript(typeof resp.data === "string" ? resp.data : "");
      if (bySeason.size > 0) {
        const entry: SeasonCacheEntry = {
          numbers: [...bySeason.keys()].sort((a, b) => a - b),
          episodesBySeason: bySeason
        };
        seasonCache.set(cacheKey, entry);
        return entry;
      }
    }
  } catch {}

  // 2) Fallback: encrypted episodes API
  const epsPath = `/api/anime/${animeId}/episodes`;
  const body = await nakanimeGetBytes(epsPath, 15000);
  if (body) {
    const text = decodeNakanimeResponse(body, epsPath);
    if (text) {
      try {
        const json = JSON.parse(text);
        const items: any[] = Array.isArray(json?.data) ? json.data : [];
        const bySeason = new Map<number, NakanimeEpisodeRef[]>();
        for (const it of items) {
          const s = Number(it?.seasonNumber ?? 1) || 1;
          const ep: NakanimeEpisodeRef = { number: Number(it?.number ?? 1) || 1 };
          if (!bySeason.has(s)) bySeason.set(s, []);
          bySeason.get(s)!.push(ep);
        }
        for (const [, eps] of bySeason) eps.sort((a, b) => a.number - b.number);
        if (bySeason.size > 0) {
          const entry: SeasonCacheEntry = {
            numbers: [...bySeason.keys()].sort((a, b) => a - b),
            episodesBySeason: bySeason
          };
          seasonCache.set(cacheKey, entry);
          return entry;
        }
      } catch {}
    }
  }
  return null;
}

/** Season list in the exact shape the novabox session expects. */
export async function nakanimeSeasons(animeUrl: string): Promise<Array<{ name: string; subPath: string; url: string }>> {
  const m = animeUrl.match(/\/anime\/(\d+)/);
  if (!m) return [];
  const animeId = Number(m[1]);
  const index = await loadSeasonIndex(animeId);
  if (!index) return [];
  return index.numbers.map((n) => ({
    name: `Saison ${n}`,
    subPath: `season/${n}`,
    // Trailing slash so `season.url + "episodes.js"` builds a clean URL
    // (novabox concatenates directly; anime-sama season URLs end with "/").
    url: `${NAKANIME_ORIGIN}/anime/${animeId}/season/${n}/`
  }));
}

/**
 * Normalizes raw episode refs for stable POSITIONAL indexing: valid numbers
 * only, sorted ascending, deduplicated. anime-sama's epsN arrays are
 * positional, so the bot's episode index must depend neither on the DOM
 * order of nakanime's season script (newest-first listings produced empty
 * low-number slots — audit §8.2) nor on number contiguity.
 */
export function normalizeNakanimeEpisodeRefs(refs: NakanimeEpisodeRef[]): NakanimeEpisodeRef[] {
  const seen = new Set<number>();
  const out: NakanimeEpisodeRef[] = [];
  const sorted = (refs || []).slice().sort((a, b) => a.number - b.number);
  for (const r of sorted) {
    if (!Number.isFinite(r.number) || r.number <= 0) continue;
    if (seen.has(r.number)) continue;
    seen.add(r.number);
    out.push(r);
  }
  return out;
}

/** Diagnostic helper (scripts/anime-repro.ts): sorted episode numbers of a season. */
export async function nakanimeSeasonRefNumbers(animeUrl: string, season: number): Promise<number[]> {
  const m = animeUrl.match(/\/anime\/(\d+)/);
  if (!m) return [];
  const index = await loadSeasonIndex(Number(m[1]));
  if (!index) return [];
  return normalizeNakanimeEpisodeRefs(index.episodesBySeason.get(season) || []).map((r) => r.number);
}

// ---------------------------------------------------------------------------
// Episode players
// ---------------------------------------------------------------------------

async function fetchEpisodePlayerUrls(
  animeId: number,
  season: number,
  ep: NakanimeEpisodeRef
): Promise<Array<{ host: string; language: string; url: string }>> {
  try {
    let episodeId = ep.id;
    if (!episodeId) {
      const pagePath = `/anime/${animeId}/season/${season}/episode/${ep.number}`;
      const pageUrl = `${NAKANIME_ORIGIN}${pagePath}`;
      if (!(await isSafeDownloadUrl(pageUrl).catch(() => false))) return [];
      const resp = await axios.get(pageUrl, {
        headers: { "User-Agent": UA, Referer: `${NAKANIME_ORIGIN}/` },
        timeout: 10000,
        validateStatus: (s) => s === 200,
        ...animeProxyOptions()
      });
      const html = typeof resp.data === "string" ? resp.data : "";
      const m = html.match(/data-episode-id=["'](\d+)["']/i);
      if (!m) return [];
      episodeId = Number(m[1]);
    }

    const srcPath = "/api/sources/anime";
    const srcUrl = `${NAKANIME_ORIGIN}${srcPath}`;
    if (!(await isSafeDownloadUrl(srcUrl).catch(() => false))) return [];
    const resp = await axios.post(
      srcUrl,
      { anime_id: animeId, episode_id: episodeId, turnstile_token: "" },
      {
        headers: { "User-Agent": UA, "Content-Type": "application/json", Referer: `${NAKANIME_ORIGIN}/` },
        timeout: 10000,
        responseType: "arraybuffer",
        validateStatus: (s) => s === 200,
        ...animeProxyOptions()
      }
    );
    const text = decodeNakanimeResponse(Buffer.from(resp.data), srcPath);
    if (!text) return [];
    const json = JSON.parse(text);
    const items: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    return items
      .filter((it) => typeof it?.url === "string" && it.url.startsWith("http"))
      .map((it) => ({ host: String(it.host || "lecteur"), language: String(it.language || ""), url: it.url }));
  } catch {
    return [];
  }
}

/**
 * Player URLs for every episode of a season, in the exact shape the novabox
 * session expects: `{ <listNumber>: [urlByEpisodeIndex] }` — list numbers are
 * stable per host+language ("Lecteur 1..N"), mirroring anime-sama's epsN.
 * `labels` carries the host+language of each list so the bot can prefer VF
 * player lists (VF-by-default policy, audit §8.3).
 */
export interface NakanimeListLabels {
  [listNum: number]: { host: string; language: string };
}

// Short-TTL cache: player lists are stable enough for consecutive commands on
// the same season (retries, batch follow-ups) — skips up to 120 episode-source
// lookups per command (audit 8.5).
const playersCache = new Map<string, { at: number; entry: { lists: Record<number, string[]>; labels: NakanimeListLabels } }>();
const PLAYERS_CACHE_TTL_MS = 10 * 60 * 1000;

export function clearNakanimePlayersCache(): void {
  playersCache.clear();
}

export async function nakanimeEpisodePlayersDetailed(
  seasonUrl: string
): Promise<{ lists: Record<number, string[]>; labels: NakanimeListLabels }> {
  const cacheKey = seasonUrl.replace(/\/$/, "").toLowerCase();
  const hit = playersCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PLAYERS_CACHE_TTL_MS) {
    return hit.entry;
  }
  const idMatch = seasonUrl.match(/\/anime\/(\d+)/);
  const seasonMatch = seasonUrl.match(/\/season\/(\d+)/);
  if (!idMatch) return { lists: {}, labels: {} };
  const animeId = Number(idMatch[1]);
  const season = seasonMatch ? Number(seasonMatch[1]) : 1;

  const index = await loadSeasonIndex(animeId);
  if (!index) return { lists: {}, labels: {} };
  // Positional semantics (anime-sama parity): list slot i holds the player of
  // the i-th episode of the season listing, NOT episode-number-1 — nakanime's
  // script order is not guaranteed ascending (see normalizeNakanimeEpisodeRefs).
  const eps = normalizeNakanimeEpisodeRefs(index.episodesBySeason.get(season) || []).slice(0, MAX_EPISODE_LOOKUPS);
  if (eps.length === 0) return { lists: {}, labels: {} };

  const listKeys = new Map<string, number>(); // "host (lang)" -> list number
  const labels: NakanimeListLabels = {};
  const lists: Record<number, string[]> = {};

  let cursor = 0;
  const worker = async () => {
    while (cursor < eps.length) {
      const epIndex = cursor++;
      const ep = eps[epIndex];
      const sources = await fetchEpisodePlayerUrls(animeId, season, ep);
      for (const src of sources) {
        const key = `${src.host} (${src.language})`.toLowerCase();
        if (!listKeys.has(key)) listKeys.set(key, listKeys.size + 1);
        const listNum = listKeys.get(key)!;
        if (!lists[listNum]) lists[listNum] = [];
        lists[listNum][epIndex] = src.url;
        labels[listNum] = { host: src.host, language: src.language };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, eps.length) }, () => worker()));

  // Fill holes with "" so episode counts stay accurate for the resolver.
  for (const k of Object.keys(lists)) {
    const n = Number(k);
    for (let i = 0; i < eps.length; i++) {
      if (!lists[n][i]) lists[n][i] = lists[n][i] || "";
    }
  }
  const entry = { lists, labels };
  playersCache.set(cacheKey, { at: Date.now(), entry });
  return entry;
}

/** Back-compat wrapper: player lists only (labels-less callers, tests, repro). */
export async function nakanimeEpisodePlayers(seasonUrl: string): Promise<Record<number, string[]>> {
  return (await nakanimeEpisodePlayersDetailed(seasonUrl)).lists;
}
