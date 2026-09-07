import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

/**
 * `.instagram` — portage natif de l'original neb (media/instagram.js, owner
 * request 8.59) : scraper npm `ruhend-scraper` (igdl), dédoublonnage par URL
 * exacte, max 20 médias, délai 1 s entre envois. Adaptations : messages FR,
 * import dynamique (le paquet n'a pas de types).
 */

interface IgdlMedia { url?: string; type?: string }
type Igdl = (url: string) => Promise<{ data?: IgdlMedia[] }>;

const processedMessages = new Set<string>();

function extractUniqueMedia(mediaData: IgdlMedia[]): IgdlMedia[] {
  const unique: IgdlMedia[] = [];
  const seen = new Set<string>();
  for (const media of mediaData) {
    if (!media.url) continue;
    if (!seen.has(media.url)) {
      seen.add(media.url);
      unique.push(media);
    }
  }
  return unique;
}

const instagramCommand: BotCommand = {
  name: "instagram",
  aliases: ["ig", "insta", "igdl", "reels"],
  category: "Media",
  description: "Télécharger photos / vidéos / reels Instagram.",
  usage: ".instagram <lien Instagram>",
  execute: async (sock, msg, context) => {
    try {
      const chatId = msg.key.remoteJid!;

      if (msg.key.id && processedMessages.has(msg.key.id)) return;
      if (msg.key.id) {
        processedMessages.add(msg.key.id);
        setTimeout(() => processedMessages.delete(msg.key.id!), 5 * 60 * 1000);
      }

      const args = context.args || [];
      const text = args.join(" ").trim();
      if (!text) {
        return void (await context.reply("Envoie un lien Instagram pour la vidéo."));
      }

      const instagramPatterns = [
        /https?:\/\/(?:www\.)?instagram\.com\//,
        /https?:\/\/(?:www\.)?instagr\.am\//,
        /https?:\/\/(?:www\.)?instagram\.com\/p\//,
        /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
        /https?:\/\/(?:www\.)?instagram\.com\/tv\//
      ];
      if (!instagramPatterns.some(p => p.test(text))) {
        return void (await context.reply("Ce lien n'est pas valide — envoie un lien de post, reel ou vidéo Instagram."));
      }

      await sock.sendMessage(chatId, { react: { text: "📥", key: msg.key } });
      await context.reply("📥 *Téléchargement...* ⏳ Patiente quelques secondes.");

      const mod = (await import("ruhend-scraper")) as unknown as { igdl: Igdl };
      const downloadData = await mod.igdl(text);

      if (!downloadData?.data?.length) {
        return void (await context.reply("❌ Aucun média trouvé — le post est peut-être privé ou le lien invalide."));
      }

      const mediaToDownload = extractUniqueMedia(downloadData.data).slice(0, 20);
      if (!mediaToDownload.length) {
        return void (await context.reply("❌ Aucun média valide trouvé — post privé ou scraper indisponible."));
      }

      for (let i = 0; i < mediaToDownload.length; i++) {
        try {
          const media = mediaToDownload[i];
          const mediaUrl = media.url!;
          const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaUrl) ||
            media.type === "video" ||
            text.includes("/reel/") ||
            text.includes("/tv/");

          if (isVideo) {
            await sock.sendMessage(chatId, {
              video: { url: mediaUrl },
              mimetype: "video/mp4",
              caption: `*DOWNLOADED BY ${getConfig().botName.toUpperCase()}*`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(chatId, {
              image: { url: mediaUrl },
              caption: `*DOWNLOADED BY ${getConfig().botName.toUpperCase()}*`
            }, { quoted: msg });
          }

          if (i < mediaToDownload.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (mediaError) {
          console.error(`[IG] media ${i + 1} failed:`, mediaError);
        }
      }
    } catch (error) {
      console.error("[IG] Error:", error);
      await context.reply("❌ Erreur lors du traitement du lien Instagram.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default instagramCommand;
