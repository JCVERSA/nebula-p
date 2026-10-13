/**
 * 9.18p — Extracteur Instagram AUTONOME (retour terrain 14/10 03:06 :
 * reel DeZL1mfhKjw — « Aucun média trouvé » sur les DEUX backends obfusqués
 * du paquet ruhend-scraper, qui parsent le HTML de sites tiers snap­save/
 * fapper : le jour où ces sites changent leur HTML ou mettent un mur
 * Cloudflare, la commande meurt en silence).
 *
 * Ce module ne dépend d'AUCUN site tiers ni login : deux stratégies
 * anonymes éprouvées, essayées dans l'ordre :
 *
 *   1. EMBED — GET https://www.instagram.com/p/<sc>/embed/captioned/
 *      (page d'intégration publique, servie sans login) ; le média s'y
 *      trouve sous forme de JSON échappé ("video_url":"…\/…") ou de balises
 *      og:video / og:image / <img class="EmbeddedMediaImage">.
 *
 *   2. API WEB — GET https://www.instagram.com/api/v1/media/<pk>/info/
 *      avec l'app-ID public du web Instagram (x-ig-app-id: 936619743392459,
 *      présent dans chaque page instagram.com) ; le pk média se dérive du
 *      shortcode (base64 URL-safe → BigInt, algorithme standard).
 *
 * Sécurité : requêtes UNIQUEMENT vers www.instagram.com (hôte codé en dur),
 * shortcode validé [A-Za-z0-9_-] — aucune URL utilisateur n'est passée telle
 * quelle à un serveur (zéro SSRF). Timeouts 15 s. Échec → null (l'appelant
 * décide du message honnête).
 *
 * Pur et testable à plat (le réseau vit dans les deux fonctions privées,
 * injectables via les tests d'intégration à la demande).
 */
import axios from "axios";

export interface InstagramMediaItem {
  url: string;
  type: "video" | "image";
}

export interface InstagramExtraction {
  items: InstagramMediaItem[];
  strategy: "embed" | "api";
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** App-ID public du client web Instagram (présent dans chaque page servie). */
const IG_WEB_APP_ID = "936619743392459";

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Extrait le shortcode d'une URL Instagram — formes acceptées :
 * /p/<sc>, /reel/<sc>, /reels/<sc>, /tv/<sc>, /share/(reel|p)/<sc>,
 * domaines instagram.com et instagr.am, query params ignorés
 * (retour terrain : ?exln=… n'a jamais été le problème, mais autant
 * l'ignorer structurellement).
 */
const SHORTCODE_RE =
  /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})/i;

export function instagramShortcode(rawUrl: string): string | null {
  const m = String(rawUrl || "").match(SHORTCODE_RE);
  return m ? m[1] : null;
}

/** Alphabet base64 URL-safe utilisé par les shortcodes Instagram. */
const IG_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Shortcode → identifiant média numérique (pk) — base64 → BigInt.
 * Algorithme standard (identique aux libs instagram-id-to-shortcode) :
 * chaque caractère ajoute sa valeur × 64^poids. Retourne le pk en chaîne
 * décimale (18-19 chiffres typiquement), ou null si caractère inconnu.
 */
export function mediaPkFromShortcode(shortcode: string): string | null {
  const sc = String(shortcode || "");
  if (!/^[A-Za-z0-9_-]+$/.test(sc)) return null;
  let pk = 0n;
  for (const ch of sc) {
    const idx = IG_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    pk = pk * 64n + BigInt(idx);
  }
  return pk.toString();
}

/** Dé-échappe un fragment JSON capturé dans du HTML ("https:\/\/…" → URL). */
function unescapeJsonFragment(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
  }
}

function pushUnique(items: InstagramMediaItem[], url: string, type: "video" | "image") {
  const clean = (url || "").trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return;
  if (items.some((i) => i.url === clean)) return;
  items.push({ url: clean, type });
}

/** Stratégie 1 — page embed publique (sans login). */
async function extractFromEmbed(shortcode: string): Promise<InstagramMediaItem[]> {
  const res = await axios.get<string>(
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
      },
      responseType: "text",
      validateStatus: () => true
    }
  );
  if (res.status !== 200 || typeof res.data !== "string") return [];
  const html = res.data;
  const items: InstagramMediaItem[] = [];

  // Vidéos : JSON échappé dans les scripts de la page embed.
  for (const m of html.matchAll(/"video_url"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    pushUnique(items, unescapeJsonFragment(m[1]), "video");
  }
  // Vidéos : balise og:video.
  const ogVideo = html.match(/property=["']og:video["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:video["']/i);
  if (ogVideo) pushUnique(items, ogVideo[1], "video");
  // Images : og:image puis <img class="EmbeddedMediaImage">.
  const ogImage = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogImage) pushUnique(items, ogImage[1], "image");
  for (const m of html.matchAll(/<img[^>]*class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*>/gi)) {
    const src = m[0].match(/src=["']([^"']+)["']/i);
    if (src) pushUnique(items, src[1], "image");
  }
  return items;
}

/** Stratégie 2 — API web avec l'app-ID public. */
async function extractFromApi(shortcode: string): Promise<InstagramMediaItem[]> {
  const pk = mediaPkFromShortcode(shortcode);
  if (!pk) return [];
  const res = await axios.get<any>(`https://www.instagram.com/api/v1/media/${pk}/info/`, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "*/*",
      "x-ig-app-id": IG_WEB_APP_ID,
      Referer: `https://www.instagram.com/reel/${shortcode}/`
    },
    validateStatus: () => true
  });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.items)) return [];
  const items: InstagramMediaItem[] = [];

  const pushItem = (entry: any) => {
    if (!entry || typeof entry !== "object") return;
    const video = Array.isArray(entry.video_versions) && entry.video_versions[0]?.url;
    if (video) {
      pushUnique(items, String(video), "video");
      return;
    }
    const image = Array.isArray(entry.image_versions2?.candidates) && entry.image_versions2.candidates[0]?.url;
    if (image) pushUnique(items, String(image), "image");
  };

  for (const entry of res.data.items) {
    pushItem(entry);
    // Carrousels : chaque sous-média (photo ou vidéo).
    if (Array.isArray(entry?.carousel_media)) {
      for (const sub of entry.carousel_media) pushItem(sub);
    }
  }
  return items;
}

/**
 * Point d'entrée : URL Instagram → médias. Essaie embed puis API web.
 * Retourne null si l'URL n'est pas exploitable ; { items: [] } si les deux
 * stratégies n'ont rien trouvé (post privé, rate-limit…).
 */
export async function extractInstagramMedia(rawUrl: string): Promise<InstagramExtraction | null> {
  const shortcode = instagramShortcode(rawUrl);
  if (!shortcode) return null;

  try {
    const items = await extractFromEmbed(shortcode);
    if (items.length > 0) return { items, strategy: "embed" };
  } catch (err: any) {
    console.warn(`[IG_EXTRACTOR] embed strategy failed: ${err?.message || err}`);
  }

  try {
    const items = await extractFromApi(shortcode);
    if (items.length > 0) return { items, strategy: "api" };
  } catch (err: any) {
    console.warn(`[IG_EXTRACTOR] api strategy failed: ${err?.message || err}`);
  }

  return { items: [], strategy: "embed" };
}
