import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { extractInstagramMedia } from "../services/instagramExtractor.js";

/**
 * `.instagram` — portage natif de l'original neb (media/instagram.js, owner
 * request 8.59) : scraper npm `ruhend-scraper` (igdl puis igdl2, chaîne
 * 9.18p), dédoublonnage par URL exacte, max 20 médias, délai 1 s entre
 * envois. Si les deux backends tiers échouent : extracteur maison
 * (instagramExtractor.ts — embed public + API web Instagram). Messages FR,
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
  acceptsUrlArgs: true, // 9.3b — le guardrail agent préserve les URLs ici
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

      // 9.18p (retour terrain reel DeZL1mfhKjw) : chaîne de repli à 3 étages.
      // igdl et igdl2 sont les deux backends obfusqués du paquet (sites
      // tiers snapsave/fapper — muets le jour où ces sites changent leur
      // HTML) ; l'extracteur maison (embed public + API web Instagram,
      // zéro site tiers) ferme la marche en filet de sécurité.
      // 8.84 (audit commandes C5) : le scraper n'a aucun timeout intégré —
      // sans cette borne, un appel qui pend bloquait la commande indéfiniment.
      const mod = (await import("ruhend-scraper")) as unknown as { igdl: Igdl; igdl2: Igdl };
      const withTimeout = (p: Promise<{ data?: IgdlMedia[] }>, label: string) =>
        Promise.race([
          p,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), 30000)),
        ]);

      let scrapedMedia: IgdlMedia[] = [];
      let mediaSource = "";
      for (const [label, fn] of [["igdl", mod.igdl], ["igdl2", mod.igdl2]] as Array<[string, Igdl]>) {
        try {
          const data = await withTimeout(fn(text), label);
          if (data?.data?.length) {
            scrapedMedia = data.data;
            mediaSource = label;
            break;
          }
          console.warn(`[IG] ${label}: no media (backend tiers indisponible ou muet)`);
        } catch (err: any) {
          console.warn(`[IG] ${label} failed: ${err?.message || err}`);
        }
      }

      if (!scrapedMedia.length) {
        try {
          const own = await extractInstagramMedia(text);
          if (own && own.items.length) {
            scrapedMedia = own.items;
            mediaSource = `extractor:${own.strategy}`;
          }
        } catch (err: any) {
          console.warn(`[IG] extractor failed: ${err?.message || err}`);
        }
      }

      if (!scrapedMedia.length) {
        return void (await context.reply(
          "❌ Aucun média trouvé — le post est peut-être privé, le lien invalide, ou Instagram limite le serveur _(réessaie dans quelques minutes)_."
        ));
      }
      console.log(`[IG] media source: ${mediaSource} (${scrapedMedia.length} item(s))`);

      const mediaToDownload = extractUniqueMedia(scrapedMedia).slice(0, 20);
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
