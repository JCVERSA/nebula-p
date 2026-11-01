import axios from "axios";
import * as cheerio from "cheerio";

/**
 * 9.19h — origine DYNAMIQUE d'anime-sama (fin des 404 au déménagement).
 *
 * Terrain 01/11 : anime-sama.to renvoie 404 — le site déménage régulièrement
 * (.com, .me, .to, .si, .fr…) et le domaine était codé en dur à 8 endroits.
 * En parallèle, Cloudflare bloque les IP datacenter (« you have been
 * blocked » — sandbox/VPS, audit R3) : c'est un blocage d'IP, pas d'en-têtes.
 *
 * Technique des scrapers à jour (better-ani-scraped, juin 2026) : la page
 * lanceur anime-sama.pw ne contient qu'un BOUTON pointant vers le domaine
 * courant. On résout via elle, on suit la redirection finale, on cache
 * (TTL 24 h, single-flight) et on replie sur le dernier connu si elle est
 * muette. L'owner peut aussi figer NEBULA_SAMA_ORIGIN pour court-circuiter.
 */

const LAUNCHER_URL = "https://anime-sama.pw";
const FALLBACK_ORIGIN = "https://anime-sama.to";
const SAMA_TTL_MS = 24 * 60 * 60 * 1000;
const SAMA_TIMEOUT_MS = 8000;

let cached: { origin: string; at: number } | null = null;
let inflight: Promise<string> | null = null;

/** Pur : normalise une URL en origine (protocole + hôte, sans slash final). */
export function normalizeSamaOrigin(raw: string): string | null {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Pur : extrait l'origine du bouton lanceur (`.btn-primary`) d'une page. */
export function parseLauncherOrigin(html: string, baseUrl: string): string | null {
  try {
    const href = cheerio.load(String(html || ""))(".btn-primary").attr("href");
    if (!href) return null;
    return normalizeSamaOrigin(new URL(href, baseUrl).href);
  } catch {
    return null;
  }
}

/** Origine courante (sync, pour les Referer) : override owner > cache > repli. */
export function samaOrigin(): string {
  const env = (process.env.NEBULA_SAMA_ORIGIN || "").trim();
  if (env) return normalizeSamaOrigin(env) || FALLBACK_ORIGIN;
  if (cached && Date.now() - cached.at < SAMA_TTL_MS) return cached.origin;
  return cached?.origin || FALLBACK_ORIGIN;
}

/** Hôtes anime-sama de confiance pour l'allowlist (repli + domaine résolu). */
export function samaTrustedHosts(): string[] {
  const hosts = new Set<string>();
  for (const o of [FALLBACK_ORIGIN, samaOrigin()]) {
    const n = normalizeSamaOrigin(o);
    if (n) {
      try {
        hosts.add(new URL(n).host);
      } catch {}
    }
  }
  return [...hosts];
}

/** Résout/rafraîchit l'origine via le lanceur. Ne jette JAMAIS (repli). */
export async function ensureSamaOrigin(force = false): Promise<string> {
  if (inflight) return inflight;
  if (!force && cached && Date.now() - cached.at < SAMA_TTL_MS) return cached.origin;
  inflight = resolveFromLauncher().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function resolveFromLauncher(): Promise<string> {
  try {
    const res = await axios.get(LAUNCHER_URL, {
      timeout: SAMA_TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0" },
      validateStatus: () => true
    });
    const fromButton = parseLauncherOrigin(String(res?.data || ""), LAUNCHER_URL);
    if (!fromButton) return cached?.origin || FALLBACK_ORIGIN;
    // Le bouton peut rediriger vers le domaine final : on suit SANS le corps
    // (un 403 Cloudflare suffit — seul le DOMAINE nous intéresse).
    try {
      const probe = await axios.get(fromButton, {
        timeout: SAMA_TIMEOUT_MS,
        maxRedirects: 5,
        responseType: "stream",
        headers: { "User-Agent": "Mozilla/5.0" },
        validateStatus: () => true
      });
      const finalUrl = (probe?.request as any)?.res?.responseUrl || fromButton;
      try {
        (probe?.data as any)?.destroy?.();
      } catch {}
      cached = { origin: normalizeSamaOrigin(finalUrl) || fromButton, at: Date.now() };
    } catch {
      cached = { origin: fromButton, at: Date.now() };
    }
    return cached.origin;
  } catch {
    // Lanceur muet : dernier domaine connu, sinon repli historique.
    return cached?.origin || FALLBACK_ORIGIN;
  }
}

/** Test hooks. */
export function __resetSamaOriginForTests(): void {
  cached = null;
  inflight = null;
}
export function __setSamaOriginForTests(origin: string | null): void {
  cached = origin ? { origin, at: Date.now() } : null;
}
