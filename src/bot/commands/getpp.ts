import axios from "axios";
import { BotCommand } from "../types.js";

/**
 * `.getpp` — portage natif de l'original neb (general/getpp.js, owner
 * request 8.59) : photo de profil via reply / tag / soi-même. Adaptation :
 * messages FR.
 */

const getppCommand: BotCommand = {
  name: "getpp",
  aliases: ["getpic"],
  category: "Outils",
  description: "Obtenir la photo de profil d'un utilisateur.",
  usage: ".getpp (en répondant à un message ou en tagant)",
  execute: async (sock, msg, context) => {
    try {
      let targetUser: string | null = null;

      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (ctx?.quotedMessage) {
        targetUser = ctx.participant || null;
      } else if (ctx?.mentionedJid?.length) {
        targetUser = ctx.mentionedJid[0];
      } else {
        targetUser = context.sender;
      }

      if (!targetUser) {
        return void (await context.reply("❌ Impossible d'identifier la personne — réponds à un message ou tague quelqu'un."));
      }

      try {
        const ppUrl = await sock.profilePictureUrl(targetUser, "image");
        if (!ppUrl) {
          return void (await context.reply("❌ Cet utilisateur n'a pas de photo de profil."));
        }

        const response = await axios.get(ppUrl, { responseType: "arraybuffer", timeout: 15000 });
        const buffer = Buffer.from(response.data);

        await sock.sendMessage(msg.key.remoteJid!, {
          image: buffer,
          caption: `👤 Photo de profil de @${targetUser.split("@")[0]}`,
          mentions: [targetUser]
        }, { quoted: msg });
      } catch {
        return void (await context.reply("❌ Photo de profil introuvable — elle est privée ou inexistante."));
      }
    } catch {
      await context.reply("❌ Photo de profil introuvable pour cet utilisateur.");
    }
  }
};

export default getppCommand;
