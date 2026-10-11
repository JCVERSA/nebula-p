import fs from "fs";
import path from "path";
import { BotCommand } from "../types.js";
import { extractQuotedMediaContent } from "../utils/quotedMedia.js";
import { registerTempDownload, getTempDownloadDir } from "../tempDownloadManager.js";

/**
 * .upload (9.5) — génère un lien de téléchargement temporaire pour un
 * média envoyé ou cité (reply). Demandé owner : partage de fichiers via
 * lien direct, sans passer par WhatsApp.
 *
 * Alias : .up · .tr · .lu · .opload · .opl · .upl
 *
 * Décisions owner : TTL 2 h GLISSANT (chaque téléchargement relance le
 * délai — même mécanisme que les liens anime), taille max réglable
 * NEBULA_UPLOAD_MAX_MB (défaut 500, dashboard + nebula env), quota
 * 50 uploads/heure/utilisateur, agent autorisé (commande légère).
 *
 * Réutilise l'infrastructure éprouvée des liens anime : tempDownloadManager
 * (purge auto, TTL glissant via /d/), route publique /api/media/download.
 */

const MEDIA_KEYS = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
const WRAPPER_KEYS = ["viewOnceMessage", "viewOnceMessageV2", "ephemeralMessage", "documentWithCaptionMessage"];

/** Déplie les couches d'emballage Baileys (viewOnce, éphémère…). */
function unwrap(content: any): any {
  let c = content;
  for (let i = 0; i < 4 && c && typeof c === "object"; i++) {
    const k = Object.keys(c)[0];
    if (k && WRAPPER_KEYS.includes(k) && c[k]?.message) c = c[k].message;
    else break;
  }
  return c;
}

/** Trouve le nœud média du message (direct OU cité). Pur — testé. */
export function findMediaNode(messageContent: any): { node: any; kind: string } | null {
  if (!messageContent || typeof messageContent !== "object") return null;
  const direct = unwrap(messageContent);
  const kind = Object.keys(direct || {}).find((k) => MEDIA_KEYS.includes(k));
  if (kind) return { node: direct[kind], kind };
  const quoted = extractQuotedMediaContent(messageContent);
  if (quoted) {
    const qk = Object.keys(quoted).find((k) => MEDIA_KEYS.includes(k));
    if (qk) return { node: quoted[qk], kind: qk };
  }
  return null;
}

/** Nom de fichier propre + mimetype selon le type de média. Pur — testé. */
export function mediaMeta(node: any, kind: string): { filename: string; mimeType?: string } {
  const mime = node?.mimetype ? String(node.mimetype) : undefined;
  switch (kind) {
    case "documentMessage": {
      const raw = String(node?.fileName || "").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120).trim();
      return { filename: raw || `fichier-${Date.now()}`, mimeType: mime };
    }
    case "imageMessage":
      return { filename: `image-${Date.now()}.jpg`, mimeType: mime || "image/jpeg" };
    case "videoMessage":
      return { filename: `video-${Date.now()}.mp4`, mimeType: mime || "video/mp4" };
    case "audioMessage":
      return { filename: `audio-${Date.now()}.${(mime || "").includes("ogg") ? "ogg" : "mp3"}`, mimeType: mime };
    case "stickerMessage":
      return { filename: `sticker-${Date.now()}.webp`, mimeType: "image/webp" };
    default:
      return { filename: `fichier-${Date.now()}`, mimeType: mime };
  }
}

/** Taille max par fichier — NEBULA_UPLOAD_MAX_MB (défaut 500, lu à l'appel). */
export function getMaxUploadBytes(): number {
  const mb = Number(process.env.NEBULA_UPLOAD_MAX_MB || 500);
  if (!Number.isFinite(mb) || mb < 1) return 500 * 1024 * 1024;
  return mb * 1024 * 1024;
}

// ── Quota horaire (décision owner : 50/heure/utilisateur) ─────────────────
const UPLOADS_PER_HOUR = 50;
const uploads = new Map<string, number[]>();

export function checkUploadQuota(sender: string, now = Date.now()): boolean {
  const log = (uploads.get(sender) || []).filter((t) => now - t < 3_600_000);
  uploads.set(sender, log);
  return log.length < UPLOADS_PER_HOUR;
}

export function recordUpload(sender: string, now = Date.now()): void {
  const log = (uploads.get(sender) || []).filter((t) => now - t < 3_600_000);
  log.push(now);
  uploads.set(sender, log);
}

/** Tests uniquement. */
export function __resetUploadQuotaForTests(): void {
  uploads.clear();
}

const USAGE = (p: string) =>
  `📤 *Aucun fichier détecté.*\n\n` +
  `Envoie la commande AVEC le fichier, ou réponds (reply) à un message qui contient le média :\n\n` +
  `• joins le fichier, légende : \`${p}up\`\n` +
  `• reply sur le média → \`${p}up\`\n\n` +
  `_Images, vidéos, audios, documents — lien valable 2 h._`;

const uploadCommand: BotCommand = {
  name: "upload",
  aliases: ["up", "tr", "lu", "opload", "opl", "upl"],
  category: "Tools",
  description: "Générer un lien de téléchargement temporaire (2 h) pour un fichier envoyé ou cité",
  usage: ".up (avec le fichier, ou en reply d'un média)",
  execute: async (sock, msg, context) => {
    const media = findMediaNode(msg?.message);
    if (!media) {
      return void (await context.reply(USAGE(context.prefix)));
    }
    if (!context.downloadMedia) {
      return void (await context.reply("❌ *Téléchargement indisponible dans ce contexte.*"));
    }
    if (!checkUploadQuota(context.sender)) {
      return void (await context.reply(
        `⏳ *Limite d'uploads atteinte* (${UPLOADS_PER_HOUR}/heure) — réessaie dans un instant.`,
      ));
    }

    await context.react("📤");
    try {
      const buf = await context.downloadMedia();
      if (!buf || buf.length === 0) {
        return void (await context.reply("❌ *Impossible de récupérer le média* — réessaie."));
      }
      const maxBytes = getMaxUploadBytes();
      if (buf.length > maxBytes) {
        return void (await context.reply(
          `⚠️ *Fichier trop lourd* (${(buf.length / 1048576).toFixed(1)} Mo) — maximum ${Math.round(
            maxBytes / 1048576,
          )} Mo par fichier (réglable par l'owner).`,
        ));
      }

      recordUpload(context.sender);
      const meta = mediaMeta(media.node, media.kind);
      fs.mkdirSync(getTempDownloadDir(), { recursive: true });
      const unique = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${meta.filename}`;
      const tmpPath = path.join(getTempDownloadDir(), unique);
      fs.writeFileSync(tmpPath, buf);

      const rec = registerTempDownload(tmpPath, meta.filename, {
        mimeType: meta.mimeType,
        ttlMinutes: 120, // décision owner : 2 h glissantes
        meta: { origin: "upload", by: context.sender },
      });

      const sizeMB = (buf.length / 1048576).toFixed(buf.length < 10 * 1048576 ? 1 : 0);
      await context.reply(
        `🔗 *Lien de téléchargement généré*\n\n` +
          `📄 ${meta.filename} · ${sizeMB} Mo\n\n` +
          `${rec.downloadUrl}\n\n` +
          `⏳ Valide 2 h — chaque téléchargement relance le délai.\n` +
          `📤 Partage-le avec qui tu veux.`,
      );
    } catch (e: any) {
      console.error("Upload command error:", e?.message || e);
      await context.reply("😕 *Erreur pendant le traitement du fichier* — réessaie.");
    }
  },
};

export default uploadCommand;
