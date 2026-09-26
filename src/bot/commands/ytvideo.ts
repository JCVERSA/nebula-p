import axios from "axios";
import fs from "fs";
import path from "path";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { ytvViaYtDlp } from "../services/ytDlp.js";

/**
 * `.ytvideo` / `.ytv` — portage natif de l'original neb (media/video.js,
 * owner request 8.59) : recherche YouTube par nom OU lien, résolution en
 * dernier argument (360/480/720/1080), miniature, puis chaîne d'APIs avec
 * fallbacks. Adaptations : système de pièces retiré (décision owner),
 * messages FR, aucun exec().
 */

interface VideoApiResult { downloadUrl: string; title: string | null }

// 8.86 : plafond vidéo via yt-dlp local (le flux anime reste à 2 Go via
// tempDownloadManager ; ici ce sont des vidéos YouTube courtes).
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const VIDEO_APIS: Array<{ name: string; fetch: (url: string, quality: string) => Promise<VideoApiResult> }> = [
  {
    name: "cobalt",
    fetch: async (url, quality) => {
      const res = await axios.post("https://api.cobalt.tools/api/json", {
        url, vQuality: quality, isAudioOnly: false, disableMetadata: false
      }, { headers: { Accept: "application/json", "Content-Type": "application/json" }, timeout: 25000 });
      if (res.data?.url) return { downloadUrl: res.data.url, title: null };
      throw new Error("cobalt: no url");
    }
  },
  {
    name: "EliteProTech",
    fetch: async (url) => {
      const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4`, {
        timeout: 25000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.success && res.data?.downloadURL) return { downloadUrl: res.data.downloadURL, title: res.data.title };
      throw new Error("EliteProTech: no url");
    }
  },
  {
    name: "Yupra",
    fetch: async (url) => {
      const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`, {
        timeout: 25000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.success && res.data?.data?.download_url) return { downloadUrl: res.data.data.download_url, title: res.data.data.title };
      throw new Error("Yupra: no url");
    }
  },
  {
    name: "Okatsu",
    fetch: async (url) => {
      const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`, {
        timeout: 25000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.result?.mp4) return { downloadUrl: res.data.result.mp4, title: res.data.result.title };
      throw new Error("Okatsu: no url");
    }
  }
];

/** Hard timeout wrapper — yt-search has none built in. */
async function ytsSearch(query: string): Promise<{ videos: Array<{ title?: string; url?: string; thumbnail?: string }> }> {
  const mod = await import("yt-search");
  const yts = (mod as { default: (q: string) => Promise<any> }).default;
  return Promise.race([
    yts(query),
    new Promise<any>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))
  ]);
}

const ytvideoCommand: BotCommand = {
  name: "ytvideo",
  aliases: ["ytv", "ytmp4", "ytvid", "video"],
  category: "Media",
  description: "Télécharger une vidéo YouTube avec option de résolution.",
  usage: ".ytv <nom ou lien> [360|480|720|1080]",
  execute: async (sock, msg, context) => {
    let videoPath: string | null = null; // fichier local yt-dlp (8.86) — purgé en finally
    try {
      const chatId = msg.key.remoteJid;
      const args = context.args || [];
      if (!args[0]) {
        return void (await context.reply(
          "🎬 *Usage:* `.ytv <nom ou lien YouTube> [résolution]`\n\nEx: `.ytv Ronaldo best goals 720`\nRésolutions : 360, 480, 720, 1080"
        ));
      }

      let quality = "720";
      let searchQuery = args.join(" ");
      const lastArg = args[args.length - 1];
      if (["360", "480", "720", "1080"].includes(lastArg)) {
        quality = lastArg;
        searchQuery = args.slice(0, -1).join(" ");
      }

      let videoUrl: string, videoTitle: string, videoThumb: string | undefined;
      if (/^https?:\/\//i.test(searchQuery)) {
        videoUrl = searchQuery;
        videoTitle = "Vidéo";
      } else {
        await context.reply(`🔍 Recherche *"${searchQuery}"* en *${quality}p*...`);
        const search = await ytsSearch(searchQuery);
        if (!search?.videos?.length) {
          return void (await context.reply(`❌ Aucune vidéo trouvée pour *"${searchQuery}"*`));
        }
        const v = search.videos[0];
        videoUrl = v.url!;
        videoTitle = v.title || searchQuery;
        videoThumb = v.thumbnail;
      }

      const initialCaption = `*${videoTitle}*\n📺 Résolution : *${quality}p*\n\n⏳ Téléchargement en cours...`;
      try {
        const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        const thumb = videoThumb || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : null);
        if (thumb) {
          await sock.sendMessage(chatId, { image: { url: thumb }, caption: initialCaption }, { quoted: msg });
        } else {
          await context.reply(initialCaption);
        }
      } catch {}

      let downloadUrl: string | null = null;
      let finalTitle = videoTitle;
      // 8.86 : yt-dlp LOCAL en premier recours (API tierces mortes en prod,
      // cf. src/bot/services/ytDlp.ts). URL canonisée en interne.
      try {
        console.log(`[YTV] Trying yt-dlp (local, ${quality}p)...`);
        const local = await ytvViaYtDlp(videoUrl, quality, MAX_VIDEO_BYTES);
        if (local.ok) {
          videoPath = local.filePath;
          if (local.title) finalTitle = local.title;
          console.log("[YTV] OK via yt-dlp");
        } else if (local.reason === "too_large") {
          return void (await context.reply("⚠️ *Vidéo trop lourde* (max 100 Mo à cette qualité) — essaie une qualité inférieure ou une vidéo plus courte."));
        } else {
          console.log(`[YTV] yt-dlp failed: ${local.reason}`);
        }
      } catch (err: any) {
        console.log(`[YTV] yt-dlp failed: ${err?.message || err}`);
      }
      for (const api of VIDEO_APIS) {
        if (videoPath) break; // déjà obtenu via yt-dlp (8.86)
        try {
          console.log(`[YTV] Trying ${api.name} (${quality}p)...`);
          const result = await api.fetch(videoUrl, quality);
          downloadUrl = result.downloadUrl;
          if (result.title) finalTitle = result.title;
          console.log(`[YTV] OK via ${api.name}`);
          break;
        } catch (err: any) {
          console.log(`[YTV] ${api.name} failed: ${err.message}`);
        }
      }

      const mediaUrl = videoPath || downloadUrl;
      if (!mediaUrl) {
        return void (await context.reply("❌ Impossible de télécharger cette vidéo — toutes les sources ont échoué.\n🔄 Réessaie dans un instant."));
      }

      const safeName = (finalTitle || "video").replace(/[^\w\s-]/g, "").trim().slice(0, 60);
      await sock.sendMessage(chatId, {
        video: { url: mediaUrl },
        mimetype: "video/mp4",
        fileName: `${safeName}.mp4`,
        caption: `*${finalTitle || searchQuery}*\n📺 Qualité : ${quality}p\n\n> *_Downloaded by ${getConfig().botName}_*`
      }, { quoted: msg });
    } catch (error: any) {
      console.error("[YTV] Fatal:", error?.message || error);
      await context.reply("❌ Le téléchargement a échoué.\n🔄 Réessaie dans un instant.");
    } finally {
      // 8.86 : purge du fichier local yt-dlp (répertoire temporaire dédié).
      if (videoPath) {
        try { fs.rmSync(path.dirname(videoPath), { recursive: true, force: true }); } catch {}
      }
    }
  }
};

export default ytvideoCommand;
