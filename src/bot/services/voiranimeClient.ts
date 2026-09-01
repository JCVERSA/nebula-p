/**
 * ============================================================================
 *  VoirAnime client — voir-anime.to (VF-first source, audit §8.9)
 * ============================================================================
 *  Ground truth (verified 2026-08-31 from the production VPS):
 *   - HTML pages answer 200 from datacenter IPs (only /wp-json/ is CF-403,
 *     which we do not need). WordPress "Madara" theme.
 *   - Search: GET /?s=<query> -> result cards linking /anime/<slug>/.
 *     VF entries are STRUCTURAL: slug ends with "-vf" (title ends " (VF)").
 *     Each season is its own entry (e.g. "...-r2", "...-3").
 *   - Anime page: episode links /anime/<slug>/<ep-slug>-NN-vf/ (or -vostfr/,
 *     film/oav slugs for movies).
 *   - Episode page: player iframe on voembed.net/embed-<code>.html (extracted
 *     by the generic packed-player probe; real HLS qualities inside).
 *
 *  Used for explicit VF requests (`.a <q> ... vf ...`); any failure falls
 *  back to the nakanime path.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { animeProxyOptions } from "./scrapingProxy.js";

const VOIRANIME_ORIGIN = "https://voir-anime.to";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 12000;

export interface VoiranimeSearchResult {
  title: string;
  url: string; // https://voir-anime.to/anime/<slug>/
  slug: string;
  isVf: boolean;
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await axios.get(url, {
    headers: { "User-Agent": UA, Referer: `${VOIRANIME_ORIGIN}/`, Accept: "text/html" },
    timeout: PAGE_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
    ...animeProxyOptions()
  });
  return typeof resp.data === "string" ? resp.data : "";
}

/** True when a slug/href identifies a VF entry (structural, not a label). */
export function isVoiranimeVfSlug(slugOrUrl: string): boolean {
  const s = (slugOrUrl || "").toLowerCase();
  return /-vf\/?$/.test(s);
}

/**
 * Parses a Madara search-results page into anime entries (exported for
 * tests). Extracts /anime/<slug>/ links with their titles, deduped, order
 * preserved (relevance order).
 */
export function parseVoiranimeSearch(html: string): VoiranimeSearchResult[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out: VoiranimeSearchResult[] = [];
  const seen = new Set<string>();

  // Result cards (madara): .page-item-detail anchors; generic fallback: any
  // link pointing to /anime/<slug>/ that is not a genre/release listing.
  const candidates = $("a[href*='/anime/']").toArray();
  for (const el of candidates) {
    const href = $(el).attr("href") || "";
    let m = href.match(new RegExp(`^${VOIRANIME_ORIGIN}/anime/([a-z0-9-]+)/?$`, "i"));
    if (!m) continue;
    const slug = m[1];
    if (slug === "anime" || seen.has(slug)) continue;
    // Skip taxonomy links by requiring the anchor to look like a title link
    // (inside a post title, or carrying the entry title attribute/text).
    const title =
      $(el).attr("title")?.trim() ||
      $(el).text().replace(/\s+/g, " ").trim() ||
      "";
    if (!title || title.length < 2) continue;
    // Genre/filter navigation links carry genre-ish text — skip obvious ones.
    if (/^(action|adventure|comedy|drama|fantasy|horror|mecha|mystery|romance|sci-fi|thriller|vostfr|vf)$/i.test(title)) continue;
    seen.add(slug);
    const url = `${VOIRANIME_ORIGIN}/anime/${slug}/`;
    out.push({ title: title.replace(/\s*\(VF\)\s*$/i, "").trim(), url, slug, isVf: slug.endsWith("-vf") });
    if (out.length >= 30) break;
  }
  return out;
}

/** Search VoirAnime and return entries (VF entries flagged structurally). */
export async function voiranimeSearch(query: string): Promise<VoiranimeSearchResult[]> {
  const html = await fetchHtml(`${VOIRANIME_ORIGIN}/?s=${encodeURIComponent(query)}`);
  return parseVoiranimeSearch(html);
}

export interface VoiranimeEpisode {
  n: number; // episode number from the URL (0 for film/oav)
  url: string;
  label: string; // "Épisode N" | "Film" | "OAV"
}

/**
 * Parses an anime page into its episode list (exported for tests).
 * Episode URLs end with -NN-vf/ or -NN-vostfr/; films/OAVs use film-/oav-
 * prefixes without a number.
 */
export function parseVoiranimeEpisodes(html: string, animeUrl: string): VoiranimeEpisode[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const base = animeUrl.replace(/\/$/, "");
  const slug = base.split("/").pop() || "";
  const out: VoiranimeEpisode[] = [];
  const seen = new Set<string>();

  $(`a[href*='/${slug}/']`).each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(new RegExp(`^${base}/(.+)$`, "i"));
    if (!m) return;
    const tail = m[1].replace(/\/$/, "");
    if (tail.includes("/")) return; // sub-path, not an episode
    const key = tail.toLowerCase();
    if (seen.has(key)) return;

    const epNum = tail.match(/-(\d+)-(?:vf|vostfr)$/i);
    if (epNum) {
      seen.add(key);
      out.push({ n: parseInt(epNum[1], 10), url: `${base}/${tail}/`, label: `Épisode ${parseInt(epNum[1], 10)}` });
      return;
    }
    if (/^(film|oav|movie)-/.test(key) || /-(film|oav|movie)$/i.test(key)) {
      seen.add(key);
      const label = key.startsWith("film") || /film/.test(key) ? "Film" : "OAV";
      out.push({ n: 0, url: `${base}/${tail}/`, label });
    }
  });

  out.sort((a, b) => a.n - b.n);
  return out;
}

/** Episode list of a VoirAnime entry. */
export async function voiranimeEpisodes(animeUrl: string): Promise<VoiranimeEpisode[]> {
  const html = await fetchHtml(animeUrl);
  return parseVoiranimeEpisodes(html, animeUrl);
}

/**
 * Parses an episode page and returns the player embed URL (voembed.net or
 * any iframe embed host). Exported for tests.
 */
export function parseVoiranimePlayer(html: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("iframe").each((_, el) => {
    if (found) return;
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (/^https?:\/\/[^/]+\/embed-/i.test(src) || /(embed|player)[^/]*\.[a-z]{2,}\//i.test(src)) {
      found = src;
    }
  });
  if (!found) {
    const m = html.match(/https?:\/\/[^\s"'<>]+\/embed-[a-z0-9-]+\.html/i);
    if (m) found = m[0];
  }
  return found;
}

/** Player embed URL for one episode page. */
export async function voiranimeEpisodePlayer(episodeUrl: string): Promise<string | null> {
  try {
    const html = await fetchHtml(episodeUrl);
    return parseVoiranimePlayer(html);
  } catch {
    return null;
  }
}

/**
 * Picks the VF entry matching a requested season number from a franchise's
 * VF entries: an entry whose title/slug carries the number (e.g. "R2",
 * "-2", "season 2") wins; season 1 falls back to the first VF entry.
 * Exported for tests.
 */
export function resolveVoiranimeSeason(
  vfEntries: VoiranimeSearchResult[],
  requestedSeason: number
): VoiranimeSearchResult | null {
  if (vfEntries.length === 0) return null;
  for (const e of vfEntries) {
    const hay = `${e.title} ${e.slug}`.toLowerCase();
    // explicit season markers
    if (new RegExp(`(^|[^0-9])(s|saison|season)[ .-]?${requestedSeason}([^0-9]|$)`).test(hay)) return e;
    // trailing number in the slug ("...-2-vf") or title ("... 2")
    if (new RegExp(`(^|[^0-9])${requestedSeason}([^0-9]|$)`).test(hay)) return e;
  }
  if (requestedSeason <= 1) return vfEntries[0];
  return null;
}
