import fs from "fs";
import path from "path";
import os from "os";
import { BotCommand } from "../types.js";
import { runFfmpegKit } from "../services/mediaToolkit.js";
import { extractQuotedMediaContent } from "../utils/quotedMedia.js";

/**
 * `.s` — native sticker maker (audit 8.56 P3, owner-approved rewrite).
 *
 * Replaces the removed legacy corpus command with ~60 lines of our own code:
 * reply to an image or a short video (≤ 6 s taken) and it is converted to a
 * WhatsApp WebP sticker via the system ffmpeg — the same resolver/runner the
 * rest of the media toolkit uses (no new dependency). Custom EXIF pack names
 * are a documented follow-up: WhatsApp accepts plain WebP stickers.
 */

const busy = { active: false };

function tmpFile(name: string): string {
  return path.join(os.tmpdir(), `nebula_sticker_${Date.now()}_${name}`);
}

function mbOf(file: string): number {
  try {
    return fs.statSync(file).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

/** FFmpeg args for a static image → WebP sticker (≤512 px, transparent-safe). */
export function imageStickerArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-i", input,
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease,format=rgba",
    "-vcodec", "libwebp",
    "-lossless", "0",
    "-q:v", "90",
    "-an",
    output
  ];
}

/** FFmpeg args for a short video → animated WebP sticker (≤6 s, 512 px, 12 fps). */
export function videoStickerArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-t", "6",
    "-i", input,
    "-vf", "fps=12,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba",
    "-vcodec", "libwebp",
    "-loop", "0",
    "-lossless", "0",
    "-compression_level", "4",
    "-q:v", "80",
    "-an",
    output
  ];
}

const stickerCommand: BotCommand = {
  name: "sticker",
  aliases: ["s", "stiker", "stc"],
  category: "Media",
  description: "Transforme en sticker WhatsApp l'image ou la vidéo (≤6 s) à laquelle tu réponds.",
  usage: "s (en réponse à une image/vidéo)",
  execute: async (sock, msg, context) => {
    if (busy.active) {
      return void (await context.reply("⏳ Un sticker est déjà en préparation — réessaie dans un instant."));
    }

    const quoted = extractQuotedMediaContent(msg.message);
    const kind = quoted
      ? quoted.imageMessage
        ? "image"
        : quoted.videoMessage
        ? "video"
        : quoted.stickerMessage
        ? "sticker"
        : null
      : null;

    if (kind === "sticker") {
      return void (await context.reply("🧩 C'est déjà un sticker ! Réponds à une *image* ou une *vidéo* avec `.s`."));
    }
    if (!kind) {
      return void (await context.reply("❌ Réponds à une *image* ou une *vidéo* avec `.s` pour en faire un sticker."));
    }

    const buffer = await context.downloadMedia?.();
    if (!buffer || buffer.length < 1024) {
      return void (await context.reply("❌ Impossible de télécharger le média — réessaie (la vidéo ne doit pas dépasser quelques secondes)."));
    }
    if (buffer.length > 40 * 1024 * 1024) {
      return void (await context.reply("❌ Média trop volumineux (>40 Mo) — utilise un extrait plus court."));
    }

    busy.active = true;
    const inputPath = tmpFile("input.bin");
    const outputPath = tmpFile("sticker.webp");
    try {
      await context.react("⏳");
      fs.writeFileSync(inputPath, buffer);
      const args = kind === "video" ? videoStickerArgs(inputPath, outputPath) : imageStickerArgs(inputPath, outputPath);
      const r = await runFfmpegKit(args, 120000);
      if (!r.ok || !fs.existsSync(outputPath) || mbOf(outputPath) < 0.001) {
        throw new Error(r.stderr.slice(-400) || "échec conversion WebP");
      }
      await sock.sendMessage(
        msg.key.remoteJid,
        { sticker: { url: outputPath } },
        { quoted: msg }
      );
    } catch (err: any) {
      console.warn("[STICKER] conversion failed:", err?.message || err);
      await context.reply("❌ La conversion a échoué (format non supporté ?). Essaie une autre image/vidéo.");
    } finally {
      busy.active = false;
      for (const f of [inputPath, outputPath]) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    }
  }
};

export default stickerCommand;
