import { BotCommand } from "../types.js";
import { searchByImageBuffer, searchByImageUrl, pickBestTrace, formatTraceCard } from "../services/tracemoeClient.js";

const USAGE = `🕵️ *Usage:* \`.trace\` — identifie un anime à partir d'une capture d'écran.

Deux façons :
1. Envoie une image avec la légende \`.trace\`
2. Réponds (\`répondre\`) à une image avec \`.trace\`
3. Ou : \`.trace <URL de l'image>\`

_Résultat : titre, épisode, timecode exact et lien de téléchargement._`;

const traceCommand: BotCommand = {
  name: "trace",
  aliases: ["tracemoe", "whatanime"],
  category: "Anime",
  description: "Identify an anime from a screenshot (title, episode, timestamp) via trace.moe.",
  usage: "trace (image jointe/citée) ou trace <url>",
  execute: async (sock, msg, context) => {
    const args = context.args || [];
    const maybeUrl = args[0] || "";

    await context.react("🕵️");

    try {
      let outcome;

      if (/^https?:\/\//i.test(maybeUrl)) {
        await context.reply("🔍 *Analyse de l'image via trace.moe…*");
        outcome = await searchByImageUrl(maybeUrl);
      } else {
        const media: Buffer | null = context.downloadMedia ? await context.downloadMedia() : null;
        if (!media) {
          return context.reply(`❌ Aucune image détectée.\n\n${USAGE}`);
        }
        await context.reply("🔍 *Analyse de la capture via trace.moe…*");
        outcome = await searchByImageBuffer(media);
      }

      if (!outcome.ok) {
        return context.reply(`❌ ${outcome.error || "Recherche impossible."}\n\nRéessaie dans un moment.`);
      }

      const best = pickBestTrace(outcome.results);
      if (!best) {
        return context.reply(
          "😕 *Aucun anime identifié pour cette image.*\n\nAstuces :\n• Capture nette, plein écran, sans recadrage\n• Une scène typique (visage, décor reconnaissable)\n• Les génériques/openings marchent aussi"
        );
      }

      const card = formatTraceCard(best);
      if (best.sceneImageUrl) {
        await context.reply(card, best.sceneImageUrl);
      } else {
        await context.reply(card);
      }
    } catch (err: any) {
      console.error("[TRACE] Error:", err?.message || err);
      await context.reply("❌ Erreur pendant l'identification. Réessaie dans un moment.");
    }
  }
};

export default traceCommand;
