import { BotCommand } from "../types.js";
import { searchWeb, FRESHNESS_LABELS, type SearchFreshness } from "../services/webSearch.js";
import { capText } from "../services/webText.js";
import { checkWebQuota, consumeWebQuota } from "../webQuota.js";

/**
 * .search (9.0) — recherche web sans clé, résultats de vraies sources.
 *
 * Fraîcheur (owner : « toujours à l'actualité, sources récentes ») :
 *   .search -d <q>  → dernières 24 h     .search -w <q> → dernière semaine
 *   .search -m <q>  → dernier mois       .search -y <q> → dernière année
 * Défaut : pas de filtre — toutes les années, pertinence d'abord.
 *
 * 0 token IA (commande directe, exécutable par l'agent), quota web
 * partagé (NEBULA_WEB_DAILY_LIMIT, défaut 20/jour/utilisateur).
 * Transparence M11 : le moteur (DuckDuckGo ou Tavily) voit la requête.
 */

const FRESHNESS_FLAGS: Record<string, SearchFreshness> = {
  "-d": "day", "-j": "day", "-hier": "day",
  "-w": "week", "-s": "week", "-semaine": "week",
  "-m": "month", "-mois": "month",
  "-y": "year", "-an": "year", "-annee": "year",
};

/** Parse les flags de fraîcheur (pur — testé). Le 1er flag gagne. */
export function parseSearchArgs(args: string[]): { query: string; freshness?: SearchFreshness } {
  let freshness: SearchFreshness | undefined;
  const rest: string[] = [];
  for (const a of args) {
    const f = FRESHNESS_FLAGS[a.toLowerCase()];
    if (f && !freshness) freshness = f;
    else rest.push(a);
  }
  return { query: rest.join(" ").trim(), freshness };
}

const USAGE = (p: string) => `🔍 *Recherche web*

${p}search <requête> — recherche sur le web (toutes années)
${p}search -w <requête> — limité à la dernière semaine
${p}search -d <requête> — dernières 24 h · ${p}search -m mois · ${p}search -y année

Exemples :
• ${p}search résultats loto cameroun
• ${p}search -w canon de la victoire

_La requête est transmise au moteur de recherche (DuckDuckGo)._`;

const searchCommand: BotCommand = {
  name: "search",
  aliases: ["recherche", "websearch"],
  category: "General",
  description: "Rechercher sur le web (vraies sources, fraîcheur au choix)",
  usage: ".search [-d|-w|-m|-y] <requête>",
  execute: async (sock, msg, context) => {
    const { query, freshness } = parseSearchArgs(context.args);
    if (!query) {
      await context.reply(USAGE(context.prefix));
      return;
    }

    const quota = checkWebQuota(context.sender);
    if (!quota.allowed) {
      await context.reply(
        `📅 *Limite web du jour atteinte* (${quota.limit} recherches/lectures par jour).\n_Réessaie demain — la limite protège l'IP du serveur._`,
      );
      return;
    }

    await context.react("🔍");
    try {
      const { hits, engine } = await searchWeb(query, freshness);
      if (hits.length === 0) {
        await context.reply(
          `🤷 *Aucun résultat pour « ${query} ».*\n_Essaie d'autres mots-clés, ou vérifie l'orthographe._`,
        );
        return;
      }
      consumeWebQuota(context.sender);

      const period = freshness ? ` — _${FRESHNESS_LABELS[freshness]}_` : "";
      let text = `🔍 *Recherche — ${query}*${period}\n`;
      hits.forEach((h, i) => {
        text += `\n${i + 1}. *${h.title}*\n`;
        if (h.publishedDate) text += `   📅 ${h.publishedDate.slice(0, 10)} — `;
        else text += `   `;
        text += `${capText(h.snippet, 180)}\n`;
        if (h.domain) text += `   🔗 ${h.url}\n`;
      });
      text += `\n_Via ${engine === "tavily" ? "Tavily" : "DuckDuckGo"} — la requête leur est transmise._`;
      await context.reply(text.trim());
    } catch (e: any) {
      console.error("Search command error:", e?.message || e);
      await context.reply(
        "😕 *Recherche indisponible pour le moment.*\n_Réessaie dans un instant._",
      );
    }
  },
};

export default searchCommand;
