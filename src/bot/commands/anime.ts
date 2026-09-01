import { BotCommand } from "../types.js";
import { searchAnimeInfo, pickBestMatch, formatAnimeCard } from "../services/jikanClient.js";

const animeCommand: BotCommand = {
  name: "anime",
  category: "Anime",
  description: "Anime info card from MyAnimeList: poster, score, episodes, synopsis (French labels).",
  usage: "anime <title>",
  execute: async (sock, msg, context) => {
    const args = context.args || [];
    const query = args.join(" ").trim();

    if (!query) {
      return context.reply(
        `❌ Usage: \`.anime <titre>\`\n\nExemples:\n` +
          `• \`.anime naruto\`\n• \`.anime tomb raider king\`\n• \`.anime sparks of tomorrow\`\n\n` +
          `_Fiche MyAnimeList : poster, note, épisodes, synopsis._`
      );
    }

    await context.react("🎬");

    try {
      const results = await searchAnimeInfo(query, 5);
      if (results.length === 0) {
        return context.reply(`❌ Aucune fiche trouvée pour *"${query}"* sur MyAnimeList.\nVérifie l'orthographe ou réessaie avec le titre anglais/japonais.`);
      }

      const best = pickBestMatch(query, results)!;
      const card = formatAnimeCard(best, false);

      if (best.posterUrl) {
        await context.reply(card, best.posterUrl);
      } else {
        await context.reply(card);
      }
    } catch (err: any) {
      console.error("[ANIME] Error:", err?.message || err);
      await context.reply("❌ Erreur lors de la récupération de la fiche. Réessaie dans un moment.");
    }
  }
};

export default animeCommand;
