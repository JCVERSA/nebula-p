/**
 * Chosen-source anime catalogs (refonte 2026-09-21, owner decisions).
 *
 * Model: ONE catalog per query — the default (owner 8.96/9.18rrr: va, the
 * VF-first catalog, which also carries the VOSTFR pages since ooo/ppp) or
 * the explicit `as` flag (the other catalog, kept as an explicit
 * alternative). Search, seasons, episodes AND downloads all happen on that
 * catalog. There is NO cross-source fallback anymore: when the title (or
 * the requested language) is missing, the bot answers honestly and points
 * to the OTHER flag — the user switches himself (or the agent offers it).
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

import { isExactAnimeMatch } from "../utils/quickAnimeParser.js";
import axios from "axios";
import * as cheerio from "cheerio";
import { completeVoiranimeFranchises, voiranimeSearch } from "./voiranimeClient.js";
import { animeProxyOptions } from "./scrapingProxy.js";

export type AnimeSourceId = "as" | "va";
export type SeasonLanguage = "VF" | "VOSTFR" | null;

/**
 * Default catalog when the user types no flag. Owner decision 2026-10-10
 * (8.96): voir-anime (va) — the VF catalog, aligned with the VF-by-default
 * language policy and the .w watcher. 9.18rrr (owner 18/10): VOSTFR
 * downloads come from va TOO (VOSTFR coverage complete since ooo/ppp).
 * `.a as <titre>` reaches the other catalog explicitly.
 */
export const DEFAULT_ANIME_SOURCE: AnimeSourceId = "va";

/**
 * 8.96 — effective default: the implicit default must NEVER crash when the
 * operator disabled voir-anime (NEBULA_VOIRANIME_DISABLED=1) — it falls
 * back to the full catalog instead.
 */
export function effectiveDefaultSource(): AnimeSourceId {
  return DEFAULT_ANIME_SOURCE === "va" && process.env.NEBULA_VOIRANIME_DISABLED === "1"
    ? "as"
    : DEFAULT_ANIME_SOURCE;
}

/** Error code surfaced when the operator disabled the va catalog. */
export const VA_DISABLED_CODE = "NEBULA_VA_DISABLED";

export interface SourceSearchResult {
  title: string;
  subtitle: string;
  url: string;
  /** Structural language of the entry (va slugs — toujours renseignée :
   * slug nu = page VOSTFR, 9.18ooo) — null when the catalog does not
   * encode language at the entry level (as results). */
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

/**
 * 8.95 — candidat du fallback croisé : entrée en match EXACT avec la requête.
 * Pour "va" (les entrées de recherche SONT les saisons, langue structurelle),
 * l'entrée doit en plus porter la langue demandée. Pour "as", la langue se
 * vérifie ensuite via parseSeasons (réseau) — ici on ne fait que le match.
 * Retourne null sans candidat sûr : JAMAIS de titre approximatif.
 */
export function exactEntryForLanguage(
  query: string,
  results: SourceSearchResult[],
  wantLang: "VF" | "VOSTFR",
  source: AnimeSourceId
): SourceSearchResult | null {
  const match = isExactAnimeMatch(query, results);
  if (!match.isExact || match.exactMatchIndex == null || match.exactMatchIndex < 0) return null;
  const entry = results[match.exactMatchIndex];
  if (source === "va" && entry.language !== wantLang) return null;
  return entry;
}

// ---------------------------------------------------------------------------
// Anonymized user messages (no source names — audit 8.42)
// ---------------------------------------------------------------------------

/** Search came back empty on the chosen catalog. */
export function searchEmptyMessage(query: string, source: AnimeSourceId): string {
  // 9.3 — VOLONTAIREMENT sans la formulation « l'autre catalogue » : elle
  // déclenchait l'offre de bascule 8.94 alors qu'un échec de recherche
  // révèle presque toujours un problème de TITRE (titre français vs
  // international), pas de langue. Le rattrapage IA (titre international)
  // est la bonne sortie ; l'astuce catalogue reste affichée, rewordée.
  return (
    `❌ *Aucun résultat* pour "${query}" sur ce catalogue.\n\n` +
    `✍️ *Vérifie l'orthographe* — sépare bien les mots du titre (ex : « solo leveling »).\n\n` +
    `💡 *Le catalogue complet est plus large :* \`.a ${otherFlagOf(source)} <titre>\``
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
/** 9.18kkk — articles initiaux retirés dans les variantes de requête. */
const QUERY_LEADING_ARTICLE_RE = /^(?:the|le|la|les|l'|l’|un|une|des|a|an)\s+/i;
/** 9.18kkk — mots vides jamais fléchés (singulier/pluriel). */
const QUERY_NO_INFLECT = new Set([
  "the", "le", "la", "les", "l", "un", "une", "des", "a", "an", "of", "de", "du",
  "et", "and", "no", "not", "in", "en", "to", "au", "aux", "dans", "sur", "for",
]);

/**
 * 9.18kkk — variantes de requête pour une recherche anime (retour terrain
 * 18/10 : « the rampart of ice » → 0 résultat alors que le titre réel est
 * « The Ramparts of Ice » — un « s » de différence). Pure, dédupliquée,
 * bornée à 4 : la requête originale TOUJOURS en premier, puis sans
 * l'article initial, puis fléchis singulier/pluriel des mots significatifs
 * (≥ 4 lettres, hors mots vides ; les mots courts comme « ice » ne bougent
 * pas — sinon « zzz » génèrerait des variantes inutiles).
 */
export function searchQueryVariants(query: string): string[] {
  const q = String(query || "").trim().replace(/\s+/g, " ");
  if (!q) return [];
  const variants: string[] = [q];
  const push = (v: string) => {
    const t = v.trim().replace(/\s+/g, " ");
    if (t && !variants.includes(t)) variants.push(t);
  };
  const bare = q.replace(QUERY_LEADING_ARTICLE_RE, "").trim();
  if (bare) push(bare);
  // 9.18ppp : « Re:Zero » tapé « rezero » ne matche pas le titre (WordPress
  // cherche le mot entier, deux-points compris) — la variante scindée
  // « re zero » y parvient (« zero » matche « Re:Zero »). Ne s'applique
  // qu'aux mots simples « re… » d'au moins 6 lettres.
  if (/^re[a-z]{4,}$/i.test(q)) push(`re ${q.slice(2)}`);
  const words = (bare || q).split(" ");
  const inflectable = (w: string) => w.length >= 4 && !QUERY_NO_INFLECT.has(w.toLowerCase());
  push(words.map((w) => (inflectable(w) && /s$/i.test(w) && !/(?:ss|us|is)$/i.test(w) ? w.slice(0, -1) : w)).join(" "));
  push(words.map((w) => (inflectable(w) && !/s$/i.test(w) ? `${w}s` : w)).join(" "));
  return variants.slice(0, 4);
}

export async function searchAnimeBySource(
  query: string,
  source: AnimeSourceId
): Promise<SourceSearchResult[]> {
  if (source === "va") {
    if (process.env.NEBULA_VOIRANIME_DISABLED === "1") {
      throw new Error(VA_DISABLED_CODE);
    }
    // 9.18kkk — retry à variantes sur le MÊME catalogue (la décision 8.69
    // « pas de fallback catalogue » reste intacte) : une faute de frappe
    // proche (article, singulier/pluriel) ne doit plus donner 0 résultat.
    const vaVariants = searchQueryVariants(foldTitleDiacritics(query));
    let rawResults: Awaited<ReturnType<typeof voiranimeSearch>> = [];
    for (let i = 0; i < vaVariants.length; i++) {
      rawResults = await voiranimeSearch(vaVariants[i]);
      if (rawResults.length) {
        if (i > 0) console.log(`[NOVABOX] recherche élargie « ${vaVariants[i]} » : ${rawResults.length} résultat(s)`);
        break;
      }
    }
    // 9.18ppp (terrain 18/10 04:41) : la recherche du site rate des SAISONS
    // entières (« rezero » ne matche pas « Re:Zero » — les deux-points ; 2
    // saisons VF remontées sur 4). Compléter chaque franchise trouvée via
    // son titre de base : le titre matche le titre, deux-points compris.
    rawResults = await completeVoiranimeFranchises(rawResults);
    const results = rawResults;
    const withLang: SourceSearchResult[] = results.map((r) => {
      // 9.18ooo (terrain 18/10 « ça n'a pas changé ») : sur ce catalogue, un
      // slug NU — sans suffixe -vf — est la page VOSTFR de l'anime
      // (convention structurelle du site). Lui donner la langue « VOSTFR »
      // au lieu de « inconnue » : ces entrées étaient invisibles à l'écran.
      const language = voiranimeSlugLanguage(r.slug) ?? "VOSTFR";
      return {
        title: r.title,
        subtitle: language,
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
  // 9.18kkk — même retry à variantes pour le catalogue as.
  const samaVariants = searchQueryVariants(query);
  for (let i = 0; i < samaVariants.length; i++) {
    const results = await searchAnimeSama(samaVariants[i]);
    if (results.length) {
      if (i > 0) console.log(`[NOVABOX] recherche élargie « ${samaVariants[i]} » : ${results.length} résultat(s)`);
      return results;
    }
  }
  return [];
}
