import fs from "fs";
import os from "os";
import path from "path";
import { BotCommand } from "../types.js";
import { findMediaNode, mediaMeta, streamMediaToFile } from "./upload.js";

/**
 * 9.18llll — `.sticker` / `.s` : image ou vidéo → sticker WhatsApp.
 *
 * Analyse concurrent KnightBot-Mini : le sticker est LA commande la plus
 * demandée d'un bot WhatsApp et nous ne l'avions pas. Leur implémentation
 * (ffmpeg + EXIF webpmux) est reprise en patterns maison : spawn sans shell,
 * passes de ré-encodage pour rester sous ~1 Mo, purges garanties.
 *
 * Usage : réponds à une image/vidéo avec `.s` — ou envoie le média avec
 * `.s` en légende.
 */
const stickerCommand: BotCommand = {
  name: "sticker",
  aliases: ["s", "stiker", "st"],
  category: "Média",
  description: "Image / vidéo → sticker WhatsApp (pack Nebula).",
  usage: ".s (réponds à une image ou vidéo)",
  execute: async (sock, msg, context) => {
    let tmpIn = "";
    try {
      const found = findMediaNode(msg.message);
      if (!found) {
        await context.reply(
          "🎨 *Sticker*\n\nRéponds à une *image* ou une *vidéo* avec `.s` — ou envoie le média avec `.s` en légende.\n\n_Vidéo → sticker animé (~3 s au-delà si trop lourd)._",
        );
        return;
      }
      if (found.kind === "stickerMessage") {
        await context.reply("✨ Ce message est déjà un sticker — utilise `.take` pour le ré-emporter avec le pack Nebula.");
        return;
      }
      const animated = found.kind === "videoMessage" || String(found.node?.mimetype || "").includes("gif");
      if (found.kind === "documentMessage") {
        const mime = String(found.node?.mimetype || "");
        if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
          await context.reply("❌ Les documents ne sont convertibles que s'ils sont une image ou une vidéo.");
          return;
        }
      }

      await context.react("🎨");
      const meta = mediaMeta(found.node, found.kind);
      tmpIn = path.join(os.tmpdir(), `nebula_sticker_in_${Date.now()}_${path.basename(meta.filename || "media")}`);
      const streamed = await streamMediaToFile(found.node, found.kind, tmpIn, 40 * 1024 * 1024);
      if (!streamed.ok) {
        await context.reply(
          streamed.reason === "tooBig"
            ? "❌ Média trop lourd (max 40 Mo) pour la conversion en sticker."
            : "❌ Impossible de télécharger ce média — réessaie.",
        );
        return;
      }

      const { convertMediaToSticker } = await import("../services/stickerService.js");
      const result = await convertMediaToSticker(tmpIn, animated);
      if (!result.ok) {
        await context.reply("❌ La conversion a échoué (média illisible ou encodage impossible).");
        return;
      }
      await sock.sendMessage(msg.key.remoteJid!, { sticker: result.buffer }, { quoted: msg });
    } catch {
      await context.reply("❌ Erreur inattendue pendant la création du sticker — réessaie.");
    } finally {
      if (tmpIn) {
        try {
          fs.unlinkSync(tmpIn);
        } catch {}
      }
    }
  },
};

export default stickerCommand;
