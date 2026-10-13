import axios from "axios";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { extractTikTokMedia } from "../services/tiktokExtractor.js";
import { getLinkTtlMinutes } from "../tempDownloadManager.js";
import { fetchMediaToTempFile, registerMediaLink } from "../services/mediaLinkDelivery.js";
import {
  tiktokReuseKey,
  lookupMediaReuse,
  storeMediaReuse,
  SOCIAL_REUSE_TTL_MS
} from "../services/mediaReuseStore.js";
import { registerTempDownload } from "../tempDownloadManager.js";

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
      // 9.18t : identifiant vidéo (clé du cache 5 h) — depuis l'URL longue,
      // la réponse tikwm, ou l'extracteur maison (liens courts résolus).
      let ttId = (url.match(/\/video\/(\d+)/) || [])[1] || "";

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
          if (data.id) ttId = String(data.id);
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
            if (own.videoId) ttId = own.videoId;
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

      // 9.18r : téléchargement local + lien durable (repli : URL distante).
      // 9.18s : nom lisible — le titre (ou l'auteur) au lieu de tiktok_<timestamp>.
      // 9.18t : cache 5 h — une vidéo redemandée repart du disque, zéro
      // re-téléchargement (même principe que le cache anime, fenêtre 5 h).
      const safeTitle = (title || author || "tiktok").replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "tiktok";
      const ttFilename = `${safeTitle}.mp4`;
      const ttCacheKey = tiktokReuseKey(ttId);
      let sendPath = videoUrl;
      let ttLink = "";
      let ttCacheNote = "";
      const ttHit = ttCacheKey ? lookupMediaReuse(ttCacheKey) : null;
      if (ttHit) {
        try {
          const rec = registerTempDownload(ttHit.filePath, ttFilename, { noCopy: true });
          if (rec?.filePath) {
            sendPath = rec.filePath;
            ttLink = rec.downloadUrl;
            ttCacheNote = "\n⚡ Déjà en cache (5 h) — aucun re-téléchargement";
          }
        } catch {}
      }
      if (!ttCacheNote) {
        const local = await fetchMediaToTempFile(videoUrl);
        if (local) {
          const rec = registerMediaLink(local, ttFilename);
          if (rec) {
            sendPath = rec.filePath;
            ttLink = rec.downloadUrl;
            if (ttCacheKey) {
              try { storeMediaReuse(ttCacheKey, rec.filePath, ttFilename, { ttlMs: SOCIAL_REUSE_TTL_MS }); } catch {}
            }
          } else {
            sendPath = local; // quota du store : fichier local, sans lien
          }
        }
      }
      if (ttLink) {
        caption += `\n\n🔗 *Lien :* ${ttLink}\n⏳ _Valable ${getLinkTtlMinutes()} min après chaque téléchargement (max 2 h)_` + ttCacheNote;
      }

      await sock.sendMessage(msg.key.remoteJid!, {
        video: { url: sendPath },
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
