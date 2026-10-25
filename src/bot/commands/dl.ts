import path from "path";
import { BotCommand } from "../types.js";
import { isSafeDownloadUrl } from "../urlSafety.js";
import { runYtDlp } from "../services/ytDlp.js";
import { fetchMediaToTempFile } from "../services/mediaLinkDelivery.js";
import { registerTempDownload, getLinkTtlMinutes } from "../tempDownloadManager.js";
import { createProgressReporter, type ProgressSendFn } from "../services/progressMessenger.js";
import { WHATSAPP_DOC_SAFE_MB } from "../services/mediaToolkit.js";
import { rememberLastTrack } from "../services/lastTrackStore.js";

/**
 * 9.18llll — `.dl` : téléchargeur GÉNÉRIQUE de réseaux sociaux.
 *
 * Analyse concurrent KnightBot-Mini : leurs commandes facebook/twitter/
 * pinterest reposent sur des APIs tierces payantes (KnightBot API,
 * princetechn, nexray) — non réutilisables. Notre avantage : yt-dlp gère
 * nativement Facebook, X/Twitter, Pinterest, TikTok, Instagram, Reddit,
 * SoundCloud et 1000+ sites. Cette commande réutilise donc notre socle
 * éprouvé : runYtDlp (SSRF-safe par URL validée), fetchMediaToTempFile
 * (streaming disque + cap 200 Mo), progressMessenger (barre LIVE hhhh),
 * tempDownloadManager (liens /d/ à TTL glissant).
 *
 * Livraison : document WhatsApp ≤ 90 Mo (règle doc), sinon lien /d/ seul.
 */
const QUALITY_FORMAT = "bv*[height<=720]+ba/b[height<=720]/b";

const URL_RE = /https?:\/\/[^\s]+/i;

export interface DlInfo {
  title: string;
  ext: string;
  url: string;
  sizeBytes: number | null;
  extractor: string;
  isImage: boolean;
}

/** Extrait les champs utiles du JSON yt-dlp — pur, testé. */
export function parseDlJson(raw: string): DlInfo | null {
  let info: any;
  try {
    info = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!info || typeof info !== "object") return null;
  // Réponse d'erreur yt-dlp (process ok mais JSON = {"error": ...})
  if (info.error) return null;
  const url: string | undefined = info.url || info.requested_formats?.[0]?.url || info.formats?.[0]?.url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const ext = String(info.ext || path.extname(new URL(url).pathname).replace(".", "") || "mp4").toLowerCase();
  const noVideo = !info.vcodec || info.vcodec === "none";
  const noAudio = !info.acodec || info.acodec === "none";
  const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) || (noVideo && noAudio && !info.duration);
  return {
    title: String(info.title || "media").replace(/\s+/g, " ").trim().slice(0, 120),
    ext,
    url,
    sizeBytes: Number(info.filesize || info.filesize_approx || 0) || null,
    extractor: String(info.extractor_key || info.extractor || "site"),
    isImage,
  };
}

function sanitizeFilename(title: string, ext: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80).trim() || "media";
  return `${base}.${ext || "mp4"}`;
}

const dlCommand: BotCommand = {
  name: "dl",
  aliases: ["download", "gdl"],
  category: "Média",
  acceptsUrlArgs: true, // le guardrail agent préserve les URLs ici
  description: "Télécharge un média depuis Facebook, X/Twitter, Pinterest, Reddit… (yt-dlp, 1000+ sites).",
  usage: ".dl <lien>",
  examples: [".dl https://www.facebook.com/watch/?v=123…", ".dl https://www.pinterest.com/pin/…"],
  execute: async (sock, msg, context) => {
    let anchorKey: unknown = null;
    try {
      const argText = (context.args || []).join(" ");
      const rawUrl = (argText.match(URL_RE) || [])[0];
      if (!rawUrl) {
        await context.reply(
          "📥 *Téléchargeur générique*\n\n`.dl <lien>` — Facebook, X/Twitter, Pinterest, Reddit, TikTok, Instagram, SoundCloud…\n\nEx : `.dl https://www.facebook.com/watch/?v=123…`\n_(Qualité plafonnée à 720p, ≤ 90 Mo en pièce jointe, au-delà par lien)._",
        );
        return;
      }
      if (!(await isSafeDownloadUrl(rawUrl))) {
        await context.reply("❌ Ce lien n'est pas autorisé (adresse privée ou invalide).");
        return;
      }

      const anchor = await context.reply(`🔎 *Analyse du lien…*\n${rawUrl.slice(0, 120)}`);
      anchorKey = (anchor as any)?.key ?? null;

      const meta = await runYtDlp(
        ["-J", "--no-playlist", "--no-warnings", "-f", QUALITY_FORMAT, rawUrl],
        90000,
        300000,
      );
      const info = meta.ok ? parseDlJson(meta.stdout) : null;
      if (!info) {
        await sock.sendMessage(
          msg.key.remoteJid!,
          { text: "❌ *Site non pris en charge ou vidéo indisponible.*\n_Vérifie le lien (public, pas privé) et réessaie — sinon ce site n'est pas extractible pour l'instant._" },
          { quoted: msg },
        );
        return;
      }

      // Barre LIVE hhhh — ancrée sur le message d'analyse.
      const sendProgress: ProgressSendFn = async (text: string, editKey?: unknown) => {
        const target = sock;
        if (!target) throw new Error("no socket");
        return await target.sendMessage(
          msg.key.remoteJid!,
          editKey ? { text, edit: editKey as any } : { text },
          { quoted: msg },
        );
      };
      const progress = createProgressReporter({
        send: sendProgress,
        anchorKey,
        title: `📥 ${info.title} (${info.extractor})`,
        initialPhaseLabel: "Téléchargement",
      });

      const localPath = await fetchMediaToTempFile(info.url, (received, total) => {
        progress.update({
          percent: total > 0 ? (received / total) * 100 : null,
          bytesDone: received,
        });
      });
      if (!localPath) {
        await progress.finish(
          `*📥 ${info.title}*\n⚠️ Téléchargement interrompu ou fichier trop volumineux (> 200 Mo) — réessaie.`,
        );
        return;
      }

      const filename = sanitizeFilename(info.title, info.ext);
      const sizeBytes = await (async () => {
        try {
          const fs = await import("fs");
          return fs.statSync(localPath).size;
        } catch {
          return 0;
        }
      })();
      const sizeMB = sizeBytes / 1e6;
      const rec = registerTempDownload(localPath, filename, {
        mimeType: info.isImage ? `image/${info.ext === "jpg" ? "jpeg" : info.ext}` : `video/${info.ext === "mov" ? "quicktime" : "mp4"}`,
      });

      if (info.isImage && sizeMB <= 10) {
        await sock.sendMessage(msg.key.remoteJid!, { image: { url: localPath } }, { quoted: msg });
      } else if (sizeMB <= WHATSAPP_DOC_SAFE_MB) {
        await sock.sendMessage(
          msg.key.remoteJid!,
          {
            document: { url: localPath },
            mimetype: info.isImage ? "image/jpeg" : "video/mp4",
            fileName: filename,
          },
          { quoted: msg },
        );
      }
      await progress.finish(
        `*📥 ${info.title}*\n✅ Téléchargement terminé (${sizeMB.toFixed(1).replace(".", ",")} Mo) — ${
          rec ? `lien valable ${getLinkTtlMinutes()} min : ${rec.downloadUrl}` : "envoyé ci-dessus"
        }`,
      );
    } catch {
      const fallback = `⚠️ Téléchargement interrompu — réessaie.`;
      try {
        if (anchorKey && sock?.sendMessage) {
          await sock.sendMessage(msg.key.remoteJid!, { text: fallback, edit: anchorKey as any }, { quoted: msg });
        } else {
          await context.reply(fallback);
        }
      } catch {}
    }
  },
};

// ── 9.18oooo (quick win) — .dla : piste AUDIO seule d'un lien ───────────────
// Même socle éprouvé que .dl (yt-dlp + fetchMediaToTempFile + lien /d/), mais
// le sélecteur de format ne prend QUE la meilleure piste audio (ba) : idéal
// pour SoundCloud, Mixcloud, YouTube… Livré en MUSIQUE lisible dans WhatsApp
// (≤ 60 Mo, règle audio maison), au-delà par lien /d/. Le titre livré alimente
// le couplage .lyrics (dernière piste du chat).

const AUDIO_FORMAT = "ba/bestaudio/best";
const MAX_AUDIO_DELIVERY_MB = 60;

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg; codecs=opus",
  opus: "audio/ogg; codecs=opus",
  webm: "audio/webm",
  wav: "audio/wav",
  flac: "audio/flac",
};

const dlaCommand: BotCommand = {
  name: "dla",
  category: "Média",
  acceptsUrlArgs: true, // le guardrail agent préserve les URLs ici
  description: "Piste audio seule d'un lien (SoundCloud, Mixcloud, YouTube…) — livrée en musique lisible.",
  usage: ".dla <lien>",
  examples: [".dla https://soundcloud.com/artiste/morceau", ".dla https://www.youtube.com/watch?v=…"],
  execute: async (sock, msg, context) => {
    let anchorKey: unknown = null;
    let localPath: string | null = null;
    try {
      const argText = (context.args || []).join(" ");
      const rawUrl = (argText.match(URL_RE) || [])[0];
      if (!rawUrl) {
        await context.reply(
          "🎧 *Extraction audio*\n\n`.dla <lien>` — SoundCloud, Mixcloud, YouTube, Bandcamp…\n\nEx : `.dla https://soundcloud.com/artiste/morceau`\n_(≤ 60 Mo en musique lisible, au-delà par lien)._",
        );
        return;
      }
      if (!(await isSafeDownloadUrl(rawUrl))) {
        await context.reply("❌ Ce lien n'est pas autorisé (adresse privée ou invalide).");
        return;
      }

      const anchor = await context.reply(`🎧 *Extraction de la piste audio…*\n${rawUrl.slice(0, 120)}`);
      anchorKey = (anchor as any)?.key ?? null;

      const meta = await runYtDlp(
        ["-J", "--no-playlist", "--no-warnings", "-f", AUDIO_FORMAT, rawUrl],
        90000,
        300000,
      );
      const info = meta.ok ? parseDlJson(meta.stdout) : null;
      if (!info) {
        await sock.sendMessage(
          msg.key.remoteJid!,
          { text: "❌ *Aucune piste audio extractible pour ce lien.*\n_Vérifie qu'il pointe vers un contenu public avec audio._" },
          { quoted: msg },
        );
        return;
      }

      const sendProgress: ProgressSendFn = async (text: string, editKey?: unknown) => {
        const target = sock;
        if (!target) throw new Error("no socket");
        return await target.sendMessage(
          msg.key.remoteJid!,
          editKey ? { text, edit: editKey as any } : { text },
          { quoted: msg },
        );
      };
      const progress = createProgressReporter({
        send: sendProgress,
        anchorKey,
        title: `🎧 ${info.title} (${info.extractor})`,
        initialPhaseLabel: "Extraction audio",
      });

      localPath = await fetchMediaToTempFile(info.url, (received, total) => {
        progress.update({
          percent: total > 0 ? (received / total) * 100 : null,
          bytesDone: received,
        });
      });
      if (!localPath) {
        await progress.finish(
          `*🎧 ${info.title}*\n⚠️ Téléchargement interrompu ou fichier trop volumineux — réessaie.`,
        );
        return;
      }

      const filename = sanitizeFilename(info.title, info.ext);
      const sizeBytes = await (async () => {
        try {
          const fs = await import("fs");
          return fs.statSync(localPath!).size;
        } catch {
          return 0;
        }
      })();
      const sizeMB = sizeBytes / 1e6;
      const rec = registerTempDownload(localPath, filename, {
        mimeType: AUDIO_MIME[info.ext] || "audio/mpeg",
      });

      const audioMime = AUDIO_MIME[info.ext];
      if (audioMime && sizeMB <= MAX_AUDIO_DELIVERY_MB) {
        // Musique lisible directement dans WhatsApp (comme .ytm).
        await sock.sendMessage(
          msg.key.remoteJid!,
          { audio: { url: localPath }, mimetype: audioMime, ptt: false, fileName: filename },
          { quoted: msg },
        );
      }
      // 9.18nnnn : .lyrics sans argument reprend cette piste.
      rememberLastTrack(String(msg.key.remoteJid || ""), info.title);
      await progress.finish(
        `*🎧 ${info.title}*\n✅ Audio prêt (${sizeMB.toFixed(1).replace(".", ",")} Mo) — ${
          audioMime && sizeMB <= MAX_AUDIO_DELIVERY_MB
            ? "musique envoyée ci-dessus"
            : `trop lourd pour l'envoi direct — lien valable ${getLinkTtlMinutes()} min : ${rec ? rec.downloadUrl : "indisponible"}`
        }`,
      );
    } catch {
      const fallback = "⚠️ Extraction audio interrompue — réessaie.";
      try {
        if (anchorKey && sock?.sendMessage) {
          await sock.sendMessage(msg.key.remoteJid!, { text: fallback, edit: anchorKey as any }, { quoted: msg });
        } else {
          await context.reply(fallback);
        }
      } catch {}
    }
  },
};

export default dlCommand;
export { dlaCommand };
