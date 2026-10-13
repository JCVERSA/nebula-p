/**
 * 9.18q — Extracteur TikTok AUTONOME (filet préventif, décision owner du
 * 14/10 après la mort d'igdl : la commande `.tiktok` dépend d'UN seul site
 * tiers, tikwm.com — même fragilité que `.instagram` avant 9.18p : le jour
 * où tikwm change ou rate-limit, la commande meurt en silence).
 *
 * Ce module ne dépend d'AUCUN site tiers : il lit la page TikTok elle-même.
 *
 *   1. Résolution des liens courts (vm./vt.tiktok.com → URL finale) ;
 *   2. GET de la page vidéo avec un UA navigateur (servie sans login) ;
 *   3. Parse du JSON d'hydratation embarqué — les DEUX formats que TikTok
 *      a utilisés : __UNIVERSAL_DATA_FOR_REHYDRATION__ (actuel) et
 *      SIGI_STATE (ancien) → playAddr / downloadAddr / cover / auteur /
 *      durée / description.
 *
 * Sécurité : requêtes UNIQUEMENT vers *.tiktok.com (hôte validé), aucun
 * cookie ni login, timeout 15 s. Échec → null / { } (l'appelant décide du
 * message honnête). Le parseur (parseTikTokPageHtml) est PUR — testé avec
 * des fixtures, sans réseau.
 */
import axios from "axios";

export interface TikTokExtraction {
  videoUrl: string;
  coverUrl?: string;
  title?: string;
  author?: string;
  durationSec?: number;
  /** 9.18t : identifiant numérique — clé du cache 5 h. */
  videoId?: string;
  strategy: "page";
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15000;

/** Liens courts TikTok → à résoudre avant de parser quoi que ce soit. */
export function isTikTokShortLink(url: string): boolean {
  return /^https?:\/\/(?:vm|vt)\.tiktok\.com\//i.test(String(url || "").trim());
}

/** Valide qu'une URL est bien un hôte TikTok (jamais d'autre hôte en entrée de requête). */
export function isTikTokUrl(url: string): boolean {
  try {
    const u = new URL(String(url || "").trim());
    return /(^|\.)tiktok\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Suit les redirections d'un lien court et rend l'URL vidéo finale (repli : l'entrée). */
async function resolveShortLink(url: string): Promise<string> {
  if (!isTikTokShortLink(url)) return url;
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*;q=0.8" },
      responseType: "text",
      validateStatus: () => true
    });
    const finalUrl: string | undefined =
      (res.request as any)?.res?.responseUrl || (res.request as any)?._redirectable?._currentUrl;
    if (finalUrl && isTikTokUrl(finalUrl)) return finalUrl;
  } catch (err: any) {
    console.warn(`[TT_EXTRACTOR] short link resolution failed: ${err?.message || err}`);
  }
  return url;
}

interface ParsedTikTokItem {
  videoUrl?: string;
  coverUrl?: string;
  title?: string;
  author?: string;
  durationSec?: number;
  videoId?: string;
}

/** Extrait l'item vidéo du JSON d'hydratation — gère les deux schémas TikTok. */
function pickItem(payload: any): ParsedTikTokItem | null {
  if (!payload || typeof payload !== "object") return null;

  // Format actuel : __DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct
  const universal = payload?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (universal?.video) {
    return {
      videoUrl: universal.video.playAddr || universal.video.downloadAddr,
      coverUrl: universal.video.cover || universal.video.originCover,
      title: universal.desc,
      author: universal.author?.nickname,
      durationSec: universal.video.duration,
      videoId: universal.id ? String(universal.id) : undefined
    };
  }

  // Format ancien : ItemModule[<videoId>] (n'importe quelle clé du module).
  const itemModule = payload?.ItemModule;
  if (itemModule && typeof itemModule === "object") {
    const first: any = Object.values(itemModule)[0];
    if (first?.video) {
      return {
        videoUrl: first.video.playAddr || first.video.downloadAddr,
        coverUrl: first.video.cover || first.video.originCover,
        title: first.desc,
        author: first.author?.nickname,
        durationSec: first.video.duration,
        videoId: first.id ? String(first.id) : undefined
      };
    }
  }
  return null;
}

/**
 * Parse le HTML d'une page vidéo TikTok — PUR (testable sans réseau).
 * Cherche les balises <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> puis
 * <script id="SIGI_STATE">, décode leur JSON, en tire le média.
 */
export function parseTikTokPageHtml(html: string): ParsedTikTokItem | null {
  const page = String(html || "");
  if (!page) return null;
  for (const scriptId of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
    const m = page.match(
      new RegExp(`<script[^>]*id=["']${scriptId}["'][^>]*>([\\s\\S]*?)</script>`, "i")
    );
    if (!m) continue;
    try {
      const item = pickItem(JSON.parse(m[1]));
      if (item?.videoUrl) return item;
    } catch {
      // JSON tronqué/illisible → format suivant
    }
  }
  return null;
}

/**
 * Point d'entrée : URL TikTok (longue ou courte) → média de la page.
 * Retourne null si l'URL n'est pas TikTok ; { videoUrl: undefined } si la
 * page n'a rien livré (vidéo privée/supprimée, mur anti-bot).
 */
export async function extractTikTokMedia(rawUrl: string): Promise<TikTokExtraction | null> {
  const url = String(rawUrl || "").trim();
  if (!isTikTokUrl(url)) return null;

  const pageUrl = await resolveShortLink(url);
  try {
    const res = await axios.get<string>(pageUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        Referer: "https://www.tiktok.com/"
      },
      responseType: "text",
      validateStatus: () => true
    });
    if (res.status !== 200 || typeof res.data !== "string") return null;
    const item = parseTikTokPageHtml(res.data);
    if (!item?.videoUrl) return null;
    return {
      videoUrl: item.videoUrl,
      coverUrl: item.coverUrl,
      title: item.title,
      author: item.author,
      durationSec: item.durationSec,
      videoId: item.videoId,
      strategy: "page"
    };
  } catch (err: any) {
    console.warn(`[TT_EXTRACTOR] page fetch failed: ${err?.message || err}`);
    return null;
  }
}
