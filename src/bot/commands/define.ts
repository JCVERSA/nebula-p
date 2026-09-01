import { BotCommand } from "../types.js";

const defineCommand: BotCommand = {
  name: "define",
  category: "Utilities",
  description: "Get definitions, phonetics, and synonyms of an English word.",
  usage: "define <word>",
  execute: async (sock, msg, context) => {
    await context.react("📖");
    const args = context.args || [];

    if (!args.length) {
      return context.reply("❌ Usage: \`.define <word>\`\n\nExample: \`.define ephemeral\` or \`.define serendipity\`");
    }

    const word = args.join(" ").trim().toLowerCase();

    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const res = await fetch(url);

      if (res.status === 404) {
        return context.reply(`❌ No definition found for *"${word}"*.\nPlease verify spelling (English words only).`);
      }

      if (!res.ok) {
        throw new Error("Failed to contact dictionary API");
      }

      const data = await res.json();
      const entry = data?.[0];

      if (!entry) {
        return context.reply(`❌ No definition found for *"${word}"*.`);
      }

      const phonetic = entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text || "";
      let text = `📖 *Dictionary Entry — ${entry.word}*${phonetic ? ` _[${phonetic}]_` : ""}\n`;

      const meanings = (entry.meanings || []).slice(0, 3);
      for (const meaning of meanings) {
        text += `\n*${meaning.partOfSpeech.toUpperCase()}*\n`;
        const defs = (meaning.definitions || []).slice(0, 2);
        defs.forEach((d: any, i: number) => {
          text += `  ${i + 1}. ${d.definition}\n`;
          if (d.example) {
            text += `     _"${d.example}"_\n`;
          }
        });
        if (meaning.synonyms?.length) {
          text += `   🔁 *Synonyms:* ${meaning.synonyms.slice(0, 5).join(", ")}\n`;
        }
      }

      text += `\n> 🌌 _Powered by Nebula Engine_`;
      await context.reply(text);
    } catch (error: any) {
      console.error("[DEFINE] Error:", error.message || error);
      await context.reply("❌ Error trying to retrieve dictionary definition. Please try again later.");
    }
  }
};

export default defineCommand;
