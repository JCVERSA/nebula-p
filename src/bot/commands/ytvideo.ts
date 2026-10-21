import axios from "axios";
import fs from "fs";
import path from "path";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { activeCookiesFile, isPlaylistLink, probeYoutubeEntry, ytvViaYtDlp } from "../services/ytDlp.js";
import { slimEtaMinutes, slimVideoIfNeeded, slimTriggerBytes } from "../services/videoSlim.js";
import { createBatchJob, updateEpisodeProgress, updateJobStatus, completeBatchJob } from "../batchDownloadManager.js";
import { buildDownloadPage, registerDownloadPage } from "../services/downloadPage.js";
import { registerTempDownload, getLinkTtlMinutes } from "../tempDownloadManager.js";
import { lookupMediaReuse, storeMediaReuse, ytvReuseKey } from "../services/mediaReuseStore.js";
import { BatchZipManager } from "../services/batchZipManager.js";

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
// 9.7 : on télécharge plus gros (jusqu'à 400 Mo) puis on AMINCIT à même
// résolution — au lieu de refuser les vidéos de plus de 100 Mo.
const SLIM_SOURCE_CEILING = 400 * 1024 * 1024;

// ── 9.10 (owner) : pistes audio, sous-titres, playlists ────────────────────
// Décisions owner 2026-10-11 : piste audio FRANÇAISE par défaut (vo → choix),
// sous-titres FR intégrés automatiquement (EN à défaut), playlists max 25
// vidéos livrées en page HTML (+ ZIP optionnel derrière NEBULA_BATCH_ZIP),
// choix proposé « vidéo seule / playlist » sur un lien contenant list=.
const MAX_PLAYLIST_VIDEOS = 25;
const MAX_PLAYLIST_TOTAL_MB = 2000;

const KNOWN_AUDIO_LANGS = new Set(["fr", "en", "ja", "de", "es", "it", "pt", "ru", "ar", "ko", "zh"]);
const LANG_LABELS: Record<string, string> = {
  fr: "Français", en: "Anglais", ja: "Japonais", de: "Allemand", es: "Espagnol",
  it: "Italien", pt: "Portugais", ru: "Russe", ar: "Arabe", ko: "Coréen", zh: "Chinois"
};
function langLabel(code: string): string {
  return LANG_LABELS[code.split("-")[0]] || code;
}

export interface YtvTokens {
  quality: string;
  searchQuery: string;
  /** « vo » (choix à la demande) ou un code de langue connu (fr, ja…). */
  audioToken?: string;
  forceMode?: "video" | "playlist";
}

/** Parse args : qualité + mots-clés 9.10 (vo, langue, playlist, video). Pur — testé. */
export function parseYtvArgs(args: string[]): YtvTokens {
  let quality = "720";
  let audioToken: string | undefined;
  let forceMode: "video" | "playlist" | undefined;
  const rest: string[] = [];
  for (const raw of args) {
    const a = raw.toLowerCase();
    if (a === "playlist" || a === "pl") { forceMode = "playlist"; continue; }
    if (a === "video" || a === "vid") { forceMode = "video"; continue; }
    if (a === "vo") { audioToken = "vo"; continue; }
    if (KNOWN_AUDIO_LANGS.has(a)) { audioToken = a; continue; }
    rest.push(raw);
  }
  const lastArg = rest[rest.length - 1];
  const lastQuality = lastArg?.replace(/p$/i, "");
  if (lastQuality && ["360", "480", "720", "1080"].includes(lastQuality)) {
    quality = lastQuality;
    rest.pop();
  }
  return { quality, searchQuery: rest.join(" ").trim(), audioToken, forceMode };
}

/** Sous-titres : FR manuel → FR auto → EN manuel → EN auto → aucun. Pur — testé. */
export function pickSubtitles(subtitleLanguages: string[]): { lang: string; auto: boolean } | null {
  const manual = subtitleLanguages.filter((s) => !s.startsWith("auto:"));
  const autos = subtitleLanguages.filter((s) => s.startsWith("auto:")).map((s) => s.slice(5));
  const pick = (list: string[], prefix: string) => list.find((l) => l.toLowerCase().startsWith(prefix));
  return (
    (pick(manual, "fr") && { lang: pick(manual, "fr")!, auto: false }) ||
    (pick(autos, "fr") && { lang: pick(autos, "fr")!, auto: true }) ||
    (pick(manual, "en") && { lang: pick(manual, "en")!, auto: false }) ||
    (pick(autos, "en") && { lang: pick(autos, "en")!, auto: true }) ||
    null
  );
}

/** Piste audio par défaut (owner) : FR si le doublage existe, sinon la piste principale. Pur. */
export function defaultAudioLanguage(audioLanguages: string[]): string | undefined {
  if (audioLanguages.length <= 1) return undefined;
  return audioLanguages.some((l) => l.startsWith("fr")) ? "fr" : undefined;
}

// ── Choix en attente (vidéo/playlist, ou n° de piste audio) ────────────────
type PendingYtv =
  | { kind: "mode"; url: string; quality: string; audioToken?: string; ts: number }
  | { kind: "audio"; url: string; quality: string; tracks: string[]; ts: number };
const pendingYtvChoices = new Map<string, PendingYtv>();
// 9.11 (audit B3) : aligné sur la mémoire d'observation de l'agent (10 min) —
// entre 3 et 10 min l'agent croyait le choix encore en attente et exécutait
// `.ytv 1` comme une recherche du mot « 1 ».
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Tests uniquement. */
export function __resetYtvPendingForTests(): void {
  pendingYtvChoices.clear();
}

/** 9.12 (audit B5) : clé d'un choix en attente — (chat, auteur réel). Pur. */
export function ytvChoiceKey(chat: string, user?: string): string {
  const c = String(chat || "");
  return `${c}|${String(user || "").trim() || c}`;
}

/**
 * 9.12 (B5, décision owner) : « 1 »/« 2 »/« 12 »/« video »/« playlist » nu —
 * la réponse attendue à un écran de choix. Pur — utilisé par botEngine pour
 * router ces réponses directement vers .ytv SANS tour IA (éco tokens).
 */
export function bareYtvChoiceAnswer(text: string): string | null {
  const t = String(text || "").trim().toLowerCase();
  return /^(?:\d{1,2}|video|vid|playlist|pl)$/.test(t) ? t : null;
}

/** 9.12 (B5) : cet utilisateur a-t-il un choix frais en attente ? (sans consommer) */
export function hasPendingYtvChoice(chat: string, user?: string): boolean {
  const stored = pendingYtvChoices.get(ytvChoiceKey(chat, user));
  return !!stored && Date.now() - stored.ts <= PENDING_TTL_MS;
}

/** Tests uniquement : installe un choix en attente (âge contrôlable). */
export function __setPendingYtvChoiceForTests(
  chat: string,
  user: string | undefined,
  kind: "mode" | "audio",
  ageMs = 0
): void {
  const base = { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", quality: "720", ts: Date.now() - ageMs };
  pendingYtvChoices.set(
    ytvChoiceKey(chat, user),
    kind === "mode" ? { kind, ...base } : { kind, ...base, tracks: ["en", "fr"] }
  );
}

/** Résout un choix en attente ; purge l'entrée si la réponse est hors-sujet. */
function consumePendingYtvChoice(
  sender: string,
  args: string[]
): { url: string; quality: string; audioToken?: string; mode?: "video" | "playlist"; audioLang?: string } | null {
  const stored = pendingYtvChoices.get(sender);
  if (!stored) return null;
  if (Date.now() - stored.ts > PENDING_TTL_MS) {
    pendingYtvChoices.delete(sender);
    return null;
  }
  const a = (args[0] || "").toLowerCase();
  if (stored.kind === "mode") {
    if (a === "1" || a === "video" || a === "vid") {
      pendingYtvChoices.delete(sender);
      return { url: stored.url, quality: stored.quality, audioToken: stored.audioToken, mode: "video" };
    }
    if (a === "2" || a === "playlist" || a === "pl") {
      pendingYtvChoices.delete(sender);
      return { url: stored.url, quality: stored.quality, audioToken: stored.audioToken, mode: "playlist" };
    }
    pendingYtvChoices.delete(sender); // hors-sujet : choix abandonné
    return null;
  }
  const n = parseInt(a, 10);
  if (Number.isInteger(n) && stored.tracks[n - 1]) {
    pendingYtvChoices.delete(sender);
    return { url: stored.url, quality: stored.quality, audioLang: stored.tracks[n - 1] };
  }
  pendingYtvChoices.delete(sender);
  return null;
}

/** Télécharge une playlist YouTube (max 25) et livre la page HTML de liens. */
/**
 * 9.18gg — nom de fichier vidéo sûr (pur, testé) : caractères interdits
 * retirés PUIS bords non alphanumériques nettoyés — un titre japonais
 * (「逃避行 - Eve MV」) ne doit plus donner « -_Eve_MV.mp4 » ni « .mp4 »
 * (retour terrain 15/10). Fallback « video » si rien ne survit.
 */
export function safeVideoName(title: string, fallback = "video"): string {
  const base = String(title || "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 60)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base || fallback;
}

async function executePlaylistDownload(
  sock: any,
  msg: any,
  context: any,
  playlistUrl: string,
  quality: string,
  audioLang?: string
): Promise<void> {
  const chatId = msg.key.remoteJid;
  const probe = await probeYoutubeEntry(playlistUrl);
  if (!probe.ok || !probe.isPlaylist || probe.entryIds.length === 0) {
    return void (await context.reply(
      "❌ *Impossible de lire cette playlist* — vérifie le lien, ou télécharge la vidéo seule avec `.ytv <lien> video`."
    ));
  }
  const truncated = probe.entryIds.length > MAX_PLAYLIST_VIDEOS;
  const ids = probe.entryIds.slice(0, MAX_PLAYLIST_VIDEOS);
  const title = probe.playlistTitle || "Playlist YouTube";
  await context.reply(
    `📋 *Playlist « ${title} »* — ${ids.length} vidéos${truncated ? ` _(playlist de ${probe.playlistCount} — max ${MAX_PLAYLIST_VIDEOS})_` : ""}\n` +
    `⏳ Téléchargement en cours — je t'envoie une page de liens à la fin.`
  );

  // Job visible dans le dashboard (même machinerie que les batches animé).
  const batchJob = createBatchJob({
    animeTitle: title, season: "Playlist", resolution: `${quality}p`,
    language: audioLang ? audioLang.toUpperCase() : "—", totalEpisodes: ids.length
  });
  updateJobStatus(batchJob.id, "downloading", `Playlist : ${ids.length} vidéos`);

  const links: Array<{ label: string; url: string; sizeMB: number; expiresAt: number }> = [];
  const zipFiles: Array<{ filePath: string; n: number; title: string }> = [];
  const failed: number[] = [];
  let totalMB = 0;
  let stopped = "";

  for (let i = 0; i < ids.length; i++) {
    const n = i + 1;
    const url = `https://www.youtube.com/watch?v=${ids[i]}`;
    try {
      updateEpisodeProgress(batchJob.id, n, { status: "downloading", progressPercent: 30 });
      // 9.15 : déjà téléchargée ? Lien instantané sur le fichier existant.
      const rKey = ytvReuseKey(ids[i], quality, audioLang, null);
      const rHit = rKey ? lookupMediaReuse(rKey) : null;
      if (rHit) {
        try {
          const rec = registerTempDownload(rHit.filePath, rHit.filename, { noCopy: true, jobId: batchJob.id });
          links.push({ label: rHit.filename.replace(/\.mp4$/, ""), url: rec.downloadUrl, sizeMB: rec.sizeMB, expiresAt: rec.expiresAt });
          zipFiles.push({ filePath: rec.filePath, n, title: rHit.filename.replace(/\.mp4$/, "") });
          updateEpisodeProgress(batchJob.id, n, { status: "completed", progressPercent: 100, sizeMB: rec.sizeMB, downloadUrl: rec.downloadUrl });
          continue;
        } catch {} // quota de records → téléchargement normal
      }
      const local = await ytvViaYtDlp(url, quality, SLIM_SOURCE_CEILING, { audioLang });
      if (!local.ok) {
        failed.push(n);
        updateEpisodeProgress(batchJob.id, n, { status: "failed", progressPercent: 0, error: local.reason || "failed" });
        continue;
      }
      // 9.7 : amincissement même résolution au-dessus du seuil.
      try {
        if (fs.statSync(local.filePath).size > slimTriggerBytes()) await slimVideoIfNeeded(local.filePath);
      } catch {}
      const sizeBytes = fs.statSync(local.filePath).size;
      totalMB += sizeBytes / (1024 * 1024);
      const safeTitle = (local.title || `Vidéo ${n}`).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || `Vidéo ${n}`;
      // 9.15 : entrée au cache de réutilisation (lien physique).
      if (rKey) { try { storeMediaReuse(rKey, local.filePath, `${String(n).padStart(2, "0")} - ${safeTitle}.mp4`); } catch {} }
      const rec = registerTempDownload(local.filePath, `${String(n).padStart(2, "0")} - ${safeTitle}.mp4`, {
        moveFile: true,
        jobId: batchJob.id
      });
      links.push({ label: `${String(n).padStart(2, "0")} — ${local.title || `Vidéo ${n}`}`, url: rec.downloadUrl, sizeMB: rec.sizeMB, expiresAt: rec.expiresAt });
      zipFiles.push({ filePath: rec.filePath, n, title: local.title || `Vidéo ${n}` });
      updateEpisodeProgress(batchJob.id, n, { status: "completed", progressPercent: 100, sizeMB: rec.sizeMB, downloadUrl: rec.downloadUrl });
      try { fs.rmSync(path.dirname(local.filePath), { recursive: true, force: true }); } catch {}
      if (totalMB > MAX_PLAYLIST_TOTAL_MB) {
        stopped = `🛑 Garde-fou : ${MAX_PLAYLIST_TOTAL_MB} Mo cumulés atteints — les vidéos restantes ne sont pas téléchargées.`;
        break;
      }
    } catch (err: any) {
      failed.push(n);
      updateEpisodeProgress(batchJob.id, n, { status: "failed", progressPercent: 0, error: err?.message || "error" });
    }
  }

  if (links.length === 0) {
    updateJobStatus(batchJob.id, "failed", "Toutes les vidéos ont échoué");
    return void (await context.reply("❌ *Aucune vidéo de la playlist n'a pu être téléchargée* — réessaie dans un instant."));
  }

  // ZIP optionnel — même variable d'environnement que les saisons animé.
  let zipUrl: string | null = null;
  let zipFilename = "";
  let zipSizeMB = 0;
  if (process.env.NEBULA_BATCH_ZIP === "1" && zipFiles.length > 0) {
    try {
      const zipResult = await BatchZipManager.packageEpisodes({
        episodes: zipFiles.map((z) => ({ filePath: z.filePath, episodeNumber: z.n })),
        animeTitle: title, season: "Playlist", resolution: `${quality}p`,
        language: audioLang ? audioLang.toUpperCase() : "—",
        namingStyle: "simple", batchJobId: batchJob.id
      });
      if ((zipResult as any).success) {
        zipUrl = (zipResult as any).downloadUrl;
        zipFilename = (zipResult as any).zipFilename;
        zipSizeMB = (zipResult as any).sizeMB;
        completeBatchJob(batchJob.id, {
          zipDownloadUrl: zipUrl!, zipFilename, zipSizeMB,
          zipToken: (zipResult as any).token || "", expiresAt: (zipResult as any).expiresAt || 0
        });
      }
    } catch {}
  }
  if (!zipUrl) {
    updateJobStatus(batchJob.id, "completed", `Playlist prête : ${links.length}/${ids.length} vidéos`);
  }

  // Page HTML (comme les batches animé) — sauf si le ZIP est là.
  let pageDelivered = false;
  let pageMode: "link" | "document" = "link"; // 9.18ffff : lien hébergé (primaire) ou document (repli)
  if (links.length > 1 && !zipUrl) {
    try {
      const expiresAt = links.reduce((min, l) => (l.expiresAt && (!min || l.expiresAt < min) ? l.expiresAt : min), 0);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "playlist";
      const pageFilename = `nebula-${slug}-playlist.html`;
      const html = buildDownloadPage({
        title: `${title} — Playlist`,
        subtitle: `${quality}p${audioLang ? ` · audio ${langLabel(audioLang)}` : ""} · ${links.length} vidéos prêtes`,
        entries: links.map((l) => ({ label: l.label, url: l.url, sizeMB: l.sizeMB })),
        expiresAt
      });
      // 9.18ffff : page HÉBERGÉE (WhatsApp filtre désormais les documents
      // text/html) — le bot envoie le LIEN, Chrome rend la page en inline.
      const pageLink = registerDownloadPage(html, pageFilename, { jobId: batchJob.id });
      if (pageLink) {
        await sock.sendMessage(
          chatId,
          {
            text:
              `📄 *Page de téléchargement prête* — ${links.length} vidéos\n\n` +
              `🔗 ${pageLink}\n\n` +
              `👉 Ouvre ce lien dans Chrome : un seul bouton *« Tout télécharger »*, ou un bouton par vidéo.\n` +
              `⏳ Valable ${getLinkTtlMinutes()} min (relancée à chaque ouverture).`
          },
          { quoted: msg }
        );
        pageDelivered = true;
        pageMode = "link";
        console.log(`[YTVIDEO] Delivered playlist page as HOSTED LINK (${links.length} links, inline).`);
      } else {
        await sock.sendMessage(chatId, { document: Buffer.from(html, "utf-8"), mimetype: "text/html", fileName: pageFilename }, { quoted: msg });
        pageDelivered = true;
        pageMode = "document";
      }
    } catch {}
  }

  const failedNote = failed.length > 0 ? `\n⚠️ *Échecs :* vidéos ${failed.join(", ")}\n` : "";
  let responseMsg =
    `🚀 *PLAYLIST PRÊTE* 🚀\n\n` +
    `🎬 *${title}*\n` +
    `⚙️ *Qualité :* ${quality}p${audioLang ? ` · audio ${langLabel(audioLang)}` : ""}\n` +
    `📦 *Prêtes :* ${links.length}/${ids.length} vidéos\n${failedNote}${stopped ? stopped + "\n" : ""}` +
    `⏳ *Liens valides 30 min* (relancées à chaque téléchargement, max 2 h)\n\n` +
    (pageDelivered
      ? (pageMode === "link"
          ? `📄 *Page de téléchargement :* le lien ci-dessus s'ouvre dans Chrome → un bouton « Tout télécharger », ou un bouton par vidéo.`
          : `📄 *Ouvre le fichier HTML ci-dessus dans Chrome* → un bouton « Tout télécharger », ou un bouton par vidéo.`)
      : zipUrl
        ? `📦 *ZIP complet :* ${zipFilename} (~${zipSizeMB} Mo)\n🔗 ${zipUrl}`
        : links.map((l) => `• ${l.label} — ${l.sizeMB} Mo\n🔗 ${l.url}`).join("\n\n"));
  await context.reply(responseMsg);
}

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
  acceptsUrlArgs: true, // 9.3b — le guardrail agent préserve les URLs ici
  aliases: ["ytv", "ytmp4", "ytvid", "video"],
  category: "Media",
  description: "Vidéo YouTube : résolution, piste audio, sous-titres auto, playlists (max 25).",
  usage: ".ytv <nom ou lien> [360-1080] [vo] [playlist|video]",
  execute: async (sock, msg, context) => {
    let videoPath: string | null = null; // fichier local yt-dlp (8.86) — purgé en finally
    let reusedHit: { filePath: string; filename: string; bytes: number } | null = null; // 9.15 : cache hit (hors try — visible du finally)
    try {
      const chatId = msg.key.remoteJid;
      const args = context.args || [];
      // 9.10 : un choix est-il en attente ? (1/2 vidéo-playlist, n° de piste)
      // 9.12 (B5) : scopé par (chat, utilisateur) — en groupe, le choix de
      // chacun est le sien : plus d'écrasement entre membres.
      const resolved = consumePendingYtvChoice(ytvChoiceKey(context.sender, context.senderUser), args);
      if (!args[0] && !resolved) {
        return void (await context.reply(
          "🎬 *Usage:* `.ytv <nom ou lien YouTube> [résolution]`\n\nEx: `.ytv Ronaldo best goals 720`\nRésolutions : 360, 480, 720, 1080\n\nExtras : `.ytv <lien> vo` (piste audio au choix) · `.ytv <lien playlist>` (télécharge la playlist, max 25)"
        ));
      }
      // 9.12 (B5) : réponse à un écran de choix alors qu'aucun choix de CET
      // utilisateur n'est en attente (autre membre du groupe, TTL expiré…) —
      // honnête, au lieu de chercher « 1 » sur YouTube (symptôme B3).
      if (!resolved && args.length === 1 && bareYtvChoiceAnswer(args[0])) {
        return void (await context.reply(
          "❓ Aucun choix en attente pour toi — relance `.ytv <lien>` (un écran de choix expire au bout de 10 min)."
        ));
      }

      let quality = "720";
      let searchQuery = args.join(" ");
      let audioToken: string | undefined;
      let forceMode: "video" | "playlist" | undefined;
      let forcedAudioLang: string | undefined;
      if (resolved) {
        quality = resolved.quality;
        searchQuery = resolved.url;
        audioToken = resolved.audioToken;
        forceMode = resolved.mode;
        forcedAudioLang = resolved.audioLang;
      } else {
        // 9.3b : « 360p » accepté ; 9.10 : mots-clés vo/langue/playlist/video.
        const tokens = parseYtvArgs(args);
        quality = tokens.quality;
        searchQuery = tokens.searchQuery;
        audioToken = tokens.audioToken;
        forceMode = tokens.forceMode;
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

      // 9.10 : lien de PLAYLIST — choix vidéo seule / playlist entière (owner).
      if (isPlaylistLink(videoUrl) && forceMode !== "video") {
        const wantedAudio = forcedAudioLang ?? (audioToken && audioToken !== "vo" ? audioToken : undefined);
        if (forceMode === "playlist") {
          return await executePlaylistDownload(sock, msg, context, videoUrl, quality, wantedAudio);
        }
        const plProbe = await probeYoutubeEntry(videoUrl);
        if (plProbe.ok && plProbe.isPlaylist && plProbe.entryIds.length > 0) {
          pendingYtvChoices.set(ytvChoiceKey(context.sender, context.senderUser), { kind: "mode", url: videoUrl, quality, audioToken, ts: Date.now() });
          return void (await context.reply(
            `📋 *Lien de playlist détecté* — « ${plProbe.playlistTitle || "Playlist"} » (${plProbe.playlistCount} vidéos)\n\n` +
            `*1.* Cette vidéo seule\n*2.* La playlist entière (max ${MAX_PLAYLIST_VIDEOS} vidéos)\n\n` +
            `👉 Réponds avec : \`.ytv 1\` ou \`.ytv 2\``
          ));
        }
        // Sonde playlist échouée → on tente la vidéo seule (comportement d'avant).
      }

      // 9.10 : sonde — pistes audio (doublages) et sous-titres (FR auto, owner).
      // Échec de sonde → dégradation honnête : comportement d'avant 9.10.
      let audioLang = forcedAudioLang;
      let subs: { lang: string; auto: boolean } | null = null;
      try {
        const probe = await probeYoutubeEntry(videoUrl);
        if (probe.ok && !probe.isPlaylist) {
          subs = pickSubtitles(probe.subtitleLanguages);
          if (!audioLang) {
            if (audioToken === "vo" && probe.audioLanguages.length > 1) {
              pendingYtvChoices.set(ytvChoiceKey(context.sender, context.senderUser), { kind: "audio", url: videoUrl, quality, tracks: probe.audioLanguages, ts: Date.now() });
              const list = probe.audioLanguages.map((l, i) => `*${i + 1}.* ${langLabel(l)} (${l})`).join("\n");
              return void (await context.reply(
                `🎚️ *Plusieurs pistes audio disponibles :*\n\n${list}\n\n👉 Réponds avec : \`.ytv 1\``
              ));
            }
            audioLang = defaultAudioLanguage(probe.audioLanguages);
          }
        }
      } catch {}

      // 9.15 : déjà téléchargée (même vidéo, qualité, piste audio, sous-titres)
      // par n'importe qui dans les dernières 24 h ? Fichier local instantané,
      // on saute le téléchargement ET l'amincissement.
      const ytIdForReuse = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1] || "";
      const reuseKey = ytvReuseKey(ytIdForReuse, quality, audioLang, subs);
      reusedHit = reuseKey ? lookupMediaReuse(reuseKey) : null;
      if (reusedHit) {
        videoPath = reusedHit.filePath;
        console.log("[YTV] ⚡ Cache hit — fichier existant réutilisé (aucun téléchargement)");
      }

      const initialCaption = `*${videoTitle}*\n📺 Résolution : *${quality}p*\n\n${reusedHit ? "⚡ Déjà en cache — envoi immédiat…" : "⏳ Téléchargement en cours..."}`;
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
      if (!reusedHit) try {
        console.log(`[YTV] Trying yt-dlp (local, ${quality}p)...`);
        const local = await ytvViaYtDlp(videoUrl, quality, SLIM_SOURCE_CEILING, { audioLang, subs });
        if (local.ok) {
          videoPath = local.filePath;
          if (local.title) finalTitle = local.title;
          console.log("[YTV] OK via yt-dlp");
        } else if (local.reason === "too_large") {
          return void (await context.reply("⚠️ *Vidéo trop lourde* (max 100 Mo à cette qualité) — essaie une qualité inférieure ou une vidéo plus courte."));
        } else if (local.reason === "signin") {
          console.log(`[YTV] yt-dlp: session YouTube requise${local.detail ? ` — ${local.detail}` : ""}`);
          return void (await context.reply(activeCookiesFile()
            ? "🔐 *Session YouTube expirée* — l'owner doit renouveler le fichier cookies (README §YouTube / NEBULA_YTDLP_COOKIES)."
            : "🔐 *YouTube exige une session pour cette vidéo* — cookies non configurés (owner : README §YouTube / NEBULA_YTDLP_COOKIES)."));
        } else if (local.reason === "session_quota") {
          // 9.6 : budget global 50 téléchargements authentifiés/heure.
          return void (await context.reply("⏳ *Quota de session YouTube atteint* (50 téléchargements/heure, tous utilisateurs) — réessaie dans un instant."));
        } else {
          console.log(`[YTV] yt-dlp failed: ${local.reason}${local.detail ? ` — ${local.detail}` : ""}`);
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

      let mediaUrl = videoPath || downloadUrl;
      if (!mediaUrl) {
        return void (await context.reply("❌ Impossible de télécharger cette vidéo — toutes les sources ont échoué.\n🔄 Réessaie dans un instant."));
      }

      // 9.7→ccc : amincissement DOUX même résolution (CRF 22, plus de cible
      // forcée 92 Mo — décision owner 17/10 : jamais de « sable »). Si le
      // résultat dépasse encore le plafond d'envoi : refus honnête.
      if (videoPath && !reusedHit) {
        try {
          if (fs.statSync(videoPath).size > MAX_VIDEO_BYTES) {
            const heavyBytes = fs.statSync(videoPath).size;
            await context.reply(
              `🗜️ *Fichier lourd (${(heavyBytes / 1e6).toFixed(0)} Mo) — compression intelligente en cours (~${slimEtaMinutes(heavyBytes)} min), même résolution…*`
            );
            await slimVideoIfNeeded(videoPath, { triggerBytes: MAX_VIDEO_BYTES });
            if (fs.statSync(videoPath).size > MAX_VIDEO_BYTES) {
              return void (await context.reply("⚠️ *Vidéo trop lourde* (max 100 Mo à cette qualité) — essaie une qualité inférieure ou une vidéo plus courte."));
            }
          }
        } catch {}
      }

      // 9.15 : la vidéo entre au cache (lien physique, zéro octet de plus).
      if (videoPath && reuseKey) {
        try { storeMediaReuse(reuseKey, videoPath, `${safeVideoName(finalTitle)}.mp4`); } catch {}
      }

      const safeName = safeVideoName(finalTitle);
      // 9.18s : lien haut-débit sur la vidéo SEULE aussi (parité anime —
      // les playlists l'avaient déjà). Cache hit → noCopy (le fichier du
      // cache est servi tel quel) ; fichier frais → move vers le store.
      let singleLink = "";
      if (videoPath) {
        try {
          const rec = registerTempDownload(videoPath, `${safeName}.mp4`, reusedHit ? { noCopy: true } : { moveFile: true });
          if (rec?.filePath) {
            mediaUrl = rec.filePath;
            singleLink = rec.downloadUrl;
          }
        } catch {}
      }
      const linkNote = singleLink
        ? `\n\n🔗 *Lien :* ${singleLink}\n⏳ _Valable ${getLinkTtlMinutes()} min après chaque téléchargement (max 2 h)_`
        : "";
      await sock.sendMessage(chatId, {
        video: { url: mediaUrl },
        mimetype: "video/mp4",
        fileName: `${safeName}.mp4`,
        caption: `*${finalTitle || searchQuery}*\n📺 Qualité : ${quality}p` +
          (audioLang ? `\n🎚️ Audio : ${langLabel(audioLang)}` : "") +
          (subs ? `\n💬 Sous-titres ${subs.auto ? "automatiques " : ""}${subs.lang.split("-")[0].toUpperCase()} intégrés` : "") +
          (reusedHit ? `\n⚡ Servie depuis le cache — aucun re-téléchargement` : "") +
          linkNote +
          `\n\n> *_Downloaded by ${getConfig().botName}_*`
      }, { quoted: msg });
    } catch (error: any) {
      console.error("[YTV] Fatal:", error?.message || error);
      await context.reply("❌ Le téléchargement a échoué.\n🔄 Réessaie dans un instant.");
    } finally {
      // 8.86 : purge du fichier local yt-dlp (répertoire temporaire dédié).
      // 9.15 : sur cache hit, videoPath pointe dans le dossier du cache —
      // le rmSync du staging ne doit JAMAIS le toucher.
      if (videoPath && !reusedHit) {
        try { fs.rmSync(path.dirname(videoPath), { recursive: true, force: true }); } catch {}
      }
    }
  }
};

export default ytvideoCommand;
