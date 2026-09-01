import { BotCommand } from "../types.js";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { isSafeDownloadUrl, safeFetch } from "../urlSafety.js";
import { resolvedFfmpegPath } from "../ffmpeg.js";

if (resolvedFfmpegPath !== "ffmpeg") {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

const COBALT_INSTANCES = [
  "https://cobalt.canine.tools",
  "https://cobalt.meowing.de",
  "https://co.wuk.sh",
  "https://cobalt.sh"
];

async function tryCobaltFallback(rawUrl: string): Promise<{ buffer: Buffer; title: string; sizeMB: number } | null> {
  for (const instance of COBALT_INSTANCES) {
    try {
      const response = await fetch(`${instance}/api/json`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "NebulaBot-MediaClient/1.1",
        },
        body: JSON.stringify({
          url: rawUrl,
          videoQuality: "720",
          downloadMode: "auto",
        }),
      });

      if (!response.ok) continue;
      const data = (await response.json()) as any;

      const directUrl = data?.url || data?.picker?.[0]?.url;
      if (!directUrl || !(await isSafeDownloadUrl(directUrl))) continue;

      const mediaRes = await safeFetch(directUrl);
      if (!mediaRes.ok) continue;

      const arrayBuf = await mediaRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const sizeMB = buffer.length / (1024 * 1024);

      if (sizeMB > 50) return null;

      return {
        buffer,
        title: data?.filename || "YouTube Video",
        sizeMB,
      };
    } catch {
      continue;
    }
  }
  return null;
}

const videoCommand: BotCommand = {
  name: "video",
  category: "Media",
  description: "Download and convert YouTube videos using ytdl-core and ffmpeg with automated multi-tunnel fallback",
  usage: ".video <youtube-url>",
  aliases: ["ytvideo", "ytmp4"],
  execute: async (sock, msg, context) => {
    try {
      const args = context.args;
      if (args.length === 0) {
        await context.reply("❌ *Usage:* `.video <youtube-url>`\n\nExample: `.video https://www.youtube.com/watch?v=dQw4w9WgXcQ`");
        return;
      }

      const rawUrl = args.join(" ").trim();

      // Strict host allowlist (rejects look-alike hosts such as
      // "youtube.com.evil.example") and SSRF guard before any fetch.
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
      } catch {
        await context.reply("❌ *Error:* Invalid YouTube URL. Please provide a valid watch or short URL.");
        return;
      }
      const allowedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]);
      if (!allowedHosts.has(parsedUrl.hostname.toLowerCase()) || !(await isSafeDownloadUrl(parsedUrl.toString()))) {
        await context.reply("❌ *Error:* Invalid or blocked YouTube URL. Please provide a valid watch or short URL.");
        return;
      }

      await context.react("⏳");
      await context.reply("⏳ *Fetching video metadata...* Please wait.");

      let info: any = null;
      let ytdlFailed = false;

      try {
        info = await ytdl.getInfo(rawUrl);
      } catch (err: any) {
        console.warn("[Video YTDL notice]: Direct ytdl unavailable, switching to multi-tunnel fallback pipeline...", err?.message || err);
        ytdlFailed = true;
      }

      // If ytdl failed, try fallback immediately
      if (ytdlFailed || !info) {
        await context.react("🔄");
        await context.reply("🔄 *Routing download through high-speed bypass tunnel...*");
        
        const fallbackResult = await tryCobaltFallback(rawUrl);
        if (fallbackResult) {
          await sock.sendMessage(msg.key.remoteJid!, {
            video: fallbackResult.buffer,
            caption: `🎥 *Video:* ${fallbackResult.title}\n⚖️ *Size:* ${fallbackResult.sizeMB.toFixed(1)} MB\n⚡ *Engine:* Resilient Media Tunnel`,
            mimetype: "video/mp4"
          }, { quoted: msg });
          await context.react("✅");
          return;
        } else {
          await context.react("❌");
          await context.reply("❌ *Failed to download video:* YouTube restrictions prevented media stream extraction. Try using `.download <url>` with alternative quality.");
          return;
        }
      }

      const videoTitle = info.videoDetails.title || "YouTube Video";
      const durationSecs = parseInt(info.videoDetails.lengthSeconds || "0", 10);
      
      // Limit to 10 minutes to avoid high resource consumption
      if (durationSecs > 600) {
        await context.react("⚠️");
        await context.reply("⚠️ *Error:* Video duration exceeds 10 minutes! Please provide a shorter video.");
        return;
      }

      // Find suitable formats with video + audio combined
      const format = ytdl.chooseFormat(info.formats, {
        quality: "highest",
        filter: "audioandvideo"
      });

      if (!format) {
        // Fallback to cobalt tunnel
        const fallbackResult = await tryCobaltFallback(rawUrl);
        if (fallbackResult) {
          await sock.sendMessage(msg.key.remoteJid!, {
            video: fallbackResult.buffer,
            caption: `🎥 *Video:* ${fallbackResult.title}\n⚖️ *Size:* ${fallbackResult.sizeMB.toFixed(1)} MB`,
            mimetype: "video/mp4"
          }, { quoted: msg });
          await context.react("✅");
          return;
        }
        await context.react("❌");
        await context.reply("❌ *Error:* No suitable format with both audio and video found.");
        return;
      }

      // Check size estimate
      if (format.contentLength) {
        const sizeBytes = parseInt(format.contentLength, 10);
        const sizeMB = sizeBytes / (1024 * 1024);
        if (sizeMB > 50) {
          await context.react("⚠️");
          await context.reply(`⚠️ *Error:* Video file size (~${sizeMB.toFixed(1)} MB) is too large. WhatsApp media limit is 50MB.`);
          return;
        }
      }

      await context.reply(`📥 *Downloading and converting video:* \n"${videoTitle}"\n\n⚙️ Processing with FFmpeg bypass tunnels...`);
      await context.react("🔄");

      let tempInPath: string | null = null;
      let tempOutPath: string | null = null;

      try {
        tempInPath = path.join(process.cwd(), `temp_in_${Date.now()}.mp4`);
        tempOutPath = path.join(process.cwd(), `temp_out_${Date.now()}.mp4`);

        // Stream download to file
        const downloadStream = ytdl(rawUrl, { format });
        const writeStream = fs.createWriteStream(tempInPath);

        await new Promise<void>((resolve, reject) => {
          downloadStream.pipe(writeStream);
          writeStream.on("finish", () => resolve());
          writeStream.on("error", (err) => reject(err));
        });

        // Check the downloaded file size
        const stats = fs.statSync(tempInPath);
        const actualSizeMB = stats.size / (1024 * 1024);
        if (actualSizeMB > 50) {
          await context.react("⚠️");
          await context.reply(`⚠️ *Error:* Downloaded file size (${actualSizeMB.toFixed(1)} MB) exceeds the 50MB limit.`);
          return;
        }

        // Process with FFmpeg to ensure high-compatibility mobile codec container
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tempInPath!)
            .output(tempOutPath!)
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions([
              "-pix_fmt yuv420p",
              "-profile:v baseline",
              "-level 3.0",
              "-crf 28",
              "-preset fast"
            ])
            .on("end", () => {
              resolve();
            })
            .on("error", (err: any) => {
              console.error("FFmpeg error:", err);
              reject(err);
            })
            .run();
        });

        // Send the processed video
        if (fs.existsSync(tempOutPath)) {
          const outStats = fs.statSync(tempOutPath);
          console.log(`[Video Command] Processed size: ${(outStats.size / (1024 * 1024)).toFixed(2)} MB`);
          
          const videoBuffer = fs.readFileSync(tempOutPath);
          
          await sock.sendMessage(msg.key.remoteJid!, {
            video: videoBuffer,
            caption: `🎥 *Video:* ${videoTitle}\n⚖️ *Size:* ${(outStats.size / (1024 * 1024)).toFixed(1)} MB`,
            mimetype: "video/mp4"
          }, { quoted: msg });

          await context.react("✅");
        } else {
          throw new Error("Failed to produce video output file.");
        }
      } finally {
        // Guarantee clean-up of temporary disk files even if an error occurs mid-stream
        try {
          if (tempInPath && fs.existsSync(tempInPath)) fs.unlinkSync(tempInPath);
          if (tempOutPath && fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
        } catch (cleanErr) {
          console.error("Failed to clean temporary video files:", cleanErr);
        }
      }

    } catch (error: any) {
      console.error("[Video Command Error]:", error);
      await context.react("❌");
      await context.reply(`❌ *Failed to download or process video:* ${error.message || error}`);
    }
  }
};

export default videoCommand;
