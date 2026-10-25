import { BotCommand } from "../types.js";
import { resolveLiveSocket } from "../liveSocket.js";
import { typingPresence } from "../services/humanize.js";
import { findLyrics, parseArtistTrack } from "../services/lrclib.js";
import { getLastTrack } from "../services/lastTrackStore.js";

/**
 * 9.18nnnn (P2) — paroles de chanson via LRCLIB (libre, sans clé).
 *
 * `.lyrics <titre> [artiste]`  → recherche floue ;
 * `.lyrics`                     → reprend la DERNIÈRE chanson livrée par
 *                                .ytm/.song dans ce chat (TTL 30 min).
 *
 * Réponses honnêtes : introuvable → on le dit ; LRCLIB saturé (429) → on
 * dit de réessaier. Jamais d'échec brut.
 */

const MAX_LYRICS_CHARS = 3500;

const lyricsCommand: BotCommand = {
  name: "lyrics",
  aliases: ["paroles"],
  category: "Media",
  description: "Paroles d'une chanson (LRCLIB) — seul juste après .ytm, ou .lyrics <titre>.",
  usage: ".lyrics <titre> [artiste] · ou .lyrics seul après .ytm",
  examples: [".lyrics Bohemian Rhapsody Queen", ".lyrics (seul, juste après .ytm)"],
  execute: async (sock, msg, context) => {
    const chatId = String(msg.key.remoteJid || "");
    const args = (context.args || []).join(" ").trim();

    let query: { query?: string; track?: string; artist?: string };
    if (args) {
      query = { query: args.slice(0, 200) };
    } else {
      const last = getLastTrack(chatId);
      if (!last) {
        return void (await context.reply(
          `🎼 \`${context.prefix}lyrics <titre> [artiste]\` — ex : \`${context.prefix}lyrics Bohemian Rhapsody Queen\`.\n\nAstuce : lance-le *seul* juste après \`${context.prefix}ytm\` — je prends la chanson envoyée.`,
        ));
      }
      const parsed = parseArtistTrack(last);
      query = parsed.artist ? { track: parsed.track, artist: parsed.artist } : { query: parsed.track };
    }

    await typingPresence(resolveLiveSocket(sock), chatId);
    const outcome = await findLyrics(query);

    if (outcome.kind === "found") {
      const body =
        outcome.hit.lyrics.length > MAX_LYRICS_CHARS
          ? `${outcome.hit.lyrics.slice(0, MAX_LYRICS_CHARS)}\n\n_[paroles tronquées — suite sur lrclib.net]_`
          : outcome.hit.lyrics;
      await context.reply(`🎼 *${outcome.hit.track}*\n🧑‍🎤 _${outcome.hit.artist}_\n\n${body}`);
      return;
    }
    if (outcome.kind === "rate_limited") {
      return void (await context.reply("⏳ Le service de paroles est saturé — réessaie dans un instant."));
    }
    if (outcome.kind === "error") {
      return void (await context.reply("❌ Paroles indisponibles pour le moment — réessaie."));
    }
    const asked = query.track || query.query || "";
    return void (await context.reply(
      `❌ Aucune paroles trouvée pour « ${asked} ».\n💡 Précise l'artiste : \`${context.prefix}lyrics <titre> <artiste>\`.`,
    ));
  },
};

export default lyricsCommand;
