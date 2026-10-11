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

import { safeAxiosGet } from "../urlSafety.js";
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
  const resp = await safeAxiosGet(url, {
    headers: { "User-Agent": UA, Referer: `${VOIRANIME_ORIGIN}/`, Accept: "text/html" },
    timeout: PAGE_TIMEOUT_MS,
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
    const m = href.match(new RegExp(`^${VOIRANIME_ORIGIN}/anime/([a-z0-9-]+)/?$`, "i"));
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
// ── 9.9 : organisation VF de l'écran de sélection ───────────────────────────
// Owner : par défaut la liste ne montre QUE les entrées VF, regroupées par
// anime avec les saisons étiquetées (« — Saison 2 ») et les films nommés —
// le site publie une page par saison (« Kimetsu no Yaiba 2/3/4 ») et la
// liste brute ressemblait à des animes différents. Pure — testée.

export interface OrganizedVfEntry {
  result: VoiranimeSearchResult;
  /** Saison déduite (null pour les films/OAV). */
  season: number | null;
  isFilm: boolean;
  baseTitle: string;
  /** Étiquette prête pour la liste : « Kimetsu no Yaiba — Saison 2 ». */
  label: string;
}

const FILM_SLUG_RE = /(^|[-_])(film|movie|oav)([-_]|$)/i;

/** Retire le marqueur de saison final (« Kimetsu no Yaiba 2 », « … R2 »). */
function stripSeasonMarker(title: string): string {
  const m = title.match(/^(.*?)[\s]+[Rr]?(\d+)\s*$/);
  if (m && m[1].trim().length >= 2) return m[1].trim();
  return title.trim();
}

/**
 * Regroupe et étiquette les entrées VF : par anime (ordre d'apparition),
 * saisons croissantes puis films/OAV. Marqueurs reconnus : slug trailing
 * « -N » / « -rN » / « -sN » / « -saison-N » (conventions du site), titre
 * final « N » ou « R2 » ; sans marqueur = saison 1 (convention voir-anime,
 * cohérente avec resolveVoiranimeSeason).
 */
export function organizeVfSelection(entries: VoiranimeSearchResult[]): OrganizedVfEntry[] {
  const analyzed: OrganizedVfEntry[] = entries.map((e) => {
    const bare = e.slug.replace(/-vf$/i, "");
    const isFilm = FILM_SLUG_RE.test(bare) || /\b(film|movie|oav)\b/i.test(e.title);
    const colon = e.title.match(/^([^:]{2,}):\s*(.+)$/);
    const slugM =
      bare.match(/-(\d+)$/) || bare.match(/-r(\d+)$/) ||
      bare.match(/-s(\d+)$/) || bare.match(/-saison-(\d+)$/);
    const titleM = e.title.match(/\sR(\d)\s*$/i) || e.title.match(/\s(\d+)\s*$/);
    const explicit = !!(slugM || titleM); // marqueur de saison RÉEL (pas le défaut)
    const season = isFilm || !explicit ? (explicit ? parseInt((slugM || titleM)![1], 10) : 1) : parseInt((slugM || titleM)![1], 10);

    // Clé de regroupement : préfixe avant « : » (les saisons d'un même anime
    // partagent le préfixe), sinon le titre sans son marqueur.
    const groupKey = stripSeasonMarker(colon ? colon[1] : e.title);
    let label: string;
    if (isFilm) {
      const sub = colon ? colon[2].trim() : "";
      label = sub ? `${groupKey} — Film : ${sub}` : `${groupKey} — Film`;
    } else if (explicit) {
      label = `${stripSeasonMarker(e.title)} — Saison ${season}`;
    } else if (colon) {
      // Sous-titre distinctif SANS marqueur de saison (ex. « Mugen
      // Ressha-hen », un film non marqué) : titre complet, honnête —
      // on n'invente pas une « Saison 1 » qui pourrait être fausse.
      label = e.title;
    } else {
      label = `${groupKey} — Saison 1`; // convention voir-anime (cf. resolveVoiranimeSeason)
    }
    return { result: e, season: isFilm ? null : season, isFilm, baseTitle: groupKey, label };
  });

  // Groupement par anime (clé = base, ordre de première apparition).
  const groups: Array<{ base: string; items: OrganizedVfEntry[] }> = [];
  for (const a of analyzed) {
    const key = a.baseTitle.toLowerCase();
    let g = groups.find((x) => x.base === key);
    if (!g) { g = { base: key, items: [] }; groups.push(g); }
    g.items.push(a);
  }
  const out: OrganizedVfEntry[] = [];
  for (const g of groups) {
    g.items.sort((x, y) => {
      if (x.isFilm !== y.isFilm) return x.isFilm ? 1 : -1;
      if (!x.isFilm) return (x.season ?? 99) - (y.season ?? 99);
      return x.label.localeCompare(y.label, "fr");
    });
    out.push(...g.items);
  }
  return out;
}

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
