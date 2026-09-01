/**
 * Jikan client — unofficial MyAnimeList API (https://jikan.moe, no key).
 *
 * Powers the `.anime <title>` info cards and the Novabox season-screen poster
 * enrichment (audit 8.19). Design constraints:
 * - NO API key, but rate limited (~3 req/s, 60/min): every response is cached
 *   for 10 minutes and callers fire at most one request per user action.
 * - Best-effort by contract: every failure resolves to null / [] so the bot
 *   flow never breaks because MyAnimeList is down.
 * - Pure helpers (normalizeTitle, pickBestMatch, formatAnimeCard) are exported
 *   for unit tests.
 */

export interface JikanAnimeInfo {
  malId: number;
  title: string;
  englishTitle?: string;
  posterUrl?: string;
  score?: number;
  scoredBy?: number;
  episodes?: number;
  type?: string;
  status?: string;
  year?: number;
  genres: string[];
  synopsis?: string;
  url?: string;
}

const JIKAN_BASE = "https://api.jikan.moe/v4";
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const FETCH_TIMEOUT_MS = 8000;

interface CacheEntry {
  ts: number;
  data: JikanAnimeInfo[];
}
const searchCache = new Map<string, CacheEntry>();

/** Lowercase, strip accents/punctuation, drop VF/VOSTFR/season noise tokens. */
export function normalizeTitle(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(vf|vostfr)\b/g, " ") // language tags anywhere
    .replace(/\b(saison|season|s)\s*\d+\b/g, " ") // season markers ("Saison 2", "S1")
    .replace(/\b(vo|tv)\b\s*$/g, " ") // trailing source tags only
    .replace(/\s+/g, " ")
    .trim();
}

function mapAnimeEntry(entry: any): JikanAnimeInfo {
  return {
    malId: entry?.mal_id ?? 0,
    title: entry?.title || entry?.title_english || "",
    englishTitle: entry?.title_english || undefined,
    posterUrl: entry?.images?.jpg?.large_image_url || entry?.images?.jpg?.image_url || undefined,
    score: typeof entry?.score === "number" ? entry.score : undefined,
    scoredBy: typeof entry?.scored_by === "number" ? entry.scored_by : undefined,
    episodes: typeof entry?.episodes === "number" ? entry.episodes : undefined,
    type: entry?.type || undefined,
    status: entry?.status || undefined,
    year: typeof entry?.year === "number" ? entry.year : entry?.aired?.from ? new Date(entry.aired.from).getFullYear() : undefined,
    genres: Array.isArray(entry?.genres) ? entry.genres.map((g: any) => g?.name).filter(Boolean).slice(0, 5) : [],
    synopsis: entry?.synopsis ? String(entry.synopsis).replace(/\s+/g, " ").trim() : undefined,
    url: entry?.url || undefined
  };
}

/**
 * Search MyAnimeList via Jikan. Cached 10 minutes per normalized query.
 * Returns [] on any failure (network, timeout, malformed payload).
 */
export async function searchAnimeInfo(query: string, limit = 5): Promise<JikanAnimeInfo[]> {
  const q = (query || "").trim();
  if (!q) return [];
  const key = `${normalizeTitle(q)}|${limit}`;

  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const url = `${JIKAN_BASE}/anime?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[JIKAN] search HTTP ${res.status} for "${q}"`);
      return [];
    }
    const payload: any = await res.json();
    const results: JikanAnimeInfo[] = Array.isArray(payload?.data)
      ? payload.data.map(mapAnimeEntry).filter((a: JikanAnimeInfo) => a.title && a.malId > 0)
      : [];

    // Cache even empty results briefly to avoid hammering a failing upstream.
    searchCache.set(key, { ts: Date.now(), data: results });
    if (searchCache.size > CACHE_MAX_ENTRIES) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    return results;
  } catch (err: any) {
    console.warn(`[JIKAN] search failed for "${q}": ${err?.message || err}`);
    return [];
  }
}

/** Test hook: clear the response cache. */
export function clearJikanCache(): void {
  searchCache.clear();
}

/**
 * Pick the best MAL result for a (possibly noisy) bot query: exact normalized
 * title beats a substring match beats MAL's own relevance order (fallback to
 * the first result — MAL search ranking is good). Returns null only when the
 * list is empty.
 */
export function pickBestMatch(query: string, results: JikanAnimeInfo[]): JikanAnimeInfo | null {
  if (!results || results.length === 0) return null;
  const q = normalizeTitle(query);
  let best: JikanAnimeInfo = results[0]!;
  let bestScore = 0;
  for (const r of results) {
    const t = normalizeTitle(r.title);
    const e = normalizeTitle(r.englishTitle || "");
    let score = 0;
    if (q && (t === q || (e && e === q))) score = 100;
    else if (q && q.length >= 3 && ((t && (t.includes(q) || q.includes(t))) || (e && (e.includes(q) || q.includes(e))))) score = 70;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Fetch the best match for a title in a single call (cached). */
export async function bestAnimeMatch(query: string): Promise<JikanAnimeInfo | null> {
  const results = await searchAnimeInfo(query, 5);
  return pickBestMatch(query, results);
}

function trimSynopsis(text: string | undefined, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * WhatsApp info card (French labels). `compact` renders the short variant
 * used alongside the Novabox season screen.
 */
export function formatAnimeCard(info: JikanAnimeInfo, compact = false): string {
  if (!info) return "";
  const lines: string[] = [];

  lines.push(`🎬 *${info.title}*${info.englishTitle && info.englishTitle !== info.title ? ` (_${info.englishTitle}_)` : ""}`);

  const meta: string[] = [];
  if (typeof info.score === "number") meta.push(`⭐ ${info.score.toFixed(1)}/10${info.scoredBy ? ` (${Intl.NumberFormat("fr-FR").format(info.scoredBy)} votes)` : ""}`);
  if (info.episodes) meta.push(`📺 ${info.episodes} ép.`);
  if (info.type) meta.push(`🎞️ ${info.type}`);
  if (info.year) meta.push(`📅 ${info.year}`);
  if (meta.length > 0) lines.push(meta.join(" | "));
  if (info.status && !compact) lines.push(`📌 ${info.status}`);
  if (info.genres.length > 0) lines.push(`🎭 ${info.genres.join(", ")}`);

  if (info.synopsis) {
    lines.push("");
    lines.push(`📝 ${trimSynopsis(info.synopsis, compact ? 200 : 400)}`);
  }

  lines.push("");
  lines.push(compact ? `🔎 _Fiche complète: \`.anime ${info.title}\`_` : info.url ? `🔗 ${info.url}` : "");
  if (!compact) lines.push(`🌌 _Nebula Bot · données MyAnimeList (Jikan)_`);

  return lines.filter((l) => l !== "").join("\n").trim();
}
