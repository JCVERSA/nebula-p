import { BotCommand } from "../types.js";

/**
 * `.ytlink` / `.yts` — portage natif de l'original neb (media/ytlink.js,
 * owner request 8.59) : recherche YouTube pure, renvoie les 3 premiers
 * résultats. Adaptation : messages FR + timeout durci.
 */

async function ytsSearch(query: string): Promise<{ videos: Array<{ title?: string; url?: string; timestamp?: string; views?: number; author?: { name?: string } }> }> {
  const mod = await import("yt-search");
  const yts = (mod as { default: (q: string) => Promise<any> }).default;
  return Promise.race([
    yts(query),
    new Promise<any>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))
  ]);
}

const ytlinkCommand: BotCommand = {
  name: "ytlink",
  aliases: ["ytsearch", "yts", "youtubelink"],
  category: "Media",
  description: "Rechercher sur YouTube et obtenir les liens.",
  usage: ".yts <nom de chanson ou vidéo>",
  execute: async (_sock, _msg, context) => {
    try {
      const args = context.args || [];
      if (!args[0]) {
        return void (await context.reply(
          "🎵 *Usage:* `.yts <nom de chanson ou vidéo>`\n\nEx:\n  `.yts Bohemian Rhapsody Queen`\n  `.yts lofi hip hop chill`"
        ));
      }

      const query = args.join(" ");
      await context.reply("🔍 Recherche sur YouTube...");

      const result = await ytsSearch(query);
      const videos = (result?.videos || []).slice(0, 3);

      if (!videos.length) {
        return void (await context.reply("❌ Aucun résultat — essaie un autre terme."));
      }

      let text = `🎵 *Résultats YouTube*\n\nRecherche : _${query}_\n\n`;
      videos.forEach((v, i) => {
        text += `${i + 1}. *${v.title || "Sans titre"}*\n`;
        text += `   👤 ${v.author?.name || "Inconnu"}\n`;
        text += `   ⏱️ ${v.timestamp || "?"} | 👁️ ${(v.views || 0).toLocaleString("fr-FR")} vues\n`;
        text += `   🔗 ${v.url || ""}\n\n`;
      });
      await context.reply(text.trim());
    } catch {
      await context.reply("❌ La recherche a échoué.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default ytlinkCommand;
