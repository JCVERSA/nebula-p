/**
 * Chosen-source anime catalogs (refonte 2026-09-21, owner decisions).
 *
 * Model: ONE catalog per query, picked by the user with a short flag —
 * `as` (default: the full dual-language catalog) or `va` (the VF-dub
 * specialist). Search, seasons, episodes AND downloads all happen on that
 * catalog. There is NO cross-source fallback anymore: when the title (or
 * the requested language) is missing, the bot answers honestly and points
 * to the OTHER flag — the user switches himself.
 *
 * Language truth is STRUCTURAL (no external oracle):
 *  - "as" catalog: season sub-paths carry the language ("saison1/vf" vs
 *    "saison1/vostfr") — the panneauAnime listings include both branches.
 *  - "va" catalog: entry slugs carry it ("-vf" / "-vostfr" suffixes).
 *
 * Source names are PRIVATE (audit 8.42): they never appear in user-facing
 * messages — flags and neutral labels only. Console diagnostics may name
 * them (VPS-side logs).
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { voiranimeSearch } from "./voiranimeClient.js";
import { animeProxyOptions } from "./scrapingProxy.js";

export type AnimeSourceId = "as" | "va";
export type SeasonLanguage = "VF" | "VOSTFR" | null;

/** Default catalog when the user types no flag (owner decision 2026-09-21). */
export const DEFAULT_ANIME_SOURCE: AnimeSourceId = "as";

/** Error code surfaced when the operator disabled the va catalog. */
export const VA_DISABLED_CODE = "NEBULA_VA_DISABLED";

export interface SourceSearchResult {
  title: string;
  subtitle: string;
  url: string;
  /** Structural language of the entry (va slugs) — null when the catalog
   * does not encode language at the entry level (as results). */
  language?: SeasonLanguage;
  /** va entries keep their slug (season resolution + tests). */
  slug?: string;
  isVf?: boolean;
}

/** Console-only label (owner diagnostics) — NEVER sent to users. */
export function sourceLogLabel(source: AnimeSourceId): string {
  return source === "va" ? "voir-anime" : "anime-sama";
}

/** The other catalog's flag (used in anonymized hints). */
export function otherFlagOf(source: AnimeSourceId): AnimeSourceId {
  return source === "as" ? "va" : "as";
}

/** 8.55 (moved here from novabox): normalize titles across keyboard layouts —
 * users type "Komyushō" (ō) while catalogs index the Hepburn romanization
 * "Komyushou". Macron vowels become their doubled Hepburn form and remaining
 * diacritics are stripped, so the WordPress substring search hits either way. */
export function foldTitleDiacritics(s: string): string {
  return s
    .replace(/[ōŌ]/g, "ou").replace(/[ūŪ]/g, "uu").replace(/[āĀ]/g, "aa")
    .replace(/[īĪ]/g, "ii").replace(/[ēĒ]/g, "ee")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// Structural language detection
// ---------------------------------------------------------------------------

/** Language encoded in an "as" season sub-path ("saison1/vf", "film/vostfr"). */
export function samaSubPathLanguage(subPath: string): SeasonLanguage {
  const s = (subPath || "").toLowerCase();
  if (/(^|[-/_])vost(fr)?([-/_]|$)/.test(s)) return "VOSTFR";
  if (/(^|[-/_])vf([-/_]|$)/.test(s)) return "VF";
  return null;
}

/** Language encoded in a "va" entry slug ("...-vf", "...-vostfr"). */
export function voiranimeSlugLanguage(slugOrUrl: string): SeasonLanguage {
  const s = (slugOrUrl || "").toLowerCase().replace(/\/+$/, "");
  if (/(^|[-/_])vost(fr)?$/.test(s)) return "VOSTFR";
  if (/(^|[-/_])vf$/.test(s)) return "VF";
  return null;
}

export interface ClassifiedSeasons<T> {
  vf: T[];
  vostfr: T[];
  other: T[];
}

/** Splits season/entry items by their structural language field. */
export function classifyByLanguage<T extends { language?: SeasonLanguage }>(items: T[]): ClassifiedSeasons<T> {
  const vf: T[] = [];
  const vostfr: T[] = [];
  const other: T[] = [];
  for (const item of items || []) {
    if (item.language === "VF") vf.push(item);
    else if (item.language === "VOSTFR") vostfr.push(item);
    else other.push(item);
  }
  return { vf, vostfr, other };
}

/** Languages actually available in a season list (for switch hints). */
export function languagesOf<T extends { language?: SeasonLanguage }>(items: T[]): string[] {
  const { vf, vostfr, other } = classifyByLanguage(items);
  const langs: string[] = [];
  if (vf.length > 0) langs.push("VF");
  if (vostfr.length > 0 || other.length > 0) langs.push("VOSTFR");
  return langs;
}

// ---------------------------------------------------------------------------
// Language policy (owner decisions 2026-09-21 — strict, mono-source)
// ---------------------------------------------------------------------------

export type LanguagePolicyResult<T> =
  | {
      status: "ok";
      seasons: T[];
      language: "VF" | "VOSTFR";
      /** Header shown above the season list when the requested language
       * does not exist and another one is listed instead (display-only). */
      header?: string;
      /** Neutral hint pointing at the other catalog's flag. */
      guideHint?: string;
    }
  | { status: "missing"; message: string };

/**
 * VF requested (the default): VF seasons; if none exist the VOSTFR seasons
 * are LISTED, clearly labeled (display decision) with a hint toward the other
 * catalog. VOSTFR requested: VOSTFR seasons or an honest failure + guide to
 * the other flag. Never mixes languages silently.
 */
export function applyLanguagePolicy<T extends { language?: SeasonLanguage }>(
  items: T[],
  wantLang: "VF" | "VOSTFR",
  source: AnimeSourceId
): LanguagePolicyResult<T> {
  const { vf, vostfr, other } = classifyByLanguage(items);

  if (wantLang === "VOSTFR") {
    if (vostfr.length > 0) return { status: "ok", seasons: vostfr, language: "VOSTFR" };
    const hasVfNote = vf.length > 0
      ? "\n\n_ℹ️ Ce titre existe en VF sur ce catalogue._"
      : "";
    return {
      status: "missing",
      message:
        `❌ *Aucun VOSTFR pour ce titre sur ce catalogue.*\n\n` +
        `💡 *Essaie l'autre catalogue :* \`.a ${otherFlagOf(source)} <titre> vostfr\`` +
        hasVfNote,
    };
  }

  if (vf.length > 0) return { status: "ok", seasons: vf, language: "VF" };
  if (vostfr.length > 0) {
    return {
      status: "ok",
      seasons: vostfr,
      language: "VOSTFR",
      header: "ℹ️ *Aucune VF pour ce titre sur ce catalogue* — saisons VOSTFR disponibles :",
      guideHint: `_(Tu peux aussi essayer l'autre catalogue : \`.a ${otherFlagOf(source)} <titre>\`)_`,
    };
  }
  if (other.length > 0) {
    return {
      status: "ok",
      seasons: other,
      language: "VOSTFR",
      header: "ℹ️ *Ce catalogue ne précise pas la langue de ce titre* — saisons disponibles :",
    };
  }
  return {
    status: "missing",
    message: "❌ *Aucune saison trouvée pour cet anime sur ce catalogue.*",
  };
}

// ---------------------------------------------------------------------------
// Anonymized user messages (no source names — audit 8.42)
// ---------------------------------------------------------------------------

/** Search came back empty on the chosen catalog. */
export function searchEmptyMessage(query: string, source: AnimeSourceId): string {
  return (
    `❌ *Aucun résultat* pour "${query}" sur ce catalogue.\n\n` +
    `✍️ *Vérifie l'orthographe* — sépare bien les mots du titre (ex : « solo leveling »).\n\n` +
    `💡 *Tu peux aussi essayer l'autre catalogue :* \`.a ${otherFlagOf(source)} <titre>\``
  );
}

/** Operator disabled the va catalog (NEBULA_VOIRANIME_DISABLED=1). */
export function vaDisabledMessage(): string {
  return "😕 *Ce catalogue est momentanément indisponible.*\n\n🔁 *Réessaie plus tard* — l'autre catalogue reste utilisable.";
}

// ---------------------------------------------------------------------------
// Search routing (mono-source, no fallback)
// ---------------------------------------------------------------------------

async function searchAnimeSama(query: string): Promise<SourceSearchResult[]> {
  const url = "https://anime-sama.to/template-php/defaut/fetch.php";
  const params = new URLSearchParams();
  params.append("query", query);

  const res = await axios.post(url, params, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 8000,
    ...animeProxyOptions()
  });

  const $ = cheerio.load(res.data);
  const results: SourceSearchResult[] = [];

  $(".asn-search-result").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = $(el).find(".asn-search-result-title").text().trim();
    const subtitle = $(el).find(".asn-search-result-subtitle").text().trim();
    if (href) {
      results.push({ title, subtitle, url: href, language: null });
    }
  });

  return results;
}

/**
 * Search ONE catalog. No fallback: an empty result is the answer (the caller
 * shows the other-flag hint). va results are ordered VF-first because VF is
 * the default language, and carry their structural language for the policy.
 */
export async function searchAnimeBySource(
  query: string,
  source: AnimeSourceId
): Promise<SourceSearchResult[]> {
  if (source === "va") {
    if (process.env.NEBULA_VOIRANIME_DISABLED === "1") {
      throw new Error(VA_DISABLED_CODE);
    }
    const results = await voiranimeSearch(foldTitleDiacritics(query));
    const withLang: SourceSearchResult[] = results.map((r) => {
      const language = voiranimeSlugLanguage(r.slug);
      return {
        title: r.title,
        subtitle: language === "VF" ? "VF" : language === "VOSTFR" ? "VOSTFR" : "",
        url: r.url,
        slug: r.slug,
        language,
        isVf: r.isVf
      };
    });
    // VF-first ordering (VF is the default browsing language).
    return [
      ...withLang.filter((r) => r.language === "VF"),
      ...withLang.filter((r) => r.language !== "VF")
    ];
  }
  return searchAnimeSama(query);
}
