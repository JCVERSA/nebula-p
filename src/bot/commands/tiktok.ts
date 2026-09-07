import axios from "axios";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

/**
 * `.tiktok` — portage natif de l'original neb (media/tiktok.js, owner request
 * 8.59) : API publique tikwm.com (hd=1), sans watermark. Fidèle à l'original,
 * messages déjà FR.
 */

const tiktokCommand: BotCommand = {
  name: "tiktok",
  aliases: ["tt", "ttdl", "tiktokdl"],
  category: "Media",
  description: "Télécharger une vidéo TikTok sans watermark.",
  usage: ".tiktok <lien TikTok>",
  execute: async (sock, msg, context) => {
    try {
      const url = (context.args || []).join(" ").trim();

      if (!url) {
        return void (await context.reply(
          "📥 *TikTok*\n\n*Usage:* `.tiktok <lien TikTok>`\n\nEx:\n  `.tiktok https://vm.tiktok.com/xxx`"
        ));
      }

      if (!url.includes("tiktok.com")) {
        return void (await context.reply("❌ Lien TikTok invalide — envoie un lien valide."));
      }

      await sock.sendMessage(msg.key.remoteJid!, { react: { text: "⏳", key: msg.key } });

      const apiRes = await axios.post(
        "https://www.tikwm.com/api/",
        new URLSearchParams({ url, hd: "1" }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }
      );

      const data = apiRes.data?.data;
      if (!data || !data.play) {
        return void (await context.reply("❌ Impossible de télécharger cette vidéo TikTok — essaie un autre lien."));
      }

      const videoUrl = data.hdplay || data.play;
      const title = data.title || "";
      const author = data.author?.nickname || "";
      const duration = data.duration ? `${data.duration}s` : "";

      let caption = "🎵 *TikTok*\n";
      if (author) caption += `👤 ${author}\n`;
      if (duration) caption += `⏱️ ${duration}\n`;
      if (title) caption += `📝 ${title}\n`;
      caption += `\n> _Downloaded by ${getConfig().botName}_`;

      await sock.sendMessage(msg.key.remoteJid!, {
        video: { url: videoUrl },
        mimetype: "video/mp4",
        caption
      }, { quoted: msg });

      await sock.sendMessage(msg.key.remoteJid!, { react: { text: "✅", key: msg.key } });
    } catch (error: any) {
      console.error("[TikTok] Error:", error?.message || error);
      await context.reply("❌ Erreur lors du téléchargement TikTok.\n🔄 Réessaie avec un autre lien.");
    }
  }
};

export default tiktokCommand;
