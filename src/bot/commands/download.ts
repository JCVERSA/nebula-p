import { BotCommand } from "../types.js";
import { isSafeDownloadUrl, safeFetch, safeFetchToFile } from "../urlSafety.js";
import { registerTempDownload } from "../tempDownloadManager.js";
import fs from "fs";
import path from "path";
import os from "os";

// Hard caps: never buffer more than this in memory; larger files stream to a
// temp file and are handed out as time-limited links.
const DIRECT_MEDIA_MAX_MB = 100;
const BUFFER_MAX_BYTES = 60 * 1024 * 1024;
const STREAM_MAX_BYTES = 500 * 1024 * 1024;

// List of public robust Cobalt instances for high-reliability fallback waterfall
const COBALT_INSTANCES = [
  "https://cobalt.canine.tools",
  "https://cobalt.meowing.de",
  "https://co.wuk.sh",
  "https://cobalt.sh"
];

const downloadCommand: BotCommand = {
  name: "download",
  category: "Utilities",
  description: "Download video or audio from YouTube, TikTok, Instagram, Twitter, Facebook, etc.",
  usage: ".download [audio/video/mp3] <url> [quality: 144/240/360/480/720/1080/max]",
  aliases: ["dl", "music"],
  execute: async (sock, msg, context) => {
    const args = context.args;

    if (args.length === 0) {
      return context.reply(
        `📥 *Nebula Media Downloader*\n\n` +
        `Download media from YouTube, TikTok, Instagram, Twitter/X, and more!\n\n` +
        `*Usage Examples:*\n` +
        `• Video: \`.download <url>\`\n` +
        `• Video with custom quality: \`.download <url> 720\`\n` +
        `• Audio Only: \`.download audio <url>\` or \`.download mp3 <url>\`\n` +
        `• Video Specific: \`.download video <url> 1080\`\n\n` +
        `_Supported qualities: 144, 240, 360, 480, 720, 1080, max_`
      );
    }

    // Parse options
    let mediaUrl = "";
    let audioOnly = false;
    let videoQuality = "1080"; // Default

    const firstArg = args[0].toLowerCase();
    const secondArg = args[1];

    if (firstArg === "audio" || firstArg === "mp3") {
      if (!secondArg) {
        return context.reply("❌ *Error:* Please provide a valid media URL.\nExample: `.download audio https://youtube.com/watch?v=...`");
      }
      audioOnly = true;
      mediaUrl = secondArg;
    } else if (firstArg === "video") {
      if (!secondArg) {
        return context.reply("❌ *Error:* Please provide a valid media URL.\nExample: `.download video https://youtube.com/watch?v=...`");
      }
      mediaUrl = secondArg;
      if (args[2]) {
        const q = args[2].toLowerCase();
        if (["144", "240", "360", "480", "720", "1080", "max"].includes(q)) {
          videoQuality = q;
        }
      }
    } else {
      // Direct paste mode: .download <url> [quality]
      mediaUrl = args[0];
      if (args[1]) {
        const q = args[1].toLowerCase();
        if (["144", "240", "360", "480", "720", "1080", "max"].includes(q)) {
          videoQuality = q;
        }
      }
    }

    // Validate URL syntax
    if (!mediaUrl.startsWith("http://") && !mediaUrl.startsWith("https://")) {
      return context.reply("❌ *Error:* Please enter a valid URL starting with http:// or https://");
    }

    // SSRF guard: never fetch private/internal/loopback destinations
    if (!(await isSafeDownloadUrl(mediaUrl))) {
      return context.reply(
        "❌ *Error:* This URL is blocked for security reasons (private, internal, or non-http(s) destination)."
      );
    }

    await context.react("⏳");
    await context.reply(`✨ *Processing media request...*\n\n🔗 URL: ${mediaUrl}\n⚙️ Mode: ${audioOnly ? "🔊 Audio (MP3)" : `🎥 Video (${videoQuality}p)`}\n📡 Connecting to Nebula bypass tunnels...`);

    // Payload for Cobalt API
    const payload = {
      url: mediaUrl,
      videoQuality: videoQuality,
      audioFormat: "mp3",
      audioOnly: audioOnly,
      filenamePattern: "basic"
    };

    let downloadUrl: string | null = null;
    let pickerUrls: string[] = [];
    let errorMsg = "Could not reach any of our backend servers.";

    // Try multiple Cobalt instances in a waterfall fallback pattern
    for (const instance of COBALT_INSTANCES) {
      try {
        console.log(`[Downloader] Trying instance: ${instance}`);
        
        // Try both modern root POST and legacy /api/json fallback
        const endpoints = [instance, `${instance}/api/json`];
        let fetchedData: any = null;

        for (const endpoint of endpoints) {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(10000) // 10s timeout
            });

            if (res.ok) {
              fetchedData = await res.json();
              break;
            }
          } catch (innerErr) {
            // Keep trying other paths or instances
          }
        }

        if (fetchedData) {
          if (fetchedData.status === "error") {
            errorMsg = fetchedData.text || "Service reported an error processing this link.";
            console.warn(`[Downloader] Error response from ${instance}:`, errorMsg);
            continue; // Try next instance
          }

          if (fetchedData.status === "redirect" || fetchedData.status === "tunnel") {
            downloadUrl = fetchedData.url;
            break;
          }

          if (fetchedData.status === "picker") {
            if (fetchedData.picker && Array.isArray(fetchedData.picker)) {
              pickerUrls = fetchedData.picker.map((item: any) => item.url).filter(Boolean);
              break;
            }
          }
        }
      } catch (err: any) {
        console.error(`[Downloader] Exception with instance ${instance}:`, err.message);
      }
    }

    if (!downloadUrl && pickerUrls.length === 0) {
      await context.react("❌");
      return context.reply(`❌ *Failed to fetch media.*\n\n*Reason:* ${errorMsg}\n\n_Note: Please make sure the post is public and the platform is supported._`);
    }

    try {
      await context.react("📥");

      // Handle direct file download
      if (downloadUrl) {
        console.log(`[Downloader] Downloading direct file from: ${downloadUrl}`);

        // Stream to disk (SSRF-safe with pinned DNS, byte cap and timeout).
        const tempFilename = `nebula_download_${Date.now()}${audioOnly ? ".mp3" : ".mp4"}`;
        const tempPath = path.join(os.tmpdir(), tempFilename);
        const streamResult = await safeFetchToFile(downloadUrl, tempPath, {
          maxBytes: STREAM_MAX_BYTES,
          timeoutMs: 120_000,
        });
        if (!streamResult.ok) {
          throw new Error(streamResult.error || `HTTP error! status: ${streamResult.status}`);
        }
        const fileSizeMB = streamResult.sizeBytes / (1024 * 1024);

        // Over WhatsApp's limit → time-limited secure link (no in-memory copy).
        if (fileSizeMB > DIRECT_MEDIA_MAX_MB) {
          await context.react("🚀");
          const tempDownload = registerTempDownload(tempPath, tempFilename, {
            mimeType: audioOnly ? "audio/mpeg" : "video/mp4",
            ttlMinutes: 120,
            moveFile: true
          });

          return context.reply(
            `🚀 *TEMPORARY SECURE DOWNLOAD LINK* 🚀\n\n` +
            `⚠️ *File Size:* ${fileSizeMB.toFixed(1)} MB (Exceeds WhatsApp 100MB limit)\n` +
            `⏳ *Link Validity:* 2 Hours (Auto-expires)\n` +
            `⚙️ *Format:* ${audioOnly ? "Audio (MP3)" : "Video (MP4)"}\n\n` +
            `🔗 *Direct Download Link:*\n` +
            `${tempDownload.downloadUrl}\n\n` +
            `💡 _Click the link to download directly at high speed in your browser._`
          );
        }

        // In-limit: read into a buffer for WhatsApp delivery.
        const fileBuffer = fs.readFileSync(tempPath);

        // Send media based on mode
        try {
          if (audioOnly) {
            await sock.sendMessage(msg.key.remoteJid, {
              audio: fileBuffer,
              mimetype: "audio/mp4",
              ptt: false
            }, { quoted: msg });
          } else if (fileSizeMB <= 50) {
            await sock.sendMessage(msg.key.remoteJid, {
              video: fileBuffer,
              caption: `✅ *Media successfully downloaded!*`,
              mimetype: "video/mp4"
            }, { quoted: msg });
          } else {
            // 50MB - 100MB send as document
            await sock.sendMessage(msg.key.remoteJid, {
              document: fileBuffer,
              mimetype: "video/mp4",
              fileName: `nebula_video_${Date.now()}.mp4`,
              caption: `✅ *Media successfully downloaded (${fileSizeMB.toFixed(1)} MB)!*`
            }, { quoted: msg });
          }
        } finally {
          fs.unlinkSync(tempPath);
        }
        await context.react("✅");
      } 
      // Handle carousel / multi-item picker downloads (e.g. Instagram carousels, slides)
      else if (pickerUrls.length > 0) {
        await context.reply(`📸 *Multiple media items detected (${pickerUrls.length}).* Sending the first 3 files...`);
        
        const limit = Math.min(pickerUrls.length, 3);
        for (let i = 0; i < limit; i++) {
          const itemUrl = pickerUrls[i];
          const fileRes = await safeFetch(itemUrl, {}, 5, { maxBytes: BUFFER_MAX_BYTES, timeoutMs: 90_000 });
          if (fileRes.ok) {
            const arrayBuffer = await fileRes.arrayBuffer();
            const fileBuffer = Buffer.from(arrayBuffer);
            
            // Send as image or video based on mime/type
            const contentType = fileRes.headers.get("content-type") || "";
            if (contentType.includes("video")) {
              await sock.sendMessage(msg.key.remoteJid, { video: fileBuffer }, { quoted: msg });
            } else {
              await sock.sendMessage(msg.key.remoteJid, { image: fileBuffer }, { quoted: msg });
            }
          }
        }
        await context.react("✅");
      }

    } catch (err: any) {
      console.error("[Downloader] Error sending media:", err);
      await context.react("❌");
      await context.reply(
        `❌ *Error sending file to WhatsApp.*\n\n` +
        `*Details:* ${err.message || err}\n\n` +
        `*Direct Link:* You can try downloading it directly here:\n🔗 ${downloadUrl || pickerUrls[0]}`
      );
    }
  }
};

export default downloadCommand;
