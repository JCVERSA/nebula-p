import { BotCommand } from "../types.js";
import { resolveLiveSocket } from "../liveSocket.js";
import { typingPresence } from "../services/humanize.js";

/**
 * 9.18nnnn (P2) — sondage NATIF WhatsApp (message poll officiel, pas une
 * simulation texte). Le rendu, les votes et l'addition sont gérés par
 * WhatsApp lui-même.
 *
 * `.poll Question | choix 1 | choix 2`       → un seul vote par personne ;
 * `.poll -m Question | choix 1 | choix 2`    → choix multiples.
 *
 * Limites WhatsApp respectées : 2 à 12 choix, question courte.
 */

const MAX_OPTIONS = 12;
const MAX_QUESTION_CHARS = 200;
const MAX_OPTION_CHARS = 100;

const pollCommand: BotCommand = {
  name: "poll",
  aliases: ["sondage", "vote"],
  category: "General",
  description: "Sondage natif WhatsApp : .poll Question | choix 1 | choix 2 (-m = choix multiples).",
  usage: ".poll <question> | <choix 1> | <choix 2>  (2 à 12 choix)",
  examples: [".poll Épisode ce soir ? | Oui | Non | Plus tard", ".poll -m Tes animes ? | Naruto | One Piece | Bleach"],
  execute: async (sock, msg, context) => {
    const chatId = String(msg.key.remoteJid || "");
    let raw = (context.args || []).join(" ").trim();
    const multiple = /^-m\s+/i.test(raw);
    if (multiple) raw = raw.replace(/^-m\s+/i, "").trim();

    const parts = raw
      .split("|")
      .map(p => p.trim())
      .filter(Boolean);

    if (parts.length < 3) {
      return void (await context.reply(
        `📊 \`${context.prefix}poll Question | choix 1 | choix 2\` — il faut une question et *au moins 2 choix*.\nEx : \`${context.prefix}poll Épisode ce soir ? | Oui | Non | Plus tard\`\n\`-m\` devant = choix multiples.`,
      ));
    }
    if (parts.length - 1 > MAX_OPTIONS) {
      return void (await context.reply(`📊 Maximum *${MAX_OPTIONS} choix* par sondage (limite WhatsApp).`));
    }

    const question = parts[0].slice(0, MAX_QUESTION_CHARS);
    const options = parts.slice(1).map(o => o.slice(0, MAX_OPTION_CHARS));

    try {
      const live = resolveLiveSocket(sock);
      await typingPresence(live, chatId);
      await live.sendMessage(chatId, {
        poll: {
          name: question,
          values: options,
          selectableCount: multiple ? options.length : 1,
        },
      });
      await context.react("📊");
    } catch {
      await context.reply("❌ Sondage impossible — réessaie dans un instant.");
    }
  },
};

export default pollCommand;
