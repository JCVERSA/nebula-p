import { safeFetch } from "../urlSafety.js";
import { decodeHtmlEntities, cleanForWhatsApp, domainOf } from "./webText.js";

/**
 * Recherche web (9.0) — deux moteurs derrière une même interface :
 *
 *  1. Tavily (OPTIONNEL, clé TAVILY_API_KEY dans .env) : API conçue pour
 *     l'IA, résultats de qualité avec dates de publication. L'owner
 *     s'inscrit lui-même sur tavily.com — la clé ne passe JAMAIS par le
 *     chat (règle 8.99 : « oublie juste mes cle »).
 *  2. DuckDuckGo HTML (SANS clé, défaut) : scraping de l'endpoint
 *     html.duckduckgo.com — zéro inscription, marche tout de suite. Peut
 *     être rate-limité occasionnellement ; la clé Tavily règle ça.
 *
 * Fraîcheur (demande owner : « toujours à l'actualité, sources récentes ») :
 * -d = dernières 24 h · -w = semaine · -m = mois · -y = année. Défaut :
 * PAS de filtre → toutes les années, classées par pertinence.
 *
 * Sécurité : tout passe par safeFetch (urlSafety.ts) — DNS épinglé,
 * localhost/IPs privées bloquées, tailles et timeouts plafonnés.
 */

export type SearchFreshness = "day" | "week" | "month" | "year";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
}

export interface WebSearchResult {
  hits: SearchHit[];
  engine: "duckduckgo" | "tavily";
}

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const TAVILY_URL = "https://api.tavily.com/search";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const FRESHNESS_LABELS: Record<SearchFreshness, string> = {
  day: "dernières 24 h",
  week: "dernière semaine",
  month: "dernier mois",
  year: "dernière année",
};

/** Construit l'URL DuckDuckGo HTML (pur — testé). */
export function buildDDGUrl(query: string, freshness?: SearchFreshness): string {
  const params = new URLSearchParams({ q: query });
  if (freshness) {
    params.set("df", freshness === "day" ? "d" : freshness === "week" ? "w" : freshness === "month" ? "m" : "y");
  }
  return `${DDG_HTML_URL}?${params.toString()}`;
}

/**
 * Décode un lien de redirection DuckDuckGo :
 * //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=… → l'URL réelle.
 */
export function extractRealUrl(href: string): string {
  try {
    const h = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(h, "https://duckduckgo.com");
    // Seules les redirections duckduckgo.com/l/?uddg=… sont décodées ;
    // un lien direct (ou une entrée quelconque) revient tel quel.
    if (u.hostname !== "duckduckgo.com") return href;
    return u.searchParams.get("uddg") || href;
  } catch {
    return href;
  }
}

function textOf(htmlFragment: string): string {
  return cleanForWhatsApp(decodeHtmlEntities(htmlFragment.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim());
}

/**
 * Parseur HTML DuckDuckGo — PUR, testé sur fixture.
 * Les publicités (liens duckduckgo.com/y.js) sont ignorées, les doublons
 * d'URL dédupliqués, la sortie est propre pour WhatsApp.
 */
export function parseDDGResults(html: string, maxHits = 6): SearchHit[] {
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const titles = [...html.matchAll(titleRe)];
  const snippets = [...html.matchAll(snippetRe)];

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < titles.length && hits.length < maxHits; i++) {
    const m = titles[i];
    const rawHref = m[1];
    // Publicités DDG : liens de tracking y.js
    if (/duckduckgo\.com\/y\.js/.test(rawHref)) continue;

    const url = extractRealUrl(rawHref.replace(/&amp;/g, "&"));
    if (!url || !/^https?:\/\//.test(url)) continue;
    if (seen.has(url)) continue;

    const title = textOf(m[2]);
    if (!title) continue;

    // Le snippet du même bloc : après ce titre, avant le titre suivant
    const nextTitleAt = titles[i + 1]?.index ?? html.length;
    const snippetMatch = snippets.find((s) => s.index! > m.index! && s.index! < nextTitleAt);
    const snippet = snippetMatch ? textOf(snippetMatch[1]) : "";

    seen.add(url);
    hits.push({ title, url, snippet: snippet.slice(0, 220), domain: domainOf(url) });
  }
  return hits;
}

/** Construit la requête Tavily (pur — testé sans réseau). */
export function buildTavilyRequest(
  query: string,
  freshness?: SearchFreshness,
): { url: string; body: string } {
  const payload: Record<string, unknown> = {
    query,
    max_results: 6,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
  };
  if (freshness) payload.time_range = freshness;
  return { url: TAVILY_URL, body: JSON.stringify(payload) };
}

/**
 * Recherche web — Tavily si clé présente, DuckDuckGo sinon.
 * Lance en cas d'échec réseau ; l'appelant dégrade proprement.
 */
export async function searchWeb(query: string, freshness?: SearchFreshness): Promise<WebSearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (apiKey) {
    const { url, body } = buildTavilyRequest(query, freshness);
    const res = await safeFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
      },
      3,
      { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
    );
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const hits: SearchHit[] = (Array.isArray(data?.results) ? data.results : [])
      .slice(0, 6)
      .map((r: any): SearchHit => ({
        title: cleanForWhatsApp(String(r?.title ?? "")),
        url: String(r?.url ?? ""),
        snippet: cleanForWhatsApp(String(r?.content ?? "")).slice(0, 220),
        domain: domainOf(String(r?.url ?? "")),
        publishedDate: r?.published_date ? String(r.published_date) : undefined,
      }))
      .filter((h: SearchHit) => h.title && /^https?:\/\//.test(h.url));
    return { hits, engine: "tavily" };
  }

  const res = await safeFetch(
    buildDDGUrl(query, freshness),
    { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en;q=0.8" } },
    3,
    { timeoutMs: 12_000, maxBytes: 2 * 1024 * 1024 },
  );
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  return { hits: parseDDGResults(html), engine: "duckduckgo" };
}
