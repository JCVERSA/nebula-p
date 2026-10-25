import fs from "fs";
import os from "os";
import path from "path";
import { BotCommand } from "../types.js";
import { findMediaNode, streamMediaToFile } from "./upload.js";

/**
 * 9.18llll — `.take` : « emprunte » un sticker reçu et le renvoie avec le
 * pack Nebula (ré-écriture de l'EXIF, le média est inchangé).
 *
 * Pattern KnightBot-Mini (resticker) réduit à l'essentiel : stream → webpmux
 * → nouvel EXIF → envoi.
 */
const takeCommand: BotCommand = {
  name: "take",
  aliases: ["steal", "repack"],
  category: "Média",
  description: "Reprends un sticker reçu avec le pack Nebula.",
  usage: ".take (réponds à un sticker)",
  execute: async (sock, msg, context) => {
    let tmpIn = "";
    try {
      const found = findMediaNode(msg.message);
      if (!found || found.kind !== "stickerMessage") {
        await context.reply("🎨 Réponds à un *sticker* avec `.take` pour le renvoyer avec le pack Nebula.");
        return;
      }
      await context.react("✨");
      tmpIn = path.join(os.tmpdir(), `nebula_take_${Date.now()}.webp`);
      const streamed = await streamMediaToFile(found.node, found.kind, tmpIn, 10 * 1024 * 1024);
      if (!streamed.ok) {
        await context.reply("❌ Impossible de télécharger ce sticker — réessaie.");
        return;
      }
      const { withStickerExif, stickerPackName, stickerAuthorName } = await import("../services/stickerService.js");
      const buffer = await withStickerExif(fs.readFileSync(tmpIn), stickerPackName(), stickerAuthorName());
      await sock.sendMessage(msg.key.remoteJid!, { sticker: buffer }, { quoted: msg });
    } catch {
      await context.reply("❌ Erreur inattendue — ce sticker est peut-être dans un format non lisible.");
    } finally {
      if (tmpIn) {
        try {
          fs.unlinkSync(tmpIn);
        } catch {}
      }
    }
  },
};

export default takeCommand;
