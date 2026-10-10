import { BotCommand } from "../types.js";
import { safeFetch } from "../urlSafety.js";
import { htmlToText, capText, domainOf } from "../services/webText.js";
import { checkWebQuota, consumeWebQuota } from "../webQuota.js";

/**
 * .fetch (9.0) — lire une page web en texte propre dans WhatsApp.
 *
 * Sécurité (SAFETY.md) : tout passe par safeFetch (urlSafety.ts) :
 *   - localhost / IPs privées / .internal REFUSÉS → le panneau et le
 *     moteur (même conteneur) ne sont pas atteignables ;
 *   - DNS épinglé : la redirection ne peut pas rebondir vers le privé ;
 *   - 2 Mo max, 15 s max, 4 redirections max.
 * Contenu : texte/HTML/JSON uniquement. Le texte extrait est une DONNÉE
 * affichée telle quelle — aucune IA ne le lit, aucune commande ne
 * s'exécute à partir de lui (anti-injection par construction).
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_TEXT_CHARS = 2800;

function isReadableContentType(ctype: string): boolean {
  const c = ctype.toLowerCase();
  return (
    c.startsWith("text/") ||
    c === "application/json" ||
    c === "application/xml" ||
    c.endsWith("+xml") ||
    c.endsWith("+json")
  );
}

const fetchCommand: BotCommand = {
  name: "fetch",
  aliases: ["read", "lire"],
  category: "General",
  description: "Lire une page web en texte (article, documentation, JSON)",
  usage: ".fetch <url>",
  execute: async (sock, msg, context) => {
    if (context.args.length === 0) {
      await context.reply(
        "❌ *Il manque l'adresse.*\n\nExemple : `.fetch https://fr.wikipedia.org/wiki/Cameroun`",
      );
      return;
    }

    let url = context.args.join(" ").trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      await context.reply("❌ *Adresse invalide.*");
      return;
    }

    const quota = checkWebQuota(context.sender);
    if (!quota.allowed) {
      await context.reply(
        `📅 *Limite web du jour atteinte* (${quota.limit} recherches/lectures par jour).\n_Réessaie demain._`,
      );
      return;
    }

    await context.react("📄");
    try {
      const res = await safeFetch(
        url,
        { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" } },
        4,
        { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
      );
      if (!res.ok) {
        await context.reply(`😕 *La page a répondu ${res.status}* — elle est peut-être indisponible ou protégée.`);
        return;
      }

      const ctype = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!isReadableContentType(ctype)) {
        await context.reply(
          `📄 *Type non pris en charge* (${ctype || "inconnu"}).\n_Je lis les pages web et le texte — pas les images, vidéos ou archives (utilise .sweb pour une capture)._`,
        );
        return;
      }

      const raw = await res.text();
      let text: string;
      if (ctype.includes("json")) {
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          text = raw;
        }
      } else if (ctype.includes("html") || ctype === "text/xml" || ctype.endsWith("+xml")) {
        text = htmlToText(raw);
      } else {
        text = raw;
      }

      if (!text.trim()) {
        await context.reply("📄 *Page vide ou illisible* (rendu JavaScript probablement requis).");
        return;
      }
      consumeWebQuota(context.sender);

      const domain = domainOf(url) || url;
      await context.reply(
        `📄 *${domain}*\n\n${capText(text, MAX_TEXT_CHARS)}\n\n🔗 ${url}`.trim(),
      );
    } catch (e: any) {
      console.error("Fetch command error:", e?.message || e);
      const reason = /Blocked unsafe URL/i.test(e?.message || "")
        ? "_Adresse refusée (réseau interne interdit)._"
        : /exceeds the/i.test(e?.message || "")
          ? "_Page trop volumineuse._"
          : "_Vérifie l'adresse et réessaie._";
      await context.reply(`❌ *Lecture impossible.*\n${reason}`);
    }
  },
};

export default fetchCommand;
