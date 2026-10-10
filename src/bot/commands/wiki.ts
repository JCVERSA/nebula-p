import { BotCommand } from "../types.js";
import { safeFetch } from "../urlSafety.js";
import { capText } from "../services/webText.js";
import { checkWebQuota, consumeWebQuota } from "../webQuota.js";

/**
 * .wiki (9.0) — Wikipédia FR, keyless et ultra fiable.
 *
 * Flux : opensearch (résout le meilleur titre pour l'orthographe de
 * l'utilisateur) → REST summary (extrait propre + lien canonique).
 * Les pages d'homonymie sont signalées au lieu d'afficher une liste.
 */

const WIKI_API = "https://fr.wikipedia.org/w/api.php";
const WIKI_SUMMARY = "https://fr.wikipedia.org/api/rest_v1/page/summary/";
// La fondation Wikimedia demande un User-Agent descriptif pour ses APIs.
const WIKI_UA = "NebulaBot/9.0 (assistant WhatsApp; https://github.com/JCVERSA/p)";

const FETCH_LIMITS = { timeoutMs: 12_000, maxBytes: 512 * 1024 };

const wikiCommand: BotCommand = {
  name: "wiki",
  aliases: ["wikipedia", "encyclopedie"],
  category: "General",
  description: "Résumé encyclopédique Wikipédia FR d'un sujet",
  usage: ".wiki <sujet>",
  execute: async (sock, msg, context) => {
    const subject = context.args.join(" ").trim();
    if (!subject) {
      await context.reply("📚 *Wikipédia FR*\n\nExemple : `.wiki Cameroun`");
      return;
    }

    const quota = checkWebQuota(context.sender);
    if (!quota.allowed) {
      await context.reply(`📅 *Limite web du jour atteinte* (${quota.limit}/jour) — réessaie demain.`);
      return;
    }

    await context.react("📚");
    try {
      // 1. Résolution du titre (tolère l'orthographe approximative)
      const searchUrl = `${WIKI_API}?action=opensearch&format=json&limit=1&namespace=0&search=${encodeURIComponent(subject)}`;
      const searchRes = await safeFetch(
        searchUrl,
        { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } },
        3,
        FETCH_LIMITS,
      );
      if (!searchRes.ok) throw new Error(`opensearch HTTP ${searchRes.status}`);
      const found = (await searchRes.json()) as [string, string[], string[], string[]];
      const title = found?.[1]?.[0];
      const canonicalUrl = found?.[3]?.[0];
      if (!title) {
        await context.reply(
          `🤷 *Aucun article Wikipédia FR trouvé pour « ${subject} ».*\n_Vérifie l'orthographe, ou essaie en anglais._`,
        );
        return;
      }

      // 2. Résumé propre
      const summaryRes = await safeFetch(
        WIKI_SUMMARY + encodeURIComponent(title),
        { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } },
        3,
        FETCH_LIMITS,
      );
      if (!summaryRes.ok) throw new Error(`summary HTTP ${summaryRes.status}`);
      const summary = (await summaryRes.json()) as any;
      consumeWebQuota(context.sender);

      if (summary?.type === "disambiguation") {
        await context.reply(
          `🔀 *« ${title} » est une page d'homonymie.*\n_Précise ton sujet (ex. \`.wiki ${title} (ville)\`)._\n\n🔗 ${canonicalUrl || summary?.content_urls?.desktop?.page || ""}`,
        );
        return;
      }

      const extract = String(summary?.extract || "");
      if (!extract) {
        await context.reply(
          `📚 *${title}*\n_L'article existe mais sans résumé lisible — ouvre le lien :_\n\n🔗 ${canonicalUrl || ""}`,
        );
        return;
      }

      await context.reply(
        `📚 *${title}*\n\n${capText(extract, 1600)}\n\n🔗 ${canonicalUrl || summary?.content_urls?.desktop?.page || ""}\n_Wikipédia FR_`.trim(),
      );
    } catch (e: any) {
      console.error("Wiki command error:", e?.message || e);
      await context.reply("😕 *Wikipédia ne répond pas.*\n_Réessaie dans un instant._");
    }
  },
};

export default wikiCommand;
