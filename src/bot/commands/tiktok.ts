import axios from "axios";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { extractTikTokMedia } from "../services/tiktokExtractor.js";

/**
 * `.tiktok` — portage natif de l'original neb (media/tiktok.js, owner request
 * 8.59) : API publique tikwm.com (hd=1), sans watermark. Fidèle à l'original,
 * messages déjà FR.
 *
 * 9.18q — filet préventif (leçon de la mort igdl/9.18p) : si tikwm échoue
 * ou ne répond plus, l'extracteur maison lit la page TikTok elle-même
 * (services/tiktokExtractor.ts — JSON d'hydratation, zéro site tiers).
 */

const tiktokCommand: BotCommand = {
  name: "tiktok",
  acceptsUrlArgs: true, // 9.3b — le guardrail agent préserve les URLs ici
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

      // 9.18q — chaîne à 2 étages : tikwm (API publique, sans watermark,
      // HD) puis, s'il échoue ou ne répond plus, l'extracteur maison
      // (page TikTok elle-même). Chacun borné par son timeout axios.
      let videoUrl = "";
      let title = "";
      let author = "";
      let duration = "";
      let mediaSource = "";

      try {
        const apiRes = await axios.post(
          "https://www.tikwm.com/api/",
          new URLSearchParams({ url, hd: "1" }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }
        );
        const data = apiRes.data?.data;
        if (data?.play) {
          videoUrl = data.hdplay || data.play;
          title = data.title || "";
          author = data.author?.nickname || "";
          duration = data.duration ? `${data.duration}s` : "";
          mediaSource = "tikwm";
        }
      } catch (err: any) {
        console.warn(`[TT] tikwm failed: ${err?.message || err}`);
      }

      if (!videoUrl) {
        try {
          const own = await extractTikTokMedia(url);
          if (own?.videoUrl) {
            videoUrl = own.videoUrl;
            title = own.title || "";
            author = own.author || "";
            duration = own.durationSec ? `${own.durationSec}s` : "";
            mediaSource = `extractor:${own.strategy}`;
          }
        } catch (err: any) {
          console.warn(`[TT] extractor failed: ${err?.message || err}`);
        }
      }

      if (!videoUrl) {
        return void (await context.reply(
          "❌ Impossible de télécharger cette vidéo TikTok — elle est peut-être privée, supprimée, ou TikTok limite le serveur _(réessaie dans quelques minutes)_."
        ));
      }
      console.log(`[TT] media source: ${mediaSource}`);

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
