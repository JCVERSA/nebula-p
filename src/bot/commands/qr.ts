import QRCode from "qrcode";
import { BotCommand } from "../types.js";

/**
 * `.qr` — portage natif de l'original neb (general/qr.js, owner request
 * 8.59) : génère un QR code PNG (500 px, marge 2). Fidèle à l'original.
 */

const qrCommand: BotCommand = {
  name: "qr",
  aliases: ["qrcode"],
  category: "Outils",
  description: "Générer un QR code.",
  usage: ".qr <texte>",
  execute: async (sock, msg, context) => {
    try {
      const text = (context.args || []).join(" ").trim();
      if (!text) {
        return void (await context.reply("📱 *Usage:* `.qr <texte ou lien>`\n\nEx: `.qr https://example.com`"));
      }

      const buffer = await QRCode.toBuffer(text, { type: "png", width: 500, margin: 2 });

      await sock.sendMessage(msg.key.remoteJid!, {
        image: buffer,
        caption: "📱 Voici ton QR code"
      }, { quoted: msg });
    } catch (error: any) {
      console.error("[QR] Error:", error?.message || error);
      await context.reply("❌ Impossible de générer le QR code.\n🔄 Réessaie avec un texte plus court.");
    }
  }
};

export default qrCommand;
