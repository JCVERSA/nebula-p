/**
 * Cross-source episode fallback (audit 8.46, 2026-09-01).
 *
 * Production evidence: Vinland Saga S02E05 — the voiranime player resolved
 * to a single vidmoly mirror whose CDN node 403s EVERY path×referer from
 * the VPS (network-level block). With one mirror there is nothing to fall
 * back to inside the source. The secondary catalog (nakanime) is already
 * integrated, reachable from the VPS, lists SEVERAL players per episode
 * (often on different CDNs) and sometimes carries VF lists of its own.
 *
 * This module resolves, for a failed episode, the mirror list the secondary
 * catalog has for the same title/season/episode — VF-labeled lists first,
 * everything else as tier two. Language honesty is preserved: the caller
 * can map the URL that actually answered back to its list language.
 */

import { nakanimeSearch, nakanimeSeasons, nakanimeEpisodePlayersDetailed } from "./nakanimeClient.js";

export interface FallbackEpisodeAccess {
  lists: Record<number, string[]>;
  labels: Record<number, { host?: string; language?: string }>;
}

export interface FallbackDeps {
  search: (query: string) => Promise<Array<{ title?: string; url: string }>>;
  seasons: (animeUrl: string) => Promise<Array<{ name: string; subPath?: string; url: string }>>;
  players: (seasonUrl: string) => Promise<FallbackEpisodeAccess>;
}

export interface CrossSourceFallback {
  mirrors: string[];
  lists: Record<number, string[]>;
  labels: Record<number, { host?: string; language?: string }>;
  seasonUrl: string;
}

/** Same semantics as the main-flow VF detector (VF and not VOSTFR/VOST). */
export function isVfLangLabel(language: string | undefined): boolean {
  const l = (language || "").toUpperCase().replace(/\s+/g, "");
  return l.includes("VF") && !l.includes("VOSTFR") && !l.includes("VOST");
}

function normalizeTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best catalog match for the queried title (exact → prefix → substring → first). */
export function pickBestResult(results: Array<{ title?: string; url: string }>, title: string): { title?: string; url: string } | null {
  if (!results || results.length === 0) return null;
  const q = normalizeTitle(title);
  if (!q) return results[0];
  const scored = results.map(r => {
    const n = normalizeTitle(r.title || "");
    let score = 1;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 60;
    else if (q.length >= 6 && n.includes(q.slice(0, Math.floor(q.length * 0.8)))) score = 40;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 1 ? scored[0].r : null;
}

/**
 * Seasons of the secondary catalog matching the wanted season number,
 * ordered best-first: language-matching names, then language-neutral names,
 * then the rest. Never includes non-matching season numbers.
 */
export function pickCandidateSeasons(
  seasons: Array<{ name: string; subPath?: string; url: string }>,
  seasonNum: number,
  wantVf: boolean
): Array<{ name: string; subPath?: string; url: string }> {
  const matching = seasons.filter(s => {
    const digits = (s.name || "").match(/\d+/g) || [];
    return digits.some(d => parseInt(d, 10) === seasonNum);
  });
  const langScore = (name: string): number => {
    const n = (name || "").toUpperCase();
    const hasVf = /\bVF\b/.test(n) || n.includes("VF");
    const hasVost = n.includes("VOSTFR") || n.includes("VOST");
    if (wantVf && hasVf && !hasVost) return 0;
    if (!hasVf && !hasVost) return 1;
    return 2;
  };
  return matching.sort((a, b) => langScore(a.name) - langScore(b.name));
}

/**
 * Mirror URLs for one episode across all lists, VF/unlabeled lists first,
 * other languages as tier two. Positional semantics (list slot = episode
 * index), consistent with the main flow's splitMirrorsByLanguage.
 */
export function tierMirrorsForEpisode(
  lists: Record<number, string[]>,
  labels: Record<number, { host?: string; language?: string }>,
  epIndex: number,
  wantVf: boolean
): { primary: string[]; secondary: string[] } {
  const primary: string[] = [];
  const secondary: string[] = [];
  const hasLabels = !!labels && Object.keys(labels).length > 0;

  for (const listId of Object.keys(lists || {}).map(Number).sort((a, b) => a - b)) {
    const url = lists?.[listId]?.[epIndex];
    if (!url) continue;
    const listIsVf = hasLabels ? isVfLangLabel(labels[listId]?.language) : false;
    const bucket = listIsVf === wantVf || !hasLabels ? primary : secondary;
    if (!bucket.includes(url)) bucket.push(url);
  }
  return { primary, secondary };
}

/** Language of the list a successfully-downloaded URL belonged to (honesty). */
export function languageOfUrl(
  lists: Record<number, string[]>,
  labels: Record<number, { host?: string; language?: string }>,
  url: string
): string | null {
  for (const listId of Object.keys(lists || {}).map(Number)) {
    if ((lists[listId] || []).includes(url)) {
      const lang = labels?.[listId]?.language;
      if (lang) return isVfLangLabel(lang) ? "VF" : lang.toUpperCase();
      return null; // unlabeled list — language carried by the season itself
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolution with a small TTL cache (batches re-ask per episode).
// ---------------------------------------------------------------------------

const sourceCache = new Map<string, { at: number; entry: CrossSourceFallback | null }>();
const SOURCE_CACHE_TTL_MS = 10 * 60 * 1000;

export function clearFallbackCacheForTests(): void {
  sourceCache.clear();
}

/**
 * Search → seasons → episode lists on the secondary catalog. Cached per
 * title|season: one search + one seasons + one players fetch per batch.
 */
export async function resolveFallbackSource(
  title: string,
  seasonNum: number,
  wantVf: boolean,
  deps: FallbackDeps
): Promise<CrossSourceFallback | null> {
  const key = `${normalizeTitle(title)}|${seasonNum}`;
  const cached = sourceCache.get(key);
  if (cached && Date.now() - cached.at < SOURCE_CACHE_TTL_MS) return cached.entry;

  let entry: CrossSourceFallback | null = null;
  try {
    const results = await deps.search(title);
    const best = pickBestResult(results, title);
    if (best?.url) {
      const seasons = await deps.seasons(best.url);
      for (const season of pickCandidateSeasons(seasons, seasonNum, wantVf)) {
        const access = await deps.players(season.url);
        const listCount = Object.keys(access.lists || {}).length;
        if (listCount > 0) {
          entry = { mirrors: [], lists: access.lists, labels: access.labels, seasonUrl: season.url };
          break;
        }
      }
    }
  } catch {
    entry = null;
  }
  sourceCache.set(key, { at: Date.now(), entry });
  return entry;
}

/** Full convenience call: mirrors for ONE episode, best language first. */
export async function getCrossSourceFallbackMirrors(
  title: string,
  seasonNum: number,
  epIndex: number,
  wantLang: string,
  deps?: FallbackDeps
): Promise<CrossSourceFallback | null> {
  const wantVf = (wantLang || "VF").toUpperCase() === "VF";
  const resolved = await resolveFallbackSource(title, seasonNum, wantVf, deps || realDeps);
  if (!resolved) return null;
  const { primary, secondary } = tierMirrorsForEpisode(resolved.lists, resolved.labels, epIndex, wantVf);
  const mirrors = [...primary, ...secondary];
  if (mirrors.length === 0) return null;
  return { ...resolved, mirrors };
}

// ---------------------------------------------------------------------------
// Real wiring (injected for tests).
// ---------------------------------------------------------------------------

const realDeps: FallbackDeps = {
  search: query => nakanimeSearch(query),
  seasons: animeUrl => nakanimeSeasons(animeUrl),
  players: seasonUrl => nakanimeEpisodePlayersDetailed(seasonUrl)
};
