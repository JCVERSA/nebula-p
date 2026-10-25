import { safeFetch } from "../urlSafety.js";
import { domainOf } from "./webText.js";

/**
 * 9.18uuuu — Recherche d'images UNIVERSELLE (outil interne Nova `img`).
 *
 * Retour terrain 24/10 (Dark Neon / Jor Orange) : « envoie-moi une photo de
 * Jungkook » → l'agent répondait « je ne peux pas envoyer d'images » alors
 * que le bot SAIT envoyer des images (cards welcome/goodbye) — il ne lui
 * manquait que l'OUTIL DE RECHERCHE. Décision owner 25/10 : Wikipédia +
 * Tavily images, UNIVERSAL (tout le web — presse, bases d'images, Pinterest
 * quand c'est pertinent, jamais limité à une source), 6 images par demande.
 *
 * Deux moteurs, même interface (modèle webSearch.ts) :
 *
 *  1. Wikipédia FR (keyless) : l'API action=query+pageimages retourne la
 *     vignette des meilleurs pages qui matchent — la photo OFFICIELLE des
 *     sujets connus (personnes, lieux, œuvres). Toujours essayée en premier.
 *  2. Tavily images (clé TAVILY_API_KEY, optionnelle — déjà utilisée par
 *     .search) : include_images + include_image_descriptions → images du
 *     web ENTIER avec descriptions, pour tout ce que Wikipédia ne couvre pas.
 *
 * Sécurité : chaque téléchargement passe par safeFetch (urlSafety.ts) — DNS
 * épinglé, localhost/IPs privées bloquées, timeout et taille plafonnés —
 * et n'est accepté QUE si le content-type est une image WhatsApp-envoyable
 * (jpeg/png/webp/gif). Un téléchargement raté n'arrête JAMAIS les autres.
 */

/** Nombre d'images envoyées par demande (décision owner 25/10). */
export const IMAGE_SEND_LIMIT = 6;

/** Taille max par image téléchargée (les images WhatsApp sont bien en dessous). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Content-types acceptés (WhatsApp sait envoyer jpeg/png/webp/gif — pas svg). */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const WIKI_API = "https://fr.wikipedia.org/w/api.php";
// La fondation Wikimedia demande un User-Agent descriptif pour ses APIs.
const WIKI_UA = "NebulaBot/9.0 (assistant WhatsApp; https://github.com/JCVERSA/p)";
const TAVILY_URL = "https://api.tavily.com/search";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const WIKI_FETCH_LIMITS = { timeoutMs: 12_000, maxBytes: 512 * 1024 };
const IMAGE_FETCH_LIMITS = { timeoutMs: 15_000, maxBytes: IMAGE_MAX_BYTES };

export interface ImageCandidate {
  /** URL directe de l'image (https uniquement). */
  url: string;
  /** "wikipedia" (photo officielle) ou "web" (images web universelles). */
  source: "wikipedia" | "web";
  /** Attribution lisible pour la légende (« Wikipédia » ou le domaine). */
  attribution: string;
  /** Description quand le moteur en fournit une (choix plus pertinent). */
  description?: string;
}

export interface ImageSearchOutcome {
  candidates: ImageCandidate[];
  /** Moteurs qui ont répondu (note d'honnêteté dans les logs/observations). */
  engines: string[];
}

/** Construit l'URL Wikipédia pageimages (pur — testé). */
export function buildWikiImagesUrl(query: string): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "4",
    gsrnamespace: "0",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "1200",
  });
  return `${WIKI_API}?${params.toString()}`;
}

/** Parse la réponse Wikipédia pageimages (pur — testé sur fixture). */
export function parseWikiImages(data: any): ImageCandidate[] {
  const pages = data?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  return Object.values(pages as Record<string, any>)
    .filter((p) => typeof p?.thumbnail?.source === "string" && /^https?:\/\//.test(p.thumbnail.source))
    .sort((a, b) => (a.index ?? 999) - (b.index ?? 999))
    .map((p) => ({
      url: p.thumbnail.source as string,
      source: "wikipedia" as const,
      attribution: "Wikipédia",
      description: typeof p?.title === "string" ? p.title : undefined,
    }));
}

/** Construit la requête Tavily avec images (pur — testé sans réseau). */
export function buildTavilyImageRequest(query: string): { url: string; body: string } {
  const payload = {
    query,
    max_results: 6,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
    include_images: true,
    include_image_descriptions: true,
  };
  return { url: TAVILY_URL, body: JSON.stringify(payload) };
}

/**
 * Parse la réponse Tavily (pur) : images de premier niveau
 * ({url, description} ou chaînes nues) + images par résultat.
 */
export function parseTavilyImages(data: any): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (raw: any) => {
    const url = typeof raw === "string" ? raw : typeof raw?.url === "string" ? raw.url : "";
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      source: "web",
      attribution: domainOf(url),
      description: typeof raw?.description === "string" ? raw.description : undefined,
    });
  };
  if (Array.isArray(data?.images)) data.images.forEach(push);
  if (Array.isArray(data?.results)) {
    for (const r of data.results) {
      if (Array.isArray(r?.images)) r.images.forEach(push);
    }
  }
  return out;
}

/** Fusionne les candidats : Wikipédia d'abord, dédupliqué, plafonné (pur). */
export function mergeImageCandidates(
  wiki: ImageCandidate[],
  web: ImageCandidate[],
  limit = IMAGE_SEND_LIMIT,
): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const c of [...wiki, ...web]) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Recherche d'images — Wikipédia toujours (keyless), Tavily si clé.
 * Best-effort : un moteur en panne ne doit jamais faire échouer l'autre.
 */
export async function findImageCandidates(query: string): Promise<ImageSearchOutcome> {
  const engines: string[] = [];
  let wiki: ImageCandidate[] = [];
  let web: ImageCandidate[] = [];

  try {
    const res = await safeFetch(
      buildWikiImagesUrl(query),
      { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } },
      2,
      WIKI_FETCH_LIMITS,
    );
    if (res.ok) {
      wiki = parseWikiImages(await res.json());
      if (wiki.length > 0) engines.push("wikipédia");
    }
  } catch {
    /* best-effort */
  }

  if (process.env.TAVILY_API_KEY) {
    try {
      const { url, body } = buildTavilyImageRequest(query);
      const res = await safeFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
          body,
        },
        2,
        { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
      );
      if (res.ok) {
        web = parseTavilyImages(await res.json());
        if (web.length > 0) engines.push("images web");
      }
    } catch {
      /* best-effort */
    }
  }

  return { candidates: mergeImageCandidates(wiki, web), engines };
}

/**
 * Télécharge UNE image en sécurité. Retourne null si ce n'est pas une image
 * envoyable (content-type), trop grosse, ou en échec réseau — l'appelant
 * saute simplement ce candidat.
 */
export async function downloadImageCandidate(
  url: string,
): Promise<{ buffer: Buffer; ext: string } | null> {
  try {
    const res = await safeFetch(
      url,
      { headers: { "User-Agent": BROWSER_UA, Accept: "image/*" } },
      1,
      IMAGE_FETCH_LIMITS,
    );
    if (!res.ok) return null;
    const contentType = String(res.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > IMAGE_MAX_BYTES) return null;
    return { buffer, ext };
  } catch {
    return null;
  }
}
