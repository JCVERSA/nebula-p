/**
 * ============================================================================
 *  Jetanimes/HDSanime client — catalogue DooPlay WordPress (9.18gggg)
 * ============================================================================
 *  Ground truth (vérifié par sondage direct 2026-10-21) :
 *   - DEUX domaines servent le MÊME site : on.jetanimes.com + www.hdsanime.com
 *     (même base, mêmes slugs) — la cascade d'origins est une redondance
 *     gratuite ; NEBULA_JETANIMES_URL ajoute/remplace l'origine principale.
 *   - Recherche : GET /?s=<q> -> cartes de résultats pointant /serie/<slug>/
 *     (et /films/<slug>/ pour les films).
 *   - Page série : « Seasons and episodes » ; les liens épisodes suivent
 *     TOUJOURS /episodes/<serie>-saison-<N>-episode-<M>/ (vérifié live :
 *     mushoku-tensei-jobless-reincarnation-saison-3-episode-13).
 *   - Langue : taxonomie dtquality PAR ÉPISODE — la REST WP
 *     /wp-json/wp/v2/episodes?slug=<slug> expose class_list
 *     « dtquality--hd-vostfr » / « dtquality--hd-vf » (répond 200 depuis une
 *     IP datacenter ; l'admin-ajax, lui, exige un POST).
 *   - Lecteurs : options DooPlay (.dooplay_player_option data-post/data-nume)
 *     résolues par POST /wp-admin/admin-ajax.php (action=doo_player) ->
 *     {"embed_url": …} ; replis : iframe directe + regex d'hôtes connus.
 *     Les URLs de PUB (bannières secured.lol etc.) sont filtrées.
 *
 *  L'extraction du STREAM lui-même (HLS, qualités) reste le job de
 *  animeStreamExtractor — ce client ne fournit que les URLs de lecteurs.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { safeAxiosGet } from "../urlSafety.js";
import { animeProxyOptions } from "./scrapingProxy.js";

const JT_ORIGIN_PRIMARY = "https://on.jetanimes.com";
const JT_ORIGIN_SECONDARY = "https://www.hdsanime.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 12000;
const MAX_PLAYER_OPTIONS = 3;

/** Origines en cascade (env d'abord, puis les deux domaines du site). */
export function jetanimesOrigins(): string[] {
  const env = (process.env.NEBULA_JETANIMES_URL || "").trim().replace(/\/+$/, "");
  const all = env ? [env, JT_ORIGIN_PRIMARY, JT_ORIGIN_SECONDARY] : [JT_ORIGIN_PRIMARY, JT_ORIGIN_SECONDARY];
  return [...new Set(all)];
}

function isJetanimesPageUrl(url: string): boolean {
  return /^https?:\/\/[^/]*(jetanimes|hdsanime)\./i.test(url || "");
}

/** Réécrit l'origine d'une URL du site vers une autre origine de la cascade. */
export function swapJetanimesOrigin(url: string, toOrigin: string): string {
  try {
    const u = new URL(url);
    return `${toOrigin.replace(/\/+$/, "")}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * GET HTML avec cascade d'origines : une URL absolue du site dont l'origine
 * ne répond pas est rejouée sur les autres domaines (même base, mêmes slugs).
 * Une URL relative est essayée sur chaque origine. Renvoie "" si tout échoue.
 */
async function fetchJtHtml(url: string): Promise<string> {
  const origins = jetanimesOrigins();
  const targets: string[] = [];
  if (/^https?:\/\//i.test(url)) {
    targets.push(url);
    if (isJetanimesPageUrl(url)) {
      for (const o of origins) {
        const swapped = swapJetanimesOrigin(url, o);
        if (!targets.includes(swapped)) targets.push(swapped);
      }
    }
  } else {
    for (const o of origins) targets.push(`${o}/${url.replace(/^\/+/, "")}`);
  }
  for (const target of targets.slice(0, origins.length + 1)) {
    try {
      const resp = await safeAxiosGet(target, {
        headers: { "User-Agent": UA, Referer: `${new URL(target).origin}/`, Accept: "text/html" },
        timeout: PAGE_TIMEOUT_MS,
        validateStatus: (s) => s === 200,
        ...animeProxyOptions()
      });
      if (typeof resp.data === "string" && resp.data.trim().length > 0) return resp.data;
    } catch {}
  }
  return "";
}

// --------------------------------------------------------------------------- search

export interface JetanimesSearchResult {
  title: string;
  url: string; // https://…/serie/<slug>/ ou /films/<slug>/
  slug: string;
  isFilm: boolean;
}

/**
 * Parse une page de résultats de recherche DooPlay en entrées série/film
 * (pur, testé). Les liens /serie/<slug>/ et /films/<slug>/ sont retenus,
 * dédupliqués, ordre de pertinence préservé ; les autres liens (taxonomies,
 * acteurs, pagination) sont ignorés.
 */
export function parseJetanimesSearch(html: string): JetanimesSearchResult[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out: JetanimesSearchResult[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    if (out.length >= 30) return;
    const href = $(el).attr("href") || "";
    const m = href.match(/^(?:https?:\/\/[^/]+)?\/(serie|films?|movies)\/([a-z0-9%-]+)\/?$/i);
    if (!m) return;
    const kind = m[1].toLowerCase();
    const slug = decodeURIComponent(m[2]).toLowerCase();
    if (slug === "serie" || slug === "films" || slug === "film" || slug === "movies" || seen.has(slug)) return;
    const title =
      $(el).attr("title")?.trim() ||
      $(el).find("img").attr("alt")?.trim() ||
      $(el).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    // Cartes de résultats uniquement : le lien doit vivre dans un article ou
    // porter un titre (les menus annexe/lettres portent du texte court).
    const inArticle = $(el).closest("article, .result-item, .item, .post").length > 0;
    if (!inArticle && title.length < 3) return;
    seen.add(slug);
    const origin = href.match(/^https?:\/\/[^/]+/i)?.[0] || JT_ORIGIN_PRIMARY;
    out.push({
      title,
      url: `${origin}/${kind}/${m[2]}/`,
      slug,
      isFilm: kind !== "serie"
    });
  });
  return out;
}

/** Recherche Jetanimes (une requête, cascade incluse). */
export async function jetanimesSearch(query: string): Promise<JetanimesSearchResult[]> {
  const html = await fetchJtHtml(`/?s=${encodeURIComponent(query)}`);
  const parsed = parseJetanimesSearch(html);
  if (parsed.length === 0 && !html) {
    throw new Error("jetanimes: search unreachable on every origin");
  }
  return parsed;
}

// --------------------------------------------------------------------------- series

export interface JetanimesEpisode {
  n: number; // 0 pour un film
  url: string;
  label: string; // "Épisode N" | "Film"
  language?: "VF" | "VOSTFR" | null; // badge de la page série quand présent
}

export interface JetanimesSeasonInfo {
  seasonNumber: number;
  episodes: JetanimesEpisode[];
  /** Langue dominante détectée (badges ou REST) — null = inconnue/mixte. */
  language: "VF" | "VOSTFR" | null;
  /** Vrai quand la saison mélange des épisodes VF et VOSTFR (badges). */
  mixed: boolean;
}

/**
 * Parse une page série DooPlay en saisons (pur, testé). Chaque lien
 * /episodes/<slug>-saison-N-episode-M/ est attribué à sa saison N ; la
 * langue par épisode est lue dans le badge du <li> englobant quand le thème
 * l'affiche (« HD VOSTFR », « VF »…). Sans badge : langue null (la sonde
 * REST tranche au wiring).
 */
export function parseJetanimesSeries(html: string): JetanimesSeasonInfo[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const bySeason = new Map<number, JetanimesEpisode[]>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/^(?:https?:\/\/[^/]+)?\/episodes\/([a-z0-9%-]+?)-saison-(\d+)-episode-(\d+)\/?$/i);
    if (!m) return;
    const seasonNumber = parseInt(m[2], 10);
    const epNumber = parseInt(m[3], 10);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(epNumber)) return;
    const origin = href.match(/^https?:\/\/[^/]+/i)?.[0] || JT_ORIGIN_PRIMARY;
    const url = `${origin}/episodes/${m[1]}-saison-${seasonNumber}-episode-${epNumber}/`;
    // Badge de langue : texte du <li> englobant (ou de l'ancre).
    const scope = $(el).closest("li, .item");
    const scopeText = `${scope.text()} ${$(el).text()}`.toLowerCase();
    let language: "VF" | "VOSTFR" | null = null;
    if (/\bvostfr\b|\bvost\b/.test(scopeText)) language = "VOSTFR";
    else if (/(^|[^a-z])vf([^a-z]|$)/.test(scopeText)) language = "VF";
    let list = bySeason.get(seasonNumber);
    if (!list) {
      list = [];
      bySeason.set(seasonNumber, list);
    }
    if (!list.some((e) => e.n === epNumber)) {
      list.push({ n: epNumber, url, label: `Épisode ${epNumber}`, language });
    }
  });
  const seasons: JetanimesSeasonInfo[] = [];
  for (const [seasonNumber, episodes] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    episodes.sort((a, b) => a.n - b.n);
    const withLang = episodes.filter((e) => e.language);
    const vf = withLang.filter((e) => e.language === "VF").length;
    const vostfr = withLang.filter((e) => e.language === "VOSTFR").length;
    const mixed = vf > 0 && vostfr > 0;
    const language = mixed ? null : vf > 0 ? "VF" : vostfr > 0 ? "VOSTFR" : null;
    seasons.push({ seasonNumber, episodes, language, mixed });
  }
  return seasons;
}

/**
 * Langue d'un épisode via la REST WP (pur, testé) : class_list porte la
 * taxonomie dtquality (« dtquality--hd-vostfr », « dtquality--hd-vf »).
 */
export function languageFromRestClasses(classList: unknown): "VF" | "VOSTFR" | null {
  const classes = Array.isArray(classList) ? classList.map(String) : [String(classList || "")];
  const joined = classes.join(" ").toLowerCase();
  if (/dtquality--[^"']*vostfr/.test(joined) || /\bvostfr\b/.test(joined)) return "VOSTFR";
  if (/dtquality--[^"']*\bvf\b/.test(joined) || /(^|[^a-z])vf([^a-z]|$)/.test(joined)) return "VF";
  return null;
}

/** Langue d'un épisode par son slug via /wp-json/wp/v2/episodes?slug=… */
export async function jetanimesEpisodeLanguageByRest(episodeSlug: string): Promise<"VF" | "VOSTFR" | null> {
  const html = await fetchJtHtml(`/wp-json/wp/v2/episodes?slug=${encodeURIComponent(episodeSlug)}`);
  if (!html) return null;
  try {
    const data = JSON.parse(html);
    const first = Array.isArray(data) ? data[0] : data;
    return languageFromRestClasses(first?.class_list);
  } catch {
    return null;
  }
}

/**
 * Saisons d'une série. Langue : badges de la page d'abord ; si une saison
 * n'a AUCUN badge, sonde REST sur le premier épisode (1 requête max par
 * saison, uniquement au wiring).
 */
export async function jetanimesSeasons(seriesUrl: string): Promise<JetanimesSeasonInfo[]> {
  const html = await fetchJtHtml(seriesUrl);
  const seasons = parseJetanimesSeries(html);
  for (const season of seasons) {
    if (season.language !== null || season.episodes.length === 0) continue;
    const firstSlug = season.episodes[0].url.match(/\/episodes\/([a-z0-9%-]+)\/?$/i)?.[1];
    if (!firstSlug) continue;
    const lang = await jetanimesEpisodeLanguageByRest(firstSlug);
    if (lang) {
      season.language = lang;
      season.episodes.forEach((e) => {
        if (e.language == null) e.language = lang;
      });
    }
  }
  return seasons;
}

/**
 * Épisodes d'une saison précise (ou l'entrée film seule). Une saison mixte
 * (VF+VOSTFR, badges) est filtrée par la langue demandée quand elle est
 * connue — sinon rendue telle quelle (honnête, jamais inventée).
 */
export async function jetanimesSeasonEpisodes(
  seriesUrl: string,
  seasonNumber: number,
  language?: "VF" | "VOSTFR" | null
): Promise<JetanimesEpisode[]> {
  if (/\/(films?|movies)\//i.test(seriesUrl)) {
    return [{ n: 0, url: seriesUrl, label: "Film", language: null }];
  }
  const seasons = await jetanimesSeasons(seriesUrl);
  const season = seasons.find((s) => s.seasonNumber === seasonNumber) || seasons[0];
  if (!season) return [];
  if (language && season.mixed) {
    const filtered = season.episodes.filter((e) => e.language === language || e.language == null);
    if (filtered.length > 0) return filtered;
  }
  return season.episodes;
}

// --------------------------------------------------------------------------- players

export interface JetanimesPlayerOption {
  post: string;
  nume: string;
}

/** Hôtes de PUB connus du thème — jamais des lecteurs vidéo. */
const AD_HOST_RE = /(secured\.lol|aads\.com|jetanimes\.com|hdsanime\.com|doubleclick|popads)/i;

/**
 * Options lecteurs DooPlay de la page (pur, testé) : chaque
 * .dooplay_player_option porte data-post + data-nume.
 */
export function parseJetanimesPlayerOptions(html: string): JetanimesPlayerOption[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out: JetanimesPlayerOption[] = [];
  $(".dooplay_player_option").each((_, el) => {
    const post = $(el).attr("data-post");
    const nume = $(el).attr("data-nume");
    if (post && nume && /^\d+$/.test(post) && /^\d+$/.test(nume)) {
      out.push({ post, nume });
    }
  });
  return out;
}

/**
 * Lecteurs DIRECTS de la page (pur, testé) : iframes d'embed + regex des
 * hôtes connus dans le HTML brut. Les URLs du site lui-même et des régies
 * publicitaires sont exclues.
 */
export function parseJetanimesDirectPlayers(html: string): string[] {
  if (!html) return [];
  const found = new Set<string>();
  const $ = cheerio.load(html);
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (/^https?:\/\//i.test(src)) found.add(src);
  });
  const re = /https?:\/\/[^\s"'<>]+\/embed-[a-z0-9-]+\.html/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) found.add(m[0]);
  return [...found].filter((u) => !AD_HOST_RE.test(u));
}

/**
 * Actions admin-ajax candidates, par ordre de vraisemblance. Le standard
 * DooPlay est « doo_player » (handler lisant $_POST — un GET sonde renvoie
 * « 0 », ce qui n'invalide PAS le POST) ; les forks renomment parfois.
 * Le client essaie chaque action jusqu'à une URL — auto-résilient.
 */
const DOO_AJAX_ACTIONS = ["doo_player", "dt_player", "dooplay_player"];

/**
 * Résout UNE option DooPlay via admin-ajax (POST, cf. DOO_AJAX_ACTIONS) —
 * réponse attendue : {"embed_url": "https://…"} (ou l'URL en clair).
 */
export async function resolveDooPlayerAjax(episodeUrl: string, option: JetanimesPlayerOption): Promise<string | null> {
  let ajaxUrl: string;
  try {
    ajaxUrl = `${new URL(episodeUrl).origin}/wp-admin/admin-ajax.php`;
  } catch {
    return null;
  }
  for (const action of DOO_AJAX_ACTIONS) {
    const body = new URLSearchParams();
    body.append("action", action);
    body.append("post", option.post);
    body.append("nume", option.nume);
    try {
      const res = await axios.post(ajaxUrl, body, {
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: episodeUrl,
          "X-Requested-With": "XMLHttpRequest"
        },
        timeout: 10000,
        ...animeProxyOptions()
      });
      const data = res.data;
      let embed: string | null = null;
      if (typeof data === "string") {
        const urlMatch = data.match(/https?:\/\/[^\s"'<>]+/);
        embed = urlMatch ? urlMatch[0] : null;
      } else {
        const raw = data?.embed_url || data?.embed || data?.url;
        if (typeof raw === "string" && /^https?:\/\//i.test(raw)) embed = raw;
      }
      if (embed && !AD_HOST_RE.test(embed)) return embed;
    } catch {}
  }
  return null;
}

/**
 * URLs de lecteurs d'une page épisode (ou film). Stratégies en cascade :
 * (1) options DooPlay -> admin-ajax ; (2) iframes/regex directs si (1) muet.
 * Borné à MAX_PLAYER_OPTIONS lecteurs, dédupliqué, publicités exclues.
 */
export async function jetanimesEpisodePlayers(episodeUrl: string): Promise<string[]> {
  const html = await fetchJtHtml(episodeUrl);
  if (!html) return [];
  const out: string[] = [];
  const options = parseJetanimesPlayerOptions(html);
  for (const option of options.slice(0, MAX_PLAYER_OPTIONS)) {
    const resolved = await resolveDooPlayerAjax(episodeUrl, option);
    if (resolved) out.push(resolved);
  }
  if (out.length === 0) {
    out.push(...parseJetanimesDirectPlayers(html));
  }
  return [...new Set(out)].filter((u) => !AD_HOST_RE.test(u)).slice(0, MAX_PLAYER_OPTIONS);
}
