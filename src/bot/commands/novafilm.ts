import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { BotCommand, BotCommandContext } from "../types.js";
import { resolveBestMirrorStream } from "../services/animeStreamExtractor.js";
import { downloadHlsAppLevel } from "../services/hlsDownloader.js";
import { registerTempDownload, getLinkTtlMinutes, wouldExceedTempQuota } from "../tempDownloadManager.js";
import { probeVideoInfo } from "../services/mediaToolkit.js";
import { sanitizeFilename } from "../services/batchZipManager.js";
import { registerSlimOffer, slimOfferLine } from "../services/slimOffer.js";
import { slimTriggerBytes, slimEffectiveTargetMB, slimTargetMB, slimEtaMinutes } from "../services/videoSlim.js";
import { isSafeDownloadUrl } from "../urlSafety.js";
import { animeProxyOptions } from "../services/scrapingProxy.js";
import {
  filmSearch,
  getFilmDetail,
  filmMirrorsForLanguage,
  filmAvailableLanguages,
  type FilmSearchResult,
  type FilmPlayer,
} from "../services/filmStreamClient.js";

/**
 * 9.18wwww — Novaboxb : FILMS (décision owner 25/10).
 *
 * Catalogue : le plus complet + le plus recommandé (rapport de recherche
 * 25/10), piloté par NEBULA_FILM_SOURCE (rotation de domaine = une ligne
 * .env). Pipeline volontairement IDENTIQUE à Novabox animés — la confiance
 * du terrain se transpose : écran de sélection → langue structurelle
 * (VF par défaut, `.f vostfr` pour basculer) → qualités RÉELLES du manifest
 * (480/360 en priorité) → livraison éprouvée (≤60 Mo vidéo en chat,
 * ≤100 Mo document, sinon lien temporaire haute vitesse + offre `.slim`).
 *
 * Un film = UN fichier : pas d'écran épisodes, pas de batch. Les joueurs
 * (ViDZY, Voe, Filmoon, Vidmoly, Dood…) sont résolus par le moteur partagé
 * animeStreamExtractor (Dood ajouté dans la même livraison). La source
 * n'est JAMAIS nommée à l'utilisateur (règle 8.42) : « catalogue films ».
 */

interface FilmVariant {
  label: string;
  url: string;
  type: "direct_mp4" | "hls";
  headers: Record<string, string>;
  estimatedSizeMB?: number;
}

interface FilmSession {
  step: "select_film" | "quality";
  title: string;
  url: string;
  players: FilmPlayer[];
  language: "VF" | "VOSTFR";
  variants: FilmVariant[];
  hostName: string;
  searchResults: FilmSearchResult[];
  timer?: NodeJS.Timeout;
}

/** Garde SSRF (même esprit que Novabox) : jamais d'URL privée/localhost. */
async function isPublicFetchTarget(rawUrl: string, label: string): Promise<boolean> {
  try {
    if (await isSafeDownloadUrl(rawUrl)) return true;
  } catch {}
  console.warn(`[NOVAFILM] Blocked unsafe ${label}: ${rawUrl}`);
  return false;
}

const sessions = new Map<string, FilmSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

/** Plafond de taille d'un film (env, défaut 5 Go — honnête avant de lancer). */
function filmMaxMB(): number {
  const n = Number(process.env.NEBULA_FILM_MAX_MB || 5000);
  return Number.isFinite(n) && n >= 100 ? Math.floor(n) : 5000;
}

function clearFilmSession(sender: string) {
  const s = sessions.get(sender);
  if (s?.timer) clearTimeout(s.timer);
  sessions.delete(sender);
}

function refreshFilmTimer(sender: string) {
  const s = sessions.get(sender);
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => clearFilmSession(sender), SESSION_TTL_MS);
}

/** Ordre mobile-first (comme Novabox : 480/360 rapides en priorité). */
function variantSortOrder(label: string): number {
  const order: Record<string, number> = { "480P": 1, "360P": 2, "720P": 3, "1080P": 4, "2160P": 5 };
  return order[label.toUpperCase()] || 6;
}

/** Écran qualité commun (qualités réelles, 480/360 en tête). */
function buildQualityScreen(session: FilmSession): string {
  const langLine =
    filmAvailableLanguages(session.players).length > 1
      ? `\n_💡 (Autre langue disponible : \`.f ${session.language === "VF" ? "vostfr" : "vf"}\`)_`
      : "";
  const resOptions = session.variants
    .map((v, i) => {
      const size = v.estimatedSizeMB ? ` — *${v.estimatedSizeMB} MB*` : "";
      return `*r${i + 1}.* *${v.label}*${size}`;
    })
    .join("\n");
  return (
    `🎬 *Novafilm - Choisis la Qualité* 🎬\n` +
    `• *Film :* ${session.title}\n` +
    `• *Langue :* ${session.language}\n` +
    `• *Flux actif :* 📺 ${session.hostName}${langLine}\n\n` +
    `*Qualités réellement disponibles (480p/360p rapides en priorité) :*\n` +
    `${resOptions}\n\n` +
    `👉 Réponds avec : \`.f r [numéro]\` (ex : \`.f r 1\` ou \`.f r1\`)`
  );
}

/** Résout les miroirs de la langue demandée et prépare l'écran qualité. */
async function resolveFilmQuality(
  context: BotCommandContext,
  session: FilmSession,
  language: "VF" | "VOSTFR"
): Promise<void> {
  const mirrors = filmMirrorsForLanguage(session.players, language);
  if (mirrors.length === 0) {
    const other = filmAvailableLanguages(session.players).filter((l) => l !== language);
    throw Object.assign(new Error("no-mirror"), {
      hint: other.length
        ? `Aucun lecteur ${language} pour ce film — essaie \`.f ${other[0] === "VF" ? "vf" : "vostfr"}\`.`
        : "Aucun lecteur disponible pour ce film.",
    });
  }

  const best = await resolveBestMirrorStream(mirrors, "480P");
  if (!best || !best.url) {
    throw Object.assign(new Error("no-mirror"), { hint: "Impossible de résoudre le lecteur de ce film — réessaie dans un instant." });
  }

  session.language = language;
  session.hostName = best.hostName;

  const tracks = (best.availableTracks || []).filter((t) => !!t.url);
  if (tracks.length > 0) {
    session.variants = tracks
      .slice()
      .sort((a, b) => variantSortOrder(a.resolution) - variantSortOrder(b.resolution))
      .map((t) => ({
        label: t.resolution,
        url: t.url,
        type: t.type,
        headers: t.headers || best.headers,
        estimatedSizeMB: t.fileSizeBytes ? Math.max(1, Math.round(t.fileSizeBytes / (1024 * 1024))) : undefined,
      }));
  } else {
    // Manifest illisible : une seule entrée honnête, taille inconnue.
    session.variants = [
      {
        label: best.originalResolution || "Auto",
        url: best.url,
        type: best.type,
        headers: best.headers,
        estimatedSizeMB: best.estimatedSizeMB,
      },
    ];
  }
  session.step = "quality";
  await context.reply(buildQualityScreen(session));
}

/** Télécharge un MP4 direct avec plafond dur (jamais de disque sans garde). */
async function downloadDirectMp4(url: string, headers: Record<string, string>, localPath: string, maxBytes: number): Promise<boolean> {
  if (!(await isPublicFetchTarget(url, "film direct download"))) return false;
  const res = await axios.get(url, {
    headers,
    timeout: 30000,
    responseType: "stream",
    maxContentLength: maxBytes,
    validateStatus: () => true,
    ...animeProxyOptions(),
  });
  if (res.status !== 200) return false;
  await new Promise<boolean>((resolve) => {
    const ws = fs.createWriteStream(localPath);
    let stopped = false;
    res.data.on("error", () => {
      if (!stopped) {
        stopped = true;
        ws.destroy();
        resolve(false);
      }
    });
    ws.on("error", () => {
      if (!stopped) {
        stopped = true;
        resolve(false);
      }
    });
    ws.on("finish", () => {
      if (!stopped) {
        stopped = true;
        resolve(true);
      }
    });
    res.data.pipe(ws);
  });
  return fs.existsSync(localPath) && fs.statSync(localPath).size > 0;
}

const novafilmCommand: BotCommand = {
  name: "novafilm",
  aliases: ["f", "film", "films"],
  category: "Animes",
  description: "Films en streaming VF/VOSTFR — recherche, qualité réelle, lien direct",
  usage: ".f <titre> | .novafilm <titre>",
  examples: [".f insidious", ".f avatar", ".novafilm spider-man"],
  execute: async (sock, msg, context) => {
    const sender = context.sender;
    const firstArg = (context.args[0] || "").toLowerCase();

    // ── Écran qualité actif : .f vf / .f vostfr / .f r<N> / numéro ────────
    if (sessions.has(sender)) {
      const session = sessions.get(sender)!;
      refreshFilmTimer(sender);

      if (session.step === "select_film") {
        const choice = parseInt(firstArg, 10);
        if (!isNaN(choice) && choice >= 1 && choice <= session.searchResults.length) {
          const film = session.searchResults[choice - 1];
          session.title = film.title;
          session.url = film.url;
          await context.react("⏳");
          const detail = await getFilmDetail(film.url);
          if (detail.kind === "series") {
            clearFilmSession(sender);
            return context.reply(
              "📺 *Séries pas encore supportées par Novafilm* — cette entrée est une série.\n\nLes films marchent : `.f <titre de film>`."
            );
          }
          if (detail.kind === "error") {
            clearFilmSession(sender);
            return context.reply(`❌ *Impossible de charger ce film* (${detail.reason}) — réessaie dans un instant.`);
          }
          session.players = detail.players;
          const available = filmAvailableLanguages(session.players);
          if (available.length === 0) {
            clearFilmSession(sender);
            return context.reply("❌ *Aucun lecteur disponible pour ce film* — essaie un autre titre.");
          }
          const want: "VF" | "VOSTFR" = available.includes("VF") ? "VF" : "VOSTFR";
          await context.reply(`✨ *Sélectionné :* *${film.title}*\n🔗 Résolution des lecteurs (${want})...`);
          try {
            await resolveFilmQuality(context, session, want);
          } catch (err: any) {
            clearFilmSession(sender);
            return context.reply(`❌ *${err?.hint || "Impossible de résoudre les qualités"}*`);
          }
          return;
        }
        // pas un numéro → nouvelle recherche (remplace la session)
        clearFilmSession(sender);
      } else if (session.step === "quality") {
        if (firstArg === "vf" || firstArg === "vostfr") {
          const want = firstArg === "vf" ? "VF" : "VOSTFR";
          await context.react("⏳");
          try {
            await resolveFilmQuality(context, session, want);
          } catch (err: any) {
            return context.reply(`❌ *${err?.hint || "Impossible de basculer la langue"}*`);
          }
          return;
        }
        const rMatch = firstArg.match(/^(?:r|res)?(\d+)$/i);
        if (rMatch) {
          const idx = parseInt(rMatch[1], 10) - 1;
          if (idx < 0 || idx >= session.variants.length) {
            return context.reply(`❌ *Choix invalide :* réponds \`.f r1\` à \`.f r${session.variants.length}\`.`);
          }
          const variant = session.variants[idx];
          const title = session.title;
          const language = session.language;
          const hostName = session.hostName;
          clearFilmSession(sender); // le téléchargement ne dépend plus de la session

          if ((variant.estimatedSizeMB || 0) > filmMaxMB()) {
            return context.reply(
              `⚠️ *Film trop volumineux* (${variant.estimatedSizeMB} Mo — plafond ${filmMaxMB()} Mo).\n\nChoisis une qualité plus basse ou une version allégée.`
            );
          }
          if (variant.estimatedSizeMB && wouldExceedTempQuota(variant.estimatedSizeMB * 1024 * 1024)) {
            return context.reply(
              "⚠️ *Stockage temporaire saturé* — réessaie dans un instant (les liens expirent et libèrent la place)."
            );
          }

          await context.react("⏳");
          await context.reply(
            `📥 *Téléchargement de ${title}* (${variant.label}) en cours...\n_Un film est plus long qu'un épisode — quelques minutes de patience._`
          );

          const localPath = path.join(os.tmpdir(), `novafilm_${crypto.randomBytes(8).toString("hex")}.mp4`);
          let ok = false;
          try {
            if (variant.type === "hls") {
              ok = await downloadHlsAppLevel(variant.url, localPath, variant.headers, 600000);
            } else {
              ok = await downloadDirectMp4(variant.url, variant.headers, localPath, filmMaxMB() * 1024 * 1024);
            }
          } catch {
            ok = false;
          }
          if (!ok || !fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
            if (fs.existsSync(localPath)) {
              try {
                fs.unlinkSync(localPath);
              } catch {}
            }
            return context.reply(
              "❌ *Le téléchargement de ce film a échoué* — réessaie (un autre lecteur peut être en panne), ou relance `.f <titre>` pour repartir de la sélection."
            );
          }

          // ── Livraison (chemin éprouvé Novabox) ─────────────────────────
          const stats = fs.statSync(localPath);
          const fileSizeMB = Number((stats.size / 1e6).toFixed(1));
          const resClean = variant.label.replace(/[^0-9a-zA-Z]/g, "") || "FILM";
          const filename = sanitizeFilename(`${title.replace(/\s+/g, "_")}_${language}_${resClean}_FILM`) + ".mp4";

          try {
            const tempDownload = registerTempDownload(localPath, filename, { mimeType: "video/mp4" });
            const link = tempDownload.downloadUrl;

            let slimOfferText = "";
            if (stats.size > slimTriggerBytes() && tempDownload.filePath) {
              const probed = await probeVideoInfo(tempDownload.filePath);
              const offer = registerSlimOffer(String(msg.key.remoteJid || sender), {
                tempFilePath: tempDownload.filePath,
                sourceUrl: link,
                filename,
                bytes: stats.size,
                targetMB: slimEffectiveTargetMB(stats.size, probed.durationSec || 0, slimTargetMB()),
                meta: { title, lang: language, resolution: variant.label, player: hostName },
              });
              slimOfferText =
                "\n\n" + slimOfferLine(offer.bytes, offer.targetMB, slimEtaMinutes(offer.bytes, "aggressive"));
            }

            const caption =
              `📥 *NEBULA NOVAFILM DOWNLOAD* 📥\n\n` +
              `🎬 *Film:* ${title}\n` +
              `🗣️ *Language:* ${language}\n` +
              `⚙️ *Resolution:* ${variant.label}\n` +
              `📦 *Size:* ${fileSizeMB} MB\n` +
              `📺 *Player Source:* ${hostName}\n` +
              `📄 *Filename:* \`${filename}\`\n\n` +
              `🚀 *Direct High-Speed Download (Browser/PC):*\n🔗 ${link}\n` +
              `⏳ _Valid ${getLinkTtlMinutes()} min after each download (max 2 h)_` +
              slimOfferText;

            if (fileSizeMB <= 60) {
              await sock.sendMessage(msg.key.remoteJid, { video: { url: tempDownload.filePath }, caption, mimetype: "video/mp4" }, { quoted: msg });
            } else if (fileSizeMB <= 100) {
              await context.reply(caption);
              await sock.sendMessage(
                msg.key.remoteJid,
                { document: { url: tempDownload.filePath }, mimetype: "video/mp4", fileName: filename },
                { quoted: msg }
              );
            } else {
              await context.reply(
                `🚀 *TEMPORARY HIGH-SPEED DOWNLOAD LINK* 🚀\n\n` +
                  `⚠️ *File Size:* ${fileSizeMB} MB (Exceeds WhatsApp 100MB limit)\n` +
                  `⏳ *Link Validity:* ${getLinkTtlMinutes()} min after each download (max 2 h)\n` +
                  `🎬 *Film:* ${title}\n` +
                  `🗣️ *Language:* ${language}\n` +
                  `⚙️ *Quality:* ${variant.label}\n` +
                  `📄 *File:* \`${filename}\`\n\n` +
                  `🔗 *Secure Download Link:*\n${link}\n\n` +
                  `💡 _Click the link to download directly at full speed or stream in your browser._\n\n` +
                  caption
              );
            }
            await context.react("✅");
          } catch (deliverErr: any) {
            console.error("[NOVAFILM] Delivery error:", deliverErr?.message);
            await context.reply(
              `⚠️ *Film téléchargé (${fileSizeMB} Mo) mais l'envoi a échoué* — réessaie, ou relance \`.f ${title.replace(/\s+/g, "_").toLowerCase()}\`.`
            );
          }
          return;
        }
        return context.reply(buildQualityScreen(session));
      }
    }

    // ── Nouvelle recherche ────────────────────────────────────────────────
    const query = context.args.join(" ").trim();
    if (!query) {
      return context.reply(
        `🎬 *Novafilm — Films en streaming VF/VOSTFR*\n\n` +
          `Exemple : \`.f insidious\` ou \`.novafilm spider-man\`\n\n` +
          `• VF par défaut, \`.f vostfr\` pour basculer\n` +
          `• Qualités réelles (480p/360p en priorité)\n` +
          `• ≤ 60 Mo : vidéo directe en chat · ≤ 100 Mo : document · sinon lien haute vitesse`
      );
    }

    await context.react("🔍");
    await context.reply(`🔍 *Recherche du film :* "${query}"...`);
    let results: FilmSearchResult[] = [];
    try {
      results = await filmSearch(query);
    } catch {
      results = [];
    }
    if (results.length === 0) {
      return context.reply(
        `❌ *Aucun film trouvé pour "${query}".*\n\n✍️ *Vérifie l'orthographe* — essaie le titre principal (ex : « avatar », « insidious »).`
      );
    }

    const list = results
      .slice(0, 8)
      .map((r, i) => `*${i + 1}.* ${r.title}`)
      .join("\n");
    clearFilmSession(sender);
    const session: FilmSession = {
      step: "select_film",
      title: "",
      url: "",
      players: [],
      language: "VF",
      variants: [],
      hostName: "",
      searchResults: results.slice(0, 8),
    };
    sessions.set(sender, session);
    refreshFilmTimer(sender);

    return context.reply(
      `🎬 *Novafilm - Sélectionner le Film* 🎬\n\n` +
        `Résultats trouvés pour *"${query}"*. Choisis le film souhaité :\n\n${list}\n\n` +
        `👉 Réponds avec : \`.f [numéro]\` (ex : \`.f 1\`)`
    );
  },
};

export default novafilmCommand;
