/**
 * ============================================================================
 *  FRAnime client — franime.fr (VF-first catalog, audit §8.7)
 * ============================================================================
 *  Ground truth (verified 2026-08-31 from the production VPS):
 *   - GET https://api.franime.fr/api/animes/  -> 200, ~10.8 MB JSON catalog,
 *     NO Cloudflare challenge. Contains, per anime: seasons -> episodes ->
 *     lang.vf.lecteurs[] / lang.vo.lecteurs[] (player NAMES per language).
 *     This is a reliable VF/VOSTFR ground truth per episode (unlike nakanime's
 *     per-list language labels, which proved wrong — audit §8.6).
 *   - GET /api/anime/{id}/{season0}/{ep0}/{vf|vo}/{lecteurIndex} -> the player
 *     URL as plain text, BUT fronted by a Cloudflare MANAGED challenge on
 *     datacenter IPs ("Just a moment..."). With Referer + browser UA it still
 *     challenges. Solution: optional FlareSolverr (FLARESOLVERR_URL env) which
 *     solves the challenge once and hands us cf_clearance (+ matching UA) that
 *     we attach to subsequent requests.
 *
 *  Everything degrades gracefully: no solver -> episode URLs unavailable ->
 *  callers fall back to the nakanime path.
 */

import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { animeProxyOptions } from "./scrapingProxy.js";

const FRANIME_API = "https://api.franime.fr";
const CATALOG_URL = `${FRANIME_API}/api/animes/`;
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_CACHE = path.join(os.tmpdir(), "franime-catalog.json");
const FRANIME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0 Gecko/20100101 Firefox/131.0";
const EPISODE_TIMEOUT_MS = 10000;
const MAX_LECTEURS = 10;

export function isFranimeRef(url: string): boolean {
  return (url || "").startsWith("franime:");
}

/** Parses "franime:<animeId>" into the numeric catalog id. */
export function parseFranimeAnimeRef(url: string): number | null {
  const m = (url || "").match(/^franime:(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Parses "franime:<animeId>/<seasonIndex>" (season index is 0-based). */
export function parseFranimeSeasonRef(url: string): { animeId: number; seasonIndex: number } | null {
  const m = (url || "").match(/^franime:(\d+)\/(\d+)$/);
  return m ? { animeId: Number(m[1]), seasonIndex: Number(m[2]) } : null;
}

// --------------------------------------------------------------------------- catalog

export interface FranimeCatalogEpisode {
  title?: string;
  lecteursVf: string[];
  lecteursVo: string[];
}
export interface FranimeCatalogSeason {
  title: string;
  episodes: FranimeCatalogEpisode[];
}
interface FranimeCatalogAnime {
  id: number;
  titleO?: string;
  title?: string;
  titles?: Record<string, string>;
  saisons?: Array<{
    title?: string;
    episodes?: Array<{ title?: string; lang?: { vf?: { lecteurs?: string[] }; vo?: { lecteurs?: string[] } } }>;
  }>;
}

let catalogCache: { at: number; animes: FranimeCatalogAnime[] } | null = null;

function normalizeTitle(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function catalogAnimeTitles(a: FranimeCatalogAnime): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s === "string" && s.trim()) out.push(s.trim());
  };
  push(a.title);
  push(a.titleO);
  if (a.titles) {
    for (const k of ["fr_fr", "en", "en_us", "en_jp", "ja_jp", "romanji"]) push((a.titles as any)[k]);
  }
  return out;
}

/** Parses the raw catalog JSON into the internal shape (exported for tests). */
export function parseFranimeCatalog(raw: any): FranimeCatalogAnime[] {
  const list: FranimeCatalogAnime[] = Array.isArray(raw) ? raw : [];
  return list.filter((a) => a && typeof a.id === "number");
}

async function loadCatalog(): Promise<FranimeCatalogAnime[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.animes;

  // Disk cache first (10.8 MB download is worth avoiding for 6 h)
  try {
    const st = fs.statSync(CATALOG_CACHE);
    if (Date.now() - st.mtimeMs < CATALOG_TTL_MS) {
      const animes = parseFranimeCatalog(JSON.parse(fs.readFileSync(CATALOG_CACHE, "utf8")));
      if (animes.length > 0) {
        catalogCache = { at: st.mtimeMs, animes };
        return animes;
      }
    }
  } catch {}

  const resp = await axios.get(CATALOG_URL, {
    headers: { "User-Agent": FRANIME_UA, Accept: "application/json", Referer: "https://franime.fr/" },
    timeout: 30000,
    responseType: "json",
    ...animeProxyOptions()
  });
  const animes = parseFranimeCatalog(resp.data);
  if (animes.length === 0) throw new Error("franime catalog came back empty");
  catalogCache = { at: Date.now(), animes };
  try {
    fs.writeFileSync(CATALOG_CACHE, JSON.stringify(resp.data));
  } catch {}
  return animes;
}

export function clearFranimeCache(): void {
  catalogCache = null;
  try {
    fs.unlinkSync(CATALOG_CACHE);
  } catch {}
}

// --------------------------------------------------------------------------- search

export interface FranimeSearchResult {
  title: string;
  subtitle: string;
  url: string; // "franime:<id>"
  id: number;
}

/** Local, fuzzy title search over the catalog (no per-query network hit). */
export async function franimeSearch(query: string, limit = 8): Promise<FranimeSearchResult[]> {
  const animes = await loadCatalog();
  const q = normalizeTitle(query);
  if (!q) return [];
  const scored: Array<{ score: number; r: FranimeSearchResult }> = [];
  for (const a of animes) {
    const titles = catalogAnimeTitles(a);
    let best = 0;
    for (const t of titles) {
      const n = normalizeTitle(t);
      if (!n) continue;
      if (n === q) best = Math.max(best, 100);
      else if (n.startsWith(q)) best = Math.max(best, 80);
      else if (n.includes(q)) best = Math.max(best, 60);
      else if (q.length >= 6 && n.includes(q.slice(0, Math.floor(q.length * 0.8)))) best = Math.max(best, 40);
    }
    if (best > 0) {
      const seasonCount = a.saisons?.length || 0;
      scored.push({
        score: best,
        r: {
          title: a.title || a.titleO || titles[0] || `Anime #${a.id}`,
          subtitle: seasonCount > 0 ? `${seasonCount} saison(s) — VF` : "VF",
          url: `franime:${a.id}`,
          id: a.id
        }
      });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((s) => s.r);
}

// --------------------------------------------------------------------------- seasons

/** Seasons of a franime anime, in novabox's shape (url is a franime: ref). */
export async function franimeSeasons(animeId: number): Promise<Array<{ name: string; subPath: string; url: string }>> {
  const animes = await loadCatalog();
  const a = animes.find((x) => x.id === animeId);
  if (!a || !a.saisons) return [];
  return a.saisons.map((s, i) => ({
    name: s.title || `Saison ${i + 1}`,
    subPath: `${i}`,
    url: `franime:${animeId}/${i}`
  }));
}

/** Parsed season view (episode count + per-episode lecteur names). */
export async function franimeSeasonInfo(
  animeId: number,
  seasonIndex: number
): Promise<{ name: string; episodes: FranimeCatalogEpisode[] } | null> {
  const animes = await loadCatalog();
  const a = animes.find((x) => x.id === animeId);
  const s = a?.saisons?.[seasonIndex];
  if (!s) return null;
  const episodes: FranimeCatalogEpisode[] = (s.episodes || []).map((e) => ({
    title: e.title,
    lecteursVf: (e.lang?.vf?.lecteurs || []).slice(0, MAX_LECTEURS),
    lecteursVo: (e.lang?.vo?.lecteurs || []).slice(0, MAX_LECTEURS)
  }));
  return { name: s.title || `Saison ${seasonIndex + 1}`, episodes };
}

// --------------------------------------------------------------------------- episode players

export interface FranimePlayerSource {
  host: string; // lecteur name from the catalog (sibnet, vidmoly, ...)
  language: "VF" | "VOSTFR";
  url: string;
}

// Clearance state obtained via FlareSolverr (per session, IP-bound).
let clearance: { cookie: string; userAgent: string; at: number } | null = null;
const CLEARANCE_TTL_MS = 30 * 60 * 1000;

/** True when the body looks like a Cloudflare interstitial (exported for tests). */
export function isCloudflareChallenge(body: string): boolean {
  return (
    typeof body === "string" &&
    body.length > 0 &&
    (body.includes("Just a moment") || body.includes("_cf_chl_opt") || body.includes("challenges.cloudflare.com"))
  );
}

/**
 * Extracts the plain player URL from an episode-endpoint response body
 * (exported for tests). Supports plain-text URLs and simple JSON wrappers.
 */
export function parseFranimePlayerBody(body: string): string | null {
  if (!body || typeof body !== "string") return null;
  const t = body.trim();
  if (t.startsWith("http") && !t.includes("<")) return t.split(/\s+/)[0];
  try {
    const j = JSON.parse(t);
    const u = j?.url || j?.source || j?.link || j?.player || j?.embed;
    if (typeof u === "string" && u.startsWith("http")) return u;
  } catch {}
  const m = t.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

/**
 * Solves the api.franime.fr Cloudflare challenge once via FlareSolverr
 * (FLARESOLVERR_URL, e.g. http://localhost:8191). Returns false when no
 * solver is configured or the solve failed.
 */
export async function solveFranimeChallengeViaFlareSolverr(sampleUrl: string): Promise<boolean> {
  const solverUrl = process.env.FLARESOLVERR_URL || "";
  if (!solverUrl) return false;
  try {
    const resp = await axios.post(
      solverUrl,
      {
        cmd: "request.get",
        url: sampleUrl,
        maxTimeout: 60000
      },
      { headers: { "Content-Type": "application/json" }, timeout: 70000 }
    );
    const solution = resp.data?.status === "ok" ? resp.data?.solution : null;
    const cookies: any[] = Array.isArray(solution?.cookies) ? solution.cookies : [];
    const cfClearance = cookies.find((c) => c?.name === "cf_clearance");
    if (cfClearance?.value && solution?.userAgent) {
      clearance = {
        cookie: `cf_clearance=${cfClearance.value}`,
        userAgent: String(solution.userAgent),
        at: Date.now()
      };
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function franimeHeaders(extraUrl: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": (clearance && Date.now() - clearance.at < CLEARANCE_TTL_MS ? clearance.userAgent : FRANIME_UA),
    Referer: "https://franime.fr/",
    Accept: "*/*"
  };
  if (clearance && Date.now() - clearance.at < CLEARANCE_TTL_MS) {
    h["Cookie"] = clearance.cookie;
  }
  return h;
}

async function fetchEpisodePlayerUrl(animeId: number, s: number, e: number, lang: string, lecteurIdx: number): Promise<string | null> {
  const url = `${FRANIME_API}/api/anime/${animeId}/${s}/${e}/${lang}/${lecteurIdx}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await axios.get(url, {
        headers: franimeHeaders(url),
        timeout: EPISODE_TIMEOUT_MS,
        responseType: "text",
        validateStatus: () => true,
        ...animeProxyOptions()
      });
      const body = typeof resp.data === "string" ? resp.data : String(resp.data ?? "");
      if (resp.status === 200 && !isCloudflareChallenge(body)) {
        return parseFranimePlayerBody(body);
      }
      if (isCloudflareChallenge(body) && attempt === 0) {
        const solved = await solveFranimeChallengeViaFlareSolverr(url);
        if (!solved) return null;
        continue; // retry with clearance
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface FranimeEpisodePlayersResult {
  players: FranimePlayerSource[];
  challenged: boolean; // true when the API was CF-blocked and no solver passed
}

/**
 * Resolves the player URLs of ONE episode in the given language. Issues one
 * request per lecteur (bounded by MAX_LECTEURS), concurrency 4.
 */
export async function franimeEpisodePlayers(
  animeId: number,
  seasonIndex: number,
  episodeIndex: number,
  lang: "vf" | "vo" = "vf"
): Promise<FranimeEpisodePlayersResult> {
  const info = await franimeSeasonInfo(animeId, seasonIndex);
  if (!info) return { players: [], challenged: false };
  const ep = info.episodes[episodeIndex];
  if (!ep) return { players: [], challenged: false };
  const lecteurs = lang === "vf" ? ep.lecteursVf : ep.lecteursVo;
  if (lecteurs.length === 0) return { players: [], challenged: false };

  const players: FranimePlayerSource[] = [];
  let challenged = false;
  let cursor = 0;
  const worker = async () => {
    while (cursor < lecteurs.length) {
      const i = cursor++;
      const url = await fetchEpisodePlayerUrl(animeId, seasonIndex, episodeIndex, lang, i);
      if (url) {
        players.push({ host: lecteurs[i], language: lang === "vf" ? "VF" : "VOSTFR", url });
      } else if (!clearance) {
        challenged = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, lecteurs.length) }, () => worker()));
  return { players, challenged };
}
