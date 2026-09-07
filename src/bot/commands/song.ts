import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { BotCommand } from "../types.js";
import { runFfmpegKit } from "../services/mediaToolkit.js";

/**
 * `.song` / `.ytm` — portage natif de l'original neb (media/song.js, owner
 * request 8.59) : recherche YouTube, chaîne d'APIs audio avec fallbacks,
 * conversion AAC pour WhatsApp. Adaptations : pièces retirées (décision
 * owner), execSync ffmpeg → runFfmpegKit (runner sécurisé partagé), plafond
 * mémoire 60 Mo sur le buffer (conteneur ~954 Mo), message FR.
 */

interface AudioApiResult { downloadUrl: string; title: string | null }

const AUDIO_APIS: Array<{ name: string; fetch: (url: string) => Promise<AudioApiResult> }> = [
  {
    name: "cobalt",
    fetch: async (url) => {
      const res = await axios.post("https://api.cobalt.tools/api/json", {
        url, aFormat: "mp3", isAudioOnly: true, disableMetadata: false
      }, { headers: { Accept: "application/json", "Content-Type": "application/json" }, timeout: 20000 });
      if (res.data?.url) return { downloadUrl: res.data.url, title: null };
      throw new Error("cobalt: no url");
    }
  },
  {
    name: "y2mate",
    fetch: async (url) => {
      const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (!videoId) throw new Error("No video ID");
      const analyze = await axios.post("https://www.y2mate.com/mates/analyzeV2/ajax", new URLSearchParams({
        k_query: `https://www.youtube.com/watch?v=${videoId}`, k_page: "home", hl: "fr", q_auto: "0"
      }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 });
      const k = analyze.data?.links?.mp3?.mp3128?.k;
      if (!k) throw new Error("y2mate: no key");
      const convert = await axios.post("https://www.y2mate.com/mates/convertV2/index", new URLSearchParams({ vid: videoId, k }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
      if (convert.data?.dlink) return { downloadUrl: convert.data.dlink, title: convert.data.title };
      throw new Error("y2mate: no dlink");
    }
  },
  {
    name: "EliteProTech",
    fetch: async (url) => {
      const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, {
        timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.success && res.data?.downloadURL) return { downloadUrl: res.data.downloadURL, title: res.data.title };
      throw new Error("EliteProTech: no url");
    }
  },
  {
    name: "Okatsu",
    fetch: async (url) => {
      const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, {
        timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.dl) return { downloadUrl: res.data.dl, title: res.data.title };
      throw new Error("Okatsu: no url");
    }
  },
  {
    name: "Yupra",
    fetch: async (url) => {
      const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, {
        timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.data?.success && res.data?.data?.download_url) return { downloadUrl: res.data.data.download_url, title: res.data.data.title };
      throw new Error("Yupra: no url");
    }
  }
];

const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // garde-fou mémoire (conteneur ~954 Mo)

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 90000,
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "*/*" }
  });
  const buf = Buffer.from(res.data);
  if (!buf || buf.length < 1000) throw new Error("Fichier vide ou trop petit");
  return buf;
}

async function ytsSearch(query: string): Promise<{ videos: Array<{ title?: string; url?: string; thumbnail?: string; timestamp?: string }> }> {
  const mod = await import("yt-search");
  const yts = (mod as { default: (q: string) => Promise<any> }).default;
  return Promise.race([
    yts(query),
    new Promise<any>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))
  ]);
}

const songCommand: BotCommand = {
  name: "song",
  aliases: ["play", "music", "yta", "mp3", "ytm"],
  category: "Media",
  description: "Télécharger l'audio d'une chanson YouTube (MP3).",
  usage: ".ytm <nom ou lien YouTube>",
  execute: async (sock, msg, context) => {
    const chatId = msg.key.remoteJid;
    const tmpIn = path.join(os.tmpdir(), `nebula_in_${Date.now()}.mp3`);
    const tmpOut = path.join(os.tmpdir(), `nebula_out_${Date.now()}.m4a`);
    try {
      const text = (context.args || []).join(" ").trim();
      if (!text) {
        return void (await context.reply("🎵 *Usage:* `.ytm <nom de la chanson ou lien YouTube>`\n\nEx: `.ytm Burna Boy Last Last`"));
      }

      let videoUrl: string, videoTitle: string, videoThumb: string | undefined, videoDuration: string | undefined;
      if (text.includes("youtube.com") || text.includes("youtu.be")) {
        videoUrl = text;
        videoTitle = "Audio";
      } else {
        await context.reply(`🔍 Recherche *"${text}"*...`);
        const search = await ytsSearch(text);
        if (!search?.videos?.length) {
          return void (await context.reply(`❌ Aucun résultat pour *"${text}"*`));
        }
        const v = search.videos[0];
        videoUrl = v.url!;
        videoTitle = v.title || text;
        videoThumb = v.thumbnail;
        videoDuration = v.timestamp;
      }

      const initialCaption = `🎵 *${videoTitle}*\n⏱ ${videoDuration || ""}\n\n⏳ Téléchargement en cours...`;
      try {
        if (videoThumb) {
          await sock.sendMessage(chatId, { image: { url: videoThumb }, caption: initialCaption }, { quoted: msg });
        } else {
          await context.reply(initialCaption);
        }
      } catch {}

      let audioBuffer: Buffer | null = null;
      for (const api of AUDIO_APIS) {
        try {
          console.log(`[SONG] Trying ${api.name}...`);
          const { downloadUrl, title } = await api.fetch(videoUrl);
          if (title && title !== "null") videoTitle = title;
          audioBuffer = await downloadBuffer(downloadUrl);
          console.log(`[SONG] OK via ${api.name} (${(audioBuffer.length / 1048576).toFixed(2)} MB)`);
          break;
        } catch (err: any) {
          console.log(`[SONG] ${api.name} failed: ${err.message}`);
        }
      }

      if (!audioBuffer) {
        return void (await context.reply("❌ Impossible de télécharger cette chanson — toutes les sources ont échoué.\n🔄 Réessaie dans un instant."));
      }
      if (audioBuffer.length >= MAX_AUDIO_BYTES) {
        return void (await context.reply("⚠️ *Fichier audio trop lourd* (max 60 Mo) — choisis une vidéo plus courte."));
      }

      const safeName = (videoTitle || "audio").replace(/[^\w\s-]/g, "").trim().slice(0, 60);
      fs.writeFileSync(tmpIn, audioBuffer);
      // Conversion AAC (WhatsApp) via le runner sécurisé partagé — plus d'execSync.
      const r = await runFfmpegKit(["-y", "-i", tmpIn, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", tmpOut], 60000);
      if (r.ok && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 1000) {
        await sock.sendMessage(chatId, {
          audio: fs.readFileSync(tmpOut),
          mimetype: "audio/mp4",
          ptt: false,
          fileName: `${safeName}.m4a`
        }, { quoted: msg });
      } else {
        console.warn("[SONG] conversion AAC échouée — envoi brut");
        await sock.sendMessage(chatId, {
          audio: audioBuffer,
          mimetype: "audio/mp4",
          ptt: false,
          fileName: `${safeName}.m4a`
        }, { quoted: msg });
      }
    } catch (err: any) {
      console.error("[SONG] Fatal:", err?.message || err);
      await context.reply("❌ Le téléchargement a échoué.\n🔄 Réessaie dans un instant.");
    } finally {
      for (const f of [tmpIn, tmpOut]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
    }
  }
};

export default songCommand;
