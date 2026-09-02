import { BotCommand, BotCommandContext } from "../types.js";
import fs from "fs";
import os from "os";
import path from "path";
import {
  WHATSAPP_DOC_SAFE_MB,
  buildCompressArgs,
  buildGifArgs,
  buildMp3Args,
  buildSpeedArgs,
  buildTrimArgs,
  parseTimeSpec,
  probeVideoInfo,
  runFfmpegKit
} from "../services/mediaToolkit.js";
import { registerTempDownload } from "../tempDownloadManager.js";

/**
 * Nebula media toolkit (audit 8.48): FFmpeg utilities on WhatsApp media.
 * Reply to a video/audio/document with `.m <outil>` (the engine falls back
 * to the quoted message's media). Recipes from the audit 9.7 references:
 * size-target compression (video-compress formula, audio subtracted),
 * chained atempo speed changes, palettegen GIFs (sadness-splitter).
 *
 * One operation at a time process-wide: the VPS CPU is a shared container
 * resource and two parallel encodes would starve the bot.
 */

const USAGE = `🎞️ *NEBULA MÉDIA* — outils FFmpeg

_Réponds à une vidéo / un audio avec_ :

*.m mp3* _[96|128|192|320]_
→ extrait la piste audio en MP3

*.m gif* _[fps] [largeur] [full]_
→ GIF de qualité (défaut : 12 fps, 480px, 10 premières secondes)

*.m vitesse* _0.5 → 4_
→ accélère ou ralentit (audio ajusté)

*.m trim* _1:20 3:45_
→ découpe lossless entre deux instants

*.m compress* _50% | 95mb_
→ compresse (défaut : 95 mb, taille garantie par calcul)

🌌 _Nebula Bot - Your ultimate media center_`;

const busy = { active: false };

function tmpFile(name: string): string {
  return path.join(os.tmpdir(), `nebula_m_${Date.now()}_${name}`);
}

function mbOf(p: string): number {
  try {
    return fs.statSync(p).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

async function deliver(sock: any, msg: any, context: BotCommandContext, filePath: string, mimetype: string, caption: string): Promise<void> {
  const sizeMB = mbOf(filePath);
  if (sizeMB <= WHATSAPP_DOC_SAFE_MB) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { document: { url: filePath }, mimetype, fileName: path.basename(filePath), caption },
      { quoted: msg }
    );
    return;
  }
  // Too big for a direct document → high-speed temp link (2 h), same as anime delivery
  const temp = registerTempDownload(filePath, path.basename(filePath), { ttlMinutes: 120, moveFile: true });
  await context.reply(`${caption}\n\n📦 Fichier trop volumineux pour un envoi direct (${sizeMB.toFixed(1)} MB) — lien haute vitesse (2 h) :\n🔗 ${temp.downloadUrl}`);
}

export const mediaCommand: BotCommand = {
  name: "media",
  aliases: ["m"],
  category: "media",
  description: "Outiller média FFmpeg : mp3, gif, vitesse, trim, compress (répondre à un média)",
  usage: ".m [mp3|gif|vitesse|trim|compress] [options]",
  execute: async (sock, msg, context) => {
    const [sub = ""] = context.args;
    const cmd = sub.toLowerCase();

    if (!cmd || !["mp3", "gif", "vitesse", "speed", "trim", "compress"].includes(cmd)) {
      return void (await context.reply(USAGE));
    }
    if (busy.active) {
      return void (await context.reply("⏳ Un traitement média est déjà en cours — réessaie dans un instant."));
    }

    const buffer = await context.downloadMedia?.();
    if (!buffer || buffer.length < 1024) {
      return void (await context.reply(`❌ Aucun média trouvé.\n\n_Réponds à une vidéo / un audio avec la commande_ — exemple : \`.m gif\``));
    }

    busy.active = true;
    const inputPath = tmpFile("input.bin");
    let outputPath = "";
    try {
      fs.writeFileSync(inputPath, buffer);
      const info = await probeVideoInfo(inputPath);

      // ---- mp3 ----
      if (cmd === "mp3") {
        const kbps = parseInt(context.args[1] || "192", 10) || 192;
        outputPath = tmpFile("audio.mp3");
        await context.react("⏳");
        const r = await runFfmpegKit(buildMp3Args(inputPath, outputPath, kbps), 180000);
        if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr || "échec MP3");
        await deliver(sock, msg, context, outputPath, "audio/mpeg", `🎵 *Audio extrait* — MP3 ${kbps} kbps (${mbOf(outputPath).toFixed(1)} MB)`);
        return;
      }

      // ---- gif ----
      if (cmd === "gif") {
        const fps = parseInt(context.args[1] || "12", 10) || 12;
        const width = parseInt(context.args[2] || "480", 10) || 480;
        const full = (context.args[3] || "").toLowerCase() === "full" || (context.args[1] || "").toLowerCase() === "full";
        const maxDuration = full ? Math.min(info.durationSec || 30, 60) : 10;
        outputPath = tmpFile("clip.gif");
        await context.react("⏳");
        const r = await runFfmpegKit(buildGifArgs(inputPath, outputPath, fps, width, maxDuration), 300000);
        if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr || "échec GIF");
        await deliver(sock, msg, context, outputPath, "image/gif", `🎞️ *GIF* — ${fps} fps, ${width}px${full ? " (extrait long)" : " (10 premières secondes)"} — ${mbOf(outputPath).toFixed(1)} MB`);
        return;
      }

      // ---- vitesse ----
      if (cmd === "vitesse" || cmd === "speed") {
        const factor = parseFloat((context.args[1] || "").replace("x", ""));
        if (!Number.isFinite(factor) || factor < 0.5 || factor > 4) {
          return void (await context.reply("❌ Facteur de vitesse invalide (0.5 → 4). Exemple : `.m vitesse 1.5`"));
        }
        if (info.durationSec === null && info.height === null && !info.hasAudio) {
          throw new Error("média non vidéo — vitesse impossible");
        }
        outputPath = tmpFile("speed.mp4");
        await context.react("⏳");
        const r = await runFfmpegKit(buildSpeedArgs(inputPath, outputPath, factor, info.hasAudio), 300000);
        if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr || "échec vitesse");
        await deliver(sock, msg, context, outputPath, "video/mp4", `⚡ *Vitesse ×${factor}* — durée ${((info.durationSec || 0) / factor).toFixed(0)} s → ${mbOf(outputPath).toFixed(1)} MB`);
        return;
      }

      // ---- trim ----
      if (cmd === "trim") {
        const start = parseTimeSpec(context.args[1] || "");
        const end = parseTimeSpec(context.args[2] || "");
        if (start === null || end === null || end <= start) {
          return void (await context.reply("❌ Instants invalides. Exemple : `.m trim 1:20 3:45`"));
        }
        outputPath = tmpFile("trim.mp4");
        await context.react("⏳");
        const r = await runFfmpegKit(buildTrimArgs(inputPath, outputPath, start, end), 120000);
        if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr || "échec trim");
        await deliver(sock, msg, context, outputPath, "video/mp4", `✂️ *Extrait* ${context.args[1]} → ${context.args[2]} — ${mbOf(outputPath).toFixed(1)} MB`);
        return;
      }

      // ---- compress ----
      const spec = (context.args[1] || "95mb").toLowerCase();
      let mode: "pct" | "mb" | "crf" = "mb";
      let value = 95;
      if (spec.endsWith("%")) {
        mode = "pct";
        value = Math.min(100, Math.max(1, parseInt(spec, 10) || 50));
      } else if (spec.endsWith("mb")) {
        mode = "mb";
        value = Math.min(500, Math.max(5, parseInt(spec, 10) || 95));
      } else if (spec.match(/^\d+$/)) {
        mode = "crf";
        value = Math.min(51, Math.max(18, parseInt(spec, 10)));
      }
      outputPath = tmpFile("compressed.mp4");
      await context.react("⏳");
      const built = buildCompressArgs(inputPath, outputPath, { mode, value, durationSec: info.durationSec, heightCap: 480 });
      const r = await runFfmpegKit(built.args, 300000);
      if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr || "échec compression");
      const inMB = buffer.length / (1024 * 1024);
      await deliver(sock, msg, context, outputPath, "video/mp4", `📉 *Compression* ${inMB.toFixed(1)} MB → ${mbOf(outputPath).toFixed(1)} MB (${built.note})`);
      return;
    } catch (err: any) {
      console.warn("[MEDIA] toolkit error:", err?.message);
      const reason = /moov|format|invalid/i.test(err?.message || "") ? "format non supporté" : "traitement impossible";
      await context.reply(`❌ *Échec du traitement* (${reason}). Vérifie que le média est bien une vidéo/audio et ressaye.`);
    } finally {
      busy.active = false;
      // registerTempDownload(moveFile) may already have moved the output.
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      } catch {}
      try {
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}
    }
  }
};

export default mediaCommand;
