import fs from "fs";
import os from "os";
import path from "path";
import { BotCommand } from "../types.js";
import { findMediaNode, mediaMeta, streamMediaToFile } from "./upload.js";

/**
 * 9.18llll — `.viewonce` / `.vv` : révèle un média à consultation unique
 * (image / vidéo / audio). Réponds au message view-once — le média est
 * retéléchargé depuis les serveurs WhatsApp puis renvoyé normalement.
 *
 * Pattern KnightBot-Mini (viewonce.js) : le déroulage des enveloppes
 * (viewOnceMessageV2, v2Extension…) est déjà géré par notre
 * findMediaNode/normalizeMessageContent (audit 9.6c) — aucune duplication.
 */
const viewonceCommand: BotCommand = {
  name: "viewonce",
  aliases: ["vv", "readvo", "readviewonce"],
  category: "Outils",
  description: "Révèle un média à consultation unique (reply au message).",
  usage: ".vv (réponds au média view-once)",
  execute: async (sock, msg, context) => {
    let tmpPath = "";
    try {
      const found = findMediaNode(msg.message);
      if (!found || found.kind === "stickerMessage" || found.kind === "conversation") {
        await context.reply("👁️ Réponds à un *média à consultation unique* (image, vidéo ou audio) avec `.vv`.");
        return;
      }
      if (found.kind !== "imageMessage" && found.kind !== "videoMessage" && found.kind !== "audioMessage") {
        await context.reply("👁️ Seules les images, vidéos et notes vocales à consultation unique sont révélables.");
        return;
      }
      await context.react("👁️");
      const meta = mediaMeta(found.node, found.kind);
      tmpPath = path.join(os.tmpdir(), `nebula_vv_${Date.now()}_${path.basename(meta.filename || "media")}`);
      const streamed = await streamMediaToFile(found.node, found.kind, tmpPath, 100 * 1024 * 1024);
      if (!streamed.ok) {
        await context.reply("❌ Impossible de récupérer ce média (expiré ou jamais ouvert) — réessaie.");
        return;
      }
      const payload: Record<string, unknown> =
        found.kind === "imageMessage"
          ? { image: { url: tmpPath } }
          : found.kind === "videoMessage"
            ? { video: { url: tmpPath } }
            : { audio: { url: tmpPath }, mimetype: found.node?.mimetype || "audio/mpeg" };
      await sock.sendMessage(msg.key.remoteJid!, payload, { quoted: msg });
    } catch {
      await context.reply("❌ Erreur inattendue pendant la révélation — réessaie.");
    } finally {
      if (tmpPath) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    }
  },
};

export default viewonceCommand;
