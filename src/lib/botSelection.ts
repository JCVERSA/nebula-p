/**
 * Multi-bots (8.77) — sélection du bot actif côté panneau.
 *
 * Le panneau superviseur proxifie les routes par-bot vers le moteur demandé
 * via le paramètre `?bot=<id>` (ou l'en-tête x-nebula-bot). Sans sélecteur,
 * les requêtes partent vers le bot par défaut (premier slot activé) —
 * comportement historique préservé à l'identique.
 */

/** Routes servies par le moteur d'un bot précis (pas par le panneau). */
const PER_BOT_PREFIXES = ["/api/bot/", "/api/gemini/", "/api/batch-downloads"];

export function isPerBotUrl(url: string): boolean {
  if (url === "/api/bot") return true;
  return PER_BOT_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Ajoute le sélecteur de bot à une URL d'API si (et seulement si) un bot
 * non-défaut est sélectionné et que la route est bien une route par-bot.
 * Les routes du panneau (/api/auth, /api/bots, /api/health, /d/…) et les
 * URL externes ne sont jamais modifiées.
 */
export function withBotParam(url: string, botId: string | null | undefined): string {
  if (!botId) return url;
  if (!isPerBotUrl(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}bot=${encodeURIComponent(botId)}`;
}
