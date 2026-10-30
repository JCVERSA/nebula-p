import axios from "axios";
import * as cheerio from "cheerio";
import { animeProxyOptions } from "./scrapingProxy.js";

/**
 * 9.18wwww — Novaboxb : client du catalogue FILMS (décision owner 25/10).
 *
 * Source retenue après recherche approfondie (rapport 25/10) : French-Stream
 * — le plus complet ET le plus recommandé (vérifié vivant depuis le VPS
 * owner : HTTP 200 + recherche fonctionnelle). Films uniquement dans cette
 * version (les séries du même site restent une extension future).
 *
 * Structure du site (moteur DataLife Engine, vérifiée sur fiches réelles) :
 *  - recherche   : POST /engine/ajax/search.php  (query, page) → HTML
 *                  <div class="search-item" onclick="location.href='<path>'">
 *  - joueurs     : GET /engine/ajax/film_api.php?id=<id> → JSON
 *                  { players: { ViDZY: {VOSTFR,FRENCH,TRUEFRENCH}, Dood: …,
 *                               Voe: …, Filmoon: … } }
 *  - id          : premier segment du slug d'URL (/15135028-insidious…).
 *
 * La langue est STRUCTURELLE (une URL par langue et par joueur) — le même
 * modèle de vérité que les animés (slugs -vf/-vostfr). Les hébergeurs
 * (ViDZY, Voe, Filmoon, Vidmoly, Uqload…) recoupent l'écosystème anime :
 * le moteur partagé animeStreamExtractor les résout déjà ; Dood y est
 * ajouté par la même livraison (famille veev).
 *
 * Rotation de domaine : le site change d'adresse toutes les 2-6 semaines
 * (blocages ARCOM). L'origine est donc pilotée par env
 * (NEBULA_FILM_SOURCE, défaut https://french-stream.net) — une ligne
 * .env suffit à suivre une migration, zéro code.
 *
 * Sécurité : URLs reconstruites depuis l'origine configurée et validées
 * (jamais d'URL arbitraire suivie), timeout et tailles plafonnés, source
 * jamais nommée côté utilisateur (règle 8.42 — « catalogue films »).
 */

const FILM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Origine du catalogue films (pilotable par env — rotation de domaine). */
export function filmStreamOrigin(): string {
  return (process.env.NEBULA_FILM_SOURCE || "https://french-stream.net").replace(/\/+$/, "");
}

export interface FilmSearchResult {
  title: string;
  url: string;
  poster?: string;
}

export interface FilmPlayer {
  /** Nom du joueur côté site (console uniquement — jamais à l'utilisateur). */
  name: string;
  /** Langue normalisée : TRUEFRENCH/FRENCH → VF, VOSTFR → VOSTFR. */
  language: "VF" | "VOSTFR";
  /** URL directe de l'embed du joueur. */
  url: string;
}

export function filmStreamHeaders(origin: string): Record<string, string> {
  return {
    "User-Agent": FILM_UA,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
    Referer: `${origin}/`,
  };
}

/** Extrait l'id numérique d'une URL de fiche (pur — testé). */
export function extractFilmId(filmUrl: string): string | null {
  const m = (filmUrl || "").match(/\/(\d+)-[^/]*\.html/i) || (filmUrl || "").match(/[?&]newsid=(\d+)/);
  return m ? m[1] : null;
}

/** Normalise une langue du site vers VF/VOSTFR (pur — testé). */
export function normalizeFilmLanguage(raw: string): "VF" | "VOSTFR" | null {
  const l = (raw || "").trim().toUpperCase();
  if (l === "TRUEFRENCH" || l === "FRENCH" || l === "VF") return "VF";
  if (l === "VOSTFR" || l === "VOST") return "VOSTFR";
  return null;
}

/**
 * Parse le HTML de recherche (pur — testé sur fixture du terrain).
 * Les résultats sont des div.search-item avec onclick location.href.
 */
export function parseFilmSearchHtml(html: string, origin: string): FilmSearchResult[] {
  const $ = cheerio.load(html || "");
  const out: FilmSearchResult[] = [];
  $("div.search-item").each((_i, el) => {
    const onclick = $(el).attr("onclick") || "";
    const hrefMatch = onclick.match(/location\.href='([^']+)'/);
    if (!hrefMatch || !hrefMatch[1]) return;
    const path = hrefMatch[1];
    const url = path.startsWith("http") ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
    if (!url.startsWith(origin)) return; // SSRF : jamais hors de l'origine configurée
    const title = ($(el).find("div.search-title").text() || "").trim();
    if (!title) return;
    const poster = ($(el).find("img").attr("src") || "").trim() || undefined;
    out.push({ title, url, poster });
  });
  return out;
}

/**
 * Parse la réponse de l'API joueurs (pur — testé sur fixture du terrain) :
 * { players: { ViDZY: { VOSTFR: url, FRENCH: url, TRUEFRENCH: url }, … } }
 */
export function parseFilmPlayersApi(data: any): FilmPlayer[] {
  const players = data?.players;
  if (!players || typeof players !== "object" || Array.isArray(players)) return [];
  const out: FilmPlayer[] = [];
  for (const [name, langs] of Object.entries(players as Record<string, any>)) {
    if (!langs || typeof langs !== "object" || Array.isArray(langs)) continue;
    for (const [rawLang, rawUrl] of Object.entries(langs as Record<string, any>)) {
      const language = normalizeFilmLanguage(rawLang);
      const url = String(rawUrl || "").trim();
      if (!language || !/^https?:\/\//i.test(url)) continue;
      out.push({ name: String(name).trim() || "Player", language, url });
    }
  }
  return out;
}

/** Recherche un film sur le catalogue (POST AJAX, Referer requis). */
export async function filmSearch(query: string): Promise<FilmSearchResult[]> {
  const origin = filmStreamOrigin();
  const res = await axios.post(
    `${origin}/engine/ajax/search.php`,
    new URLSearchParams({ query, page: "1" }).toString(),
    {
      headers: { ...filmStreamHeaders(origin), "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
      ...animeProxyOptions(),
    }
  );
  if (res.status !== 200 || typeof res.data !== "string") return [];
  return parseFilmSearchHtml(res.data, origin);
}

/**
 * Récupère la fiche d'un film : détecte les SÉRIES (non supportées à ce
 * jour) et retourne les joueurs par langue. Jamais d'exception réseau —
 * l'appelant affiche un message honnête.
 */
export async function getFilmDetail(
  filmUrl: string
): Promise<{ kind: "film"; players: FilmPlayer[] } | { kind: "series" } | { kind: "error"; reason: string }> {
  const origin = filmStreamOrigin();
  if (!filmUrl.startsWith(origin)) return { kind: "error", reason: "url-externe" };

  const pageRes = await axios.get(filmUrl, {
    headers: filmStreamHeaders(origin),
    timeout: 15000,
    validateStatus: () => true,
    maxRedirects: 3,
    ...animeProxyOptions(),
  });
  if (pageRes.status !== 200 || typeof pageRes.data !== "string") {
    return { kind: "error", reason: `http-${pageRes.status}` };
  }
  // Une série expose ses épisodes via ep-data.php — honnête : films only.
  if (pageRes.data.includes("ep-data.php") || pageRes.data.includes('"episodes-')) {
    return { kind: "series" };
  }

  const filmId = extractFilmId(filmUrl);
  if (!filmId) return { kind: "error", reason: "id-introuvable" };

  const apiRes = await axios.get(`${origin}/engine/ajax/film_api.php?id=${filmId}`, {
    headers: filmStreamHeaders(origin),
    timeout: 15000,
    validateStatus: () => true,
    ...animeProxyOptions(),
  });
  if (apiRes.status !== 200) return { kind: "error", reason: `api-http-${apiRes.status}` };
  const players = parseFilmPlayersApi(apiRes.data);
  if (players.length === 0) return { kind: "error", reason: "aucun-joueur" };
  return { kind: "film", players };
}

/** Miroirs d'une langue, triés par priorité du moteur partagé (pur). */
export function filmMirrorsForLanguage(players: FilmPlayer[], language: "VF" | "VOSTFR"): string[] {
  const urls = players.filter((p) => p.language === language).map((p) => p.url);
  return [...new Set(urls)];
}

/** Langues réellement disponibles dans la liste de joueurs (pur). */
export function filmAvailableLanguages(players: FilmPlayer[]): ("VF" | "VOSTFR")[] {
  const langs: ("VF" | "VOSTFR")[] = [];
  if (players.some((p) => p.language === "VF")) langs.push("VF");
  if (players.some((p) => p.language === "VOSTFR")) langs.push("VOSTFR");
  return langs;
}
