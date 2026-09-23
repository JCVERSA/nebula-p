import { BotCommand, BotCommandContext } from "../types.js";
import { addSubscription, removeSubscriptions, listSubscriptions, WATCH_MAX_PER_CHAT } from "../services/episodeWatchService.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { resolvedFfmpegPath } from "../ffmpeg.js";
import { registerTempDownload } from "../tempDownloadManager.js";
import { buildDownloadPage } from "../services/downloadPage.js";
import { formatFailedEpisodes } from "../services/batchRecap.js";
import { animeProxyOptions } from "../services/scrapingProxy.js";
import { isNakanimeUrl, nakanimeSeasons, nakanimeEpisodePlayers, nakanimeEpisodePlayersDetailed } from "../services/nakanimeClient.js"; // 8.69: dormant mirror — parse helpers only, never searched
import {
  searchAnimeBySource,
  applyLanguagePolicy,
  samaSubPathLanguage,
  languagesOf,
  DEFAULT_ANIME_SOURCE,
  otherFlagOf,
  searchEmptyMessage,
  vaDisabledMessage,
  VA_DISABLED_CODE,
  sourceLogLabel,
  type AnimeSourceId,
  type SeasonLanguage,
  type LanguagePolicyResult
} from "../services/animeSources.js";
import {
  voiranimeEpisodes,
  voiranimeEpisodePlayer,
  resolveVoiranimeSeason,
  type VoiranimeEpisode
} from "../services/voiranimeClient.js";
import { bestAnimeMatch, formatAnimeCard } from "../services/jikanClient.js";
import { isSafeDownloadUrl } from "../urlSafety.js";
import { createBatchJob, updateEpisodeProgress, updateJobStatus } from "../batchDownloadManager.js";
import { acquireDiskClaim } from "../diskClaims.js";
import { BatchZipManager } from "../services/batchZipManager.js";
import { downloadHlsAppLevel, resolveVidmolyUrlset, isDeadFileSlug, markDeadFileSlug } from "../services/hlsDownloader.js";
import { probeVideoInfo, whatsappFitVideoOptions } from "../services/mediaToolkit.js";
import { enforceMemoryHeadroom } from "../services/memoryGuard.js";
import {
  resolveBestMirrorStream,
  executeDirectOrFfmpegDownload,
  prepareLocalHlsPlaylist,
  resolveAbsoluteUrl,
  robustFetchText,
  downloadWithAllMirrorsFallback,
  fetchHlsTracksAndSizes,
  resolveCanonicalQualityTrack,
  StreamQualityTrack
} from "../services/animeStreamExtractor.js";
import {
  parseQuickDownloadParams,
  isExactAnimeMatch,
  resolveRequestedSeason,
  resolveRequestedEpisodes,
  canonicalResolutionForChoice,
  QuickDownloadParams
} from "../utils/quickAnimeParser.js";

interface HlsVariant {
  label: string;
  resolution: string;
  bandwidth: number;
  estimatedSizeMB: number;
  url: string;
  isDirectWhatsAppFit: boolean;
  headers?: Record<string, string>;
}

export interface AnimeSession {
  step: "select_anime" | "language" | "season" | "episode" | "resolution" | "single_stream_choice";
  /** Chosen catalog (refonte 8.69): "as" (default) or "va" — mono-source flow. */
  source: AnimeSourceId;
  searchResults?: Array<{ title: string; subtitle: string; url: string; language?: SeasonLanguage; slug?: string }>;
  animeTitle: string;
  animeUrl: string;
  languages: string[];
  selectedLanguage?: string;
  /** ALL seasons of the chosen catalog with their STRUCTURAL language —
   * `.a vf` / `.a vostfr` re-filter this list without any network call. */
  sourceSeasons?: Array<{ name: string; subPath: string; url: string; isVoiranime?: boolean; language?: SeasonLanguage }>;
  seasons: Array<{ name: string; subPath: string; url: string; isVoiranime?: boolean }>;
  selectedSeason?: { name: string; subPath: string; url: string; isVoiranime?: boolean };
  episodes?: Record<number, string[]>;
  episodeListLabels?: Record<number, { host: string; language: string }>; // nakanime: host+lang per list
  voiranimeAnimeUrl?: string; // voir-anime.to VF path (audit 8.9)
  voiranimeEpisodes?: VoiranimeEpisode[]; // positional episode list of the VF entry
  selectedEpisodeIndex?: number;
  selectedEpisodeIndices?: number[]; // Multi-episode batch support
  isSeasonZipDownload?: boolean; // Full season download mode
  availableVariants?: HlsVariant[];
  selectedVariantUrl?: string;
  selectedVariantHeaders?: Record<string, string>;
  languageForcedByUser?: boolean; // true after an explicit .a vf / .a vostfr
  userSearchQuery?: string; // 8.55: raw user query — voir-anime indexes romaji,
  // nakanime returns French titles; the VF probe needs BOTH as candidates.
  singleStreamDetected?: {
    label: string;
    resolution: string;
    estimatedSizeMB: number;
    streamUrl: string;
    sourceUrl: string;
    originUrl: string;
  };
  forceCompress?: boolean;
  pipelineStartedAt?: number; // quick-flow total latency diagnostics
  pendingQuickParams?: QuickDownloadParams;
  timer: any;
}

// Global active sessions map for the multi-step flow
const sessions = new Map<string, AnimeSession>();
const MAX_ACTIVE_SESSIONS = 500;

const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes (8.70: 5 cut users mid-flow)

// Resource ceilings for batch work triggered by untrusted WhatsApp users.
const MAX_BATCH_EPISODES = Math.max(1, Number(process.env.NEBULA_NOVABOX_MAX_EPISODES || 12));
const MAX_BATCH_TOTAL_MB = Math.max(1, Number(process.env.NEBULA_NOVABOX_MAX_BATCH_MB || 2048));

function clearUserSession(sender: string) {
  const session = sessions.get(sender);
  if (session) {
    clearTimeout(session.timer);
    sessions.delete(sender);
  }
}

function setUserSession(sender: string, session: AnimeSession) {
  if (sessions.size >= MAX_ACTIVE_SESSIONS && !sessions.has(sender)) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey) clearUserSession(oldestKey);
  }
  sessions.set(sender, session);
}

/** Display label for a player mirror URL (e.g. "ansembed.net"). */
function playerSourceLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Lecteur";
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\[\]]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Rejects non-public fetch destinations before any server-side request. */
async function isPublicFetchTarget(rawUrl: string, label: string): Promise<boolean> {
  try {
    if (await isSafeDownloadUrl(rawUrl)) return true;
  } catch {}
  console.warn(`[NOVABOX] Blocked unsafe ${label}: ${rawUrl}`);
  return false;
}

// Search Anime Catalog (audit 8.53: nakanime FIRST — it works from the VPS
// (no Cloudflare wall); anime-sama is demoted to LAST resort because it is
// chronically 403 from the host IP range, see ANIME_DOWNLOAD_AUDIT.md R3).
// voiranime is not a search source — results feed parseSeasons (catalog
// pages); voiranime is probed FIRST at selection time as the VF-by-default
// source (audit 8.53), with nakanime's VF lists as its fallback.
// Exported for scripts/anime-repro.ts (one-shot pipeline replay used to debug
// `.a` failures on the live host — see scripts/anime-repro.ts header).
/**
 * 8.69 (refonte sources choisies): mono-source search router. The catalog is
 * chosen by the user (`as` flag, default / `va` flag) — there is NO fallback:
 * an empty result IS the answer, the caller shows the other-flag hint.
 */
export async function searchAnime(query: string, source: AnimeSourceId = "as") {
  const results = await searchAnimeBySource(query, source);
  console.log(`[NOVABOX] ${sourceLogLabel(source)} search: ${results.length} result(s) for "${query}"`);
  return results;
}

// Parse main anime page for seasons (panneauAnime calls; nakanime mirror
// uses its own season index). Exported for scripts/anime-repro.ts.
export async function parseSeasons(animeUrl: string) {
  if (isNakanimeUrl(animeUrl)) {
    return nakanimeSeasons(animeUrl);
  }
  if (!(await isPublicFetchTarget(animeUrl, "season page"))) return [];
  const res = await axios.get(animeUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 8000,
    ...animeProxyOptions()
  });

  const html = res.data;
  const seasons: Array<{ name: string; subPath: string; url: string }> = [];

  // Match panneauAnime("Saison 1", "saison1/vostfr");
  const regex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    const subPath = match[2]; // e.g. "saison1/vostfr"
    if (name.toLowerCase() === "nom" || subPath.toLowerCase() === "url") {
      continue;
    }
    const baseUrl = animeUrl.endsWith("/") ? animeUrl : animeUrl + "/";
    seasons.push({
      name,
      subPath,
      url: baseUrl + subPath + "/"
    });
  }

  return seasons;
}

// 8.69: checkVfExists (HEAD /vostfr/→/vf/ URL guessing) is GONE — language
// truth is now structural: panneauAnime sub-paths ("saison1/vf") and va
// slugs ("-vf") carry it, classified by samaSubPathLanguage/voiranimeSlugLanguage.

// Parse episodes.js file (nakanime mirror resolves players via its API).
// Exported for scripts/anime-repro.ts.
export async function parseEpisodes(jsUrl: string) {
  if (isNakanimeUrl(jsUrl)) {
    return nakanimeEpisodePlayers(jsUrl.replace(/episodes\.js$/, "").replace(/\/$/, ""));
  }
  if (!(await isPublicFetchTarget(jsUrl, "episode list"))) return {};
  const res = await axios.get(jsUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 8000,
    ...animeProxyOptions()
  });

  const jsContent = res.data;
  const regex = /(?:var|\/\/var|\/\/\/var)\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;
  let match;
  const episodeLists: Record<number, string[]> = {};

  while ((match = regex.exec(jsContent)) !== null) {
    const listId = parseInt(match[1]);
    const arrayStr = match[2];

    const urlRegex = /'([^']+)'|"([^"]+)"/g;
    let urlMatch;
    const urls: string[] = [];
    while ((urlMatch = urlRegex.exec(arrayStr)) !== null) {
      urls.push(urlMatch[1] || urlMatch[2]);
    }
    if (urls.length > 0) {
      episodeLists[listId] = urls;
    }
  }

  return episodeLists;
}

/**
 * Episode lists + per-list language labels (nakanime only; anime-sama lists
 * carry no language — the season URL already encodes it).
 */
export async function parseEpisodesDetailed(
  jsUrl: string
): Promise<{ lists: Record<number, string[]>; labels: Record<number, { host: string; language: string }> }> {
  if (isNakanimeUrl(jsUrl)) {
    return nakanimeEpisodePlayersDetailed(
      jsUrl
        .replace(/episodes\.js$/, "")
        .replace(/\/$/, "")
    );
  }
  const lists = await parseEpisodes(jsUrl);
  return { lists, labels: {} };
}

/** True when a nakanime player-list language label means French dub. */
export function isNakanimeVfLabel(language: string): boolean {
  const l = (language || "").toUpperCase().replace(/\s+/g, "");
  return l.includes("VF") && !l.includes("VOSTFR") && !l.includes("VOST");
}

/**
 * Splits an episode's mirror URLs into language tiers: `primary` matches the
 * requested language (VF-by-default policy), `secondary` holds the rest as
 * download fallback. Lists without labels (anime-sama) all go to primary.
 */
export function splitMirrorsByLanguage(
  episodes: Record<number, string[]> | undefined,
  labels: Record<number, { host: string; language: string }> | undefined,
  epIndex: number,
  language: string
): { primary: string[]; secondary: string[] } {
  const primary: string[] = [];
  const secondary: string[] = [];
  const wantVf = (language || "").toUpperCase() === "VF";
  const hasLabels = !!labels && Object.keys(labels).length > 0;

  for (const listId of Object.keys(episodes || {}).map(Number).sort((a, b) => a - b)) {
    const url = episodes?.[listId]?.[epIndex];
    if (!url) continue;
    const listIsVf = hasLabels ? isNakanimeVfLabel(labels![listId]?.language || "") : false;
    const bucket = listIsVf === wantVf || !hasLabels ? primary : secondary;
    if (!bucket.includes(url)) bucket.push(url);
  }

  if (primary.length === 0) return { primary: secondary, secondary: [] };
  return { primary, secondary };
}

/**
 * voiranime path: fetches each requested episode page and merges its player
 * embed URL (voembed.net & friends) into session.episodes as list 1, labelled
 * with the wired season's ACTUAL language (8.78: was hardcoded VF).
 */
/**
 * Episode watcher actions (audit S4): `.a watch` subscribes the current chat
 * to the selected voiranime VF season, `.a unwatch [titre]` stops a watch,
 * `.a watchlist` lists active watches for this chat.
 */
async function handleWatchAction(context: BotCommandContext, session: AnimeSession, msg: any): Promise<any> {
  const args = context.args || [];
  const action = (args[0] || "").toLowerCase();
  const chatJid = msg.key.remoteJid!;

  if (action === "watch") {
    if (!session.voiranimeAnimeUrl) {
      return context.reply(
        "❌ La veille n'est disponible que sur les saisons *VF* pour l'instant.\n" +
        "_(Les saisons VOSTFR ne sont pas encore surveillables.)_"
      );
    }
    const totalEps = Math.max(0, ...Object.values(session.episodes || {}).map(arr => arr.length));
    const result = addSubscription({
      chatJid,
      title: session.animeTitle,
      seasonUrl: session.voiranimeAnimeUrl,
      lang: session.selectedLanguage || "VF",
      lastSeenEp: totalEps
    });
    if (!result.ok) return context.reply(`❌ ${result.error}`);
    const cadence = process.env.NEBULA_WATCH_CRON ? "selon la configuration du serveur" : "toutes les ~6 heures";
    return context.reply(
      (result.updated ? "🔄 *Veille mise à jour !*\n" : "🔔 *Veille activée !*\n") +
      `🎬 *${session.animeTitle}* (${session.selectedLanguage || "VF"})\n` +
      `📦 Dernier épisode connu : ${totalEps}\n` +
      `⏰ Vérification ${cadence} (nuit silencieuse 23h–7h)\n\n` +
      "_Tu seras prévenu ici dès qu'un nouvel épisode sort, avec la commande de téléchargement prête._\n" +
      `_Arrêter : \`.a unwatch ${session.animeTitle}\` · Liste : \`.a watchlist\`_`
    );
  }

  if (action === "unwatch") {
    const query = args.slice(1).join(" ").trim();
    const subs = listSubscriptions(chatJid);
    if (subs.length === 0) return context.reply("ℹ️ Aucune veille active dans cette discussion.");
    if (!query) {
      return context.reply(
        "❌ Précise quelle veille arrêter :\n" +
        subs.map(s => `• \`.a unwatch ${s.title}\` _(dernier ép. connu : ${s.lastSeenEp})_`).join("\n")
      );
    }
    const removed = removeSubscriptions(chatJid, query);
    return removed > 0
      ? context.reply(`🗑️ ${removed} veille(s) supprimée(s) pour *"${query}"*.`)
      : context.reply(`ℹ️ Aucune veille ne correspond à *"${query}"*.\n${subs.map(s => `• ${s.title}`).join("\n")}`);
  }

  const subs = listSubscriptions(chatJid);
  if (subs.length === 0) {
    return context.reply(
      "ℹ️ Aucune veille active.\n_Pour en créer une : `.a <titre>` → saison → `.a watch`._"
    );
  }
  return context.reply(
    "🔔 *Veilles actives dans cette discussion :*\n\n" +
    subs.map(s => `• 🎬 *${s.title}* (${s.lang}) — dernier ép. connu : ${s.lastSeenEp}${s.consecutiveErrors > 3 ? ` ⚠️ ${s.consecutiveErrors} erreurs` : ""}`).join("\n") +
    `\n\n_Max ${WATCH_MAX_PER_CHAT} par discussion · Arrêt : \`.a unwatch <titre>\`_`
  );
}

export async function fillVoiranimePlayers(session: AnimeSession, indices: number[]): Promise<void> {
  if (!session.voiranimeEpisodes || !session.voiranimeAnimeUrl) return;
  const lists: Record<number, string[]> = session.episodes || { 1: new Array(session.voiranimeEpisodes.length).fill("") };
  const labels = session.episodeListLabels || {};
  let host = "voembed";
  try {
    for (const idx of indices) {
      const ep = session.voiranimeEpisodes[idx];
      if (!ep) continue;
      const player = await voiranimeEpisodePlayer(ep.url);
      if (player) {
        lists[1][idx] = player;
        try {
          host = new URL(player).hostname;
        } catch {}
      }
    }
  } catch {}
  if ((lists[1] || []).some(Boolean)) {
    // 8.78 (bug isVf) : le label VF "par construction" (audit 8.9, epoque ou
    // seul le VF va existait dans le pipeline) mentait pour une saison
    // VOSTFR — splitMirrorsByLanguage jettait alors le seul vrai miroir va
    // en secondaire. La saison cablee porte sa langue REELLE (policy 8.69).
    labels[1] = { host, language: session.selectedLanguage || "VF" };
  }
  session.episodes = lists;
  session.episodeListLabels = labels;
}

/**
 * Audit 8.17 — language hint shown on the interactive season screen. Must
 * always offer the OPPOSITE of the active default (the old screen displayed
 * "switch to VOSTFR" while VOSTFR was already the default) or honestly state
 * that VF does not exist for the title.
 */
export function seasonScreenLanguageHint(defaultLang: string, vfAvailable: boolean): string {
  if (defaultLang.toUpperCase() === "VF") {
    return `\n_💡 (Pour passer en VOSTFR, tape \`.a vostfr\`)_`;
  }
  return vfAvailable
    ? `\n_💡 (Pour passer en VF, tape \`.a vf\`)_`
    : `\n_ℹ️ (VF non disponible pour cet anime — VOSTFR par défaut)_`;
}

/**
 * Audit 8.17 — VF BY DEFAULT in the INTERACTIVE flow too. The season screen
 * used to decide the language from nakanime alone (and checkVfExists is
 * structurally false for nakanime URLs), so every nakanime-sourced title
 * showed "VOSTFR (Default)" even when voir-anime.to carries a real VF entry.
 * This helper probes voiranime and wires the session to its VF seasons,
 * mirroring the quick pipeline (audit 8.10). Keeps session.animeUrl pointing
 * at the nakanime page so `.a vostfr` can rebuild the VOSTFR season list.
 *
 * Audit 8.54 — two production fixes: (1) voir-anime.to lists its entries in
 * SEARCH-RELEVANCE order, which once showed "Hana-Kimi 2" as s1 of
 * "Hana-Kimi" — seasons are now sorted by their real trailing number
 * (unnumbered title = season 1 first, then 2, 3, …). (2) The probe retries
 * once: a transient Cloudflare challenge on the first hit must not silently
 * demote the whole session to VOSTFR when the VF entry exists.
 */
export function sortVfEntriesBySeason<T extends { title: string; slug?: string }>(entries: T[]): T[] {
  const seasonOf = (e: T): number => {
    const hay = `${e.title} ${e.slug || ""}`.toLowerCase();
    const m = hay.match(/(?:s|saison|season)[ .-]?(\d{1,2})(?!\d)/) || hay.match(/(?:^|[^0-9])(\d{1,2})(?![0-9])/);
    return m ? Number(m[1]) : 1; // unnumbered entry = the show's season 1
  };
  return [...entries].sort((a, b) => seasonOf(a) - seasonOf(b));
}

// 8.69: foldTitleDiacritics moved to services/animeSources.ts — re-exported
// here for backward compatibility (tests + scripts import it from novabox).
export { foldTitleDiacritics } from "../services/animeSources.js";

type PolicySeason = NonNullable<AnimeSession["sourceSeasons"]>[number];

/** Applies the language policy to the session's stored sourceSeasons and
 * updates seasons/languages/selectedLanguage — no network call (used by
 * `.a vf` / `.a vostfr` and after fresh wiring). */
function applyPolicyToSession(
  session: AnimeSession,
  wantLang: "VF" | "VOSTFR"
): LanguagePolicyResult<PolicySeason> {
  const result = applyLanguagePolicy(session.sourceSeasons || [], wantLang, session.source);
  if (result.status === "ok") {
    session.seasons = result.seasons;
    session.languages = languagesOf(session.sourceSeasons || []);
    session.selectedLanguage = result.language;
  }
  return result;
}

/**
 * 8.69 (refonte sources choisies): wires the session's seasons from the
 * CHOSEN catalog, with STRUCTURAL languages (no oracle, no URL guessing).
 * - "as": parseSeasons(catalog page) → seasons classified by sub-path
 *   language ("saison1/vf" vs "saison1/vostfr"). parseSeasons is NEVER
 *   called on a va URL (invariant 8.55, preserved by construction).
 * - "va": the search results ARE the catalog entries — seasons are wired
 *   from them directly (isVoiranime: true, one entry per season).
 * ALL seasons (both languages) land in session.sourceSeasons so the
 * `.a vf` / `.a vostfr` switch re-filters locally, without refetching.
 */
export async function wireSessionSeasons(
  session: AnimeSession,
  chosen: { title: string; url: string },
  wantLang: "VF" | "VOSTFR"
): Promise<LanguagePolicyResult<PolicySeason>> {
  if (session.source === "va") {
    const entries = session.searchResults || [];
    session.sourceSeasons = entries.map((e, i) => ({
      name: e.title,
      subPath: e.slug || `${i}`,
      url: e.url,
      isVoiranime: true,
      language: e.language ?? null
    }));
    session.animeUrl = chosen.url;
  } else {
    const parsed = await parseSeasons(chosen.url);
    session.sourceSeasons = parsed.map((s) => ({ ...s, language: samaSubPathLanguage(s.subPath) }));
  }
  const result = applyPolicyToSession(session, wantLang);
  if (result.status === "ok") {
    console.log(
      `[NOVABOX] ${sourceLogLabel(session.source)} wiring: ${result.seasons.length} season(s) in ${result.language}` +
        `${result.header ? " (langue demandée absente — autre langue listée)" : ""}`
    );
  }
  return result;
}

async function executeQuickDownloadPipeline(
  sock: any,
  msg: any,
  context: BotCommandContext,
  session: AnimeSession,
  chosenAnime: { title: string; subtitle?: string; url: string },
  quickParams: QuickDownloadParams
) {
  session.animeTitle = chosenAnime.title;
  session.animeUrl = chosenAnime.url;
  
  await context.react("⏳");
  const seasonStr = quickParams.seasonNumber ? `Saison ${quickParams.seasonNumber}` : "Saison 1";
  const epDesc = quickParams.episodesSpec || (quickParams.episodesMode === "all" ? "Tous les épisodes" : "Épisode 1");
  await context.reply(`✨ *Sélectionné:* *${chosenAnime.title}*\n⚡ *Traitement rapide:* ${seasonStr} | ${epDesc}...`);

  try {
    // 1+2+3. Wire the CHOSEN catalog (8.69 refonte): one catalog per query,
    // structural languages, policy applied, then target season resolution —
    // all on that catalog. No cross-source fallback (owner decision).
    const wantLang: "VF" | "VOSTFR" =
      quickParams.language || (process.env.NEBULA_VF_DEFAULT !== "0" ? "VF" : "VOSTFR");
    let effectiveWant = wantLang;
    if (session.source === "va" && !quickParams.language) {
      // The user picked a labeled entry from the results list (e.g. a VOSTFR
      // one) — honor that explicit choice over the VF default.
      const chosenEntry = (session.searchResults || []).find((r) => r.url === chosenAnime.url);
      if (chosenEntry?.language === "VF" || chosenEntry?.language === "VOSTFR") {
        effectiveWant = chosenEntry.language;
      }
    }
    const wired = await wireSessionSeasons(session, chosenAnime, effectiveWant);
    if (wired.status === "missing") {
      clearUserSession(context.sender);
      return context.reply(wired.message);
    }
    if (wired.header) {
      await context.reply(
        `${wired.header}\n${wired.guideHint ? wired.guideHint + "\n" : ""}_→ Je continue en *${wired.language}*._`
      );
    }

    const targetSeasonNum = quickParams.seasonNumber !== undefined ? quickParams.seasonNumber : 1;
    let targetSeason: AnimeSession["seasons"][number] | undefined;
    if (session.source === "va") {
      const asEntries = wired.seasons.map((s) => ({ title: s.name, slug: s.subPath, url: s.url, isVf: s.language === "VF" }));
      const picked = resolveVoiranimeSeason(asEntries, targetSeasonNum);
      targetSeason = picked ? wired.seasons.find((s) => s.url === picked.url) : undefined;
    } else {
      targetSeason = resolveRequestedSeason(wired.seasons, targetSeasonNum).season ?? undefined;
    }

    if (!targetSeason) {
      clearUserSession(context.sender);
      return context.reply(
        `❌ *Saison S${targetSeasonNum} introuvable:* Seulement ${wired.seasons.length} saison(s) disponible(s) pour *${chosenAnime.title}*.`
      );
    }

    session.selectedSeason = targetSeason;

    // 4. Fetch episodes for the target season (8.69: va = positional episode
    // list of the chosen entry; as = episodes.js of the season page).
    const tPlayers = Date.now();
    session.pipelineStartedAt = session.pipelineStartedAt || tPlayers;
    let totalEpisodes = 0;
    if (targetSeason.isVoiranime) {
      const vaEps = (await voiranimeEpisodes(targetSeason.url)).filter((e) => e.n > 0);
      if (vaEps.length === 0) {
        clearUserSession(context.sender);
        return context.reply("❌ *Erreur:* Aucun épisode numéroté trouvé pour cette saison.");
      }
      session.voiranimeAnimeUrl = targetSeason.url;
      session.voiranimeEpisodes = vaEps;
      session.episodes = { 1: new Array(vaEps.length).fill("") };
      session.episodeListLabels = {};
      totalEpisodes = vaEps.length;
      console.log(`[NOVABOX] voir-anime season: ${totalEpisodes} episode(s) (players resolved per request)`);
    } else {

    const jsUrl = targetSeason.url + "episodes.js";
    const { lists: eps, labels: epLabels } = await parseEpisodesDetailed(jsUrl);
    if (!eps || Object.keys(eps).length === 0) {
      clearUserSession(context.sender);
      return context.reply("❌ *Erreur:* Aucun épisode disponible pour cette saison.");
    }

    session.episodes = eps;
    session.episodeListLabels = epLabels;

    // nakanime: register VF as an AVAILABLE language when player lists carry a
    // VF label, but do NOT auto-select it — nakanime's language metadata is
    // unreliable (a vidmoly list labelled VF actually served VOSTFR, audit
    // 8.6). VF stays one keystroke away: `.a <q> sN epN vf rN`.
    if (isNakanimeUrl(chosenAnime.url)) {
      const hasVfLabels = Object.values(epLabels).some((l) => isNakanimeVfLabel(l.language));
      if (hasVfLabels && !session.languages.includes("VF")) {
        session.languages.push("VF");
      }
    }

    totalEpisodes = Math.max(...Object.values(eps).map(arr => arr.length));
    console.log(`[NOVABOX] Players fetched: ${Object.keys(eps).length} list(s), ${totalEpisodes} eps in ${((Date.now() - tPlayers) / 1000).toFixed(1)}s`);
    }

    if (totalEpisodes <= 0) {
      clearUserSession(context.sender);
      return context.reply("❌ *Erreur:* Le lecteur d'épisodes est vide pour cette saison.");
    }

    // 5. Resolve requested episode indices
    const resolvedIndices = resolveRequestedEpisodes(totalEpisodes, quickParams);
    if (resolvedIndices.length === 0) {
      clearUserSession(context.sender);
      return context.reply(`❌ *Épisode(s) invalide(s):* Veuillez choisir entre 1 et ${totalEpisodes}.`);
    }

    session.selectedEpisodeIndices = resolvedIndices;
    session.selectedEpisodeIndex = resolvedIndices[0];
    if (quickParams.episodesMode === "all" || resolvedIndices.length === totalEpisodes) {
      session.isSeasonZipDownload = true;
    }

    const isMulti = resolvedIndices.length > 1;
    const episodeSummary = isMulti
      ? `${resolvedIndices.length} épisodes (Ép ${resolvedIndices[0] + 1} à Ép ${resolvedIndices[resolvedIndices.length - 1] + 1})`
      : `Épisode ${resolvedIndices[0] + 1}`;

    // 5a. voiranime: resolve the player embed (voembed.net) LAZILY for the
    // requested episodes only (one episode-page fetch per episode).
    if (session.voiranimeAnimeUrl && session.voiranimeEpisodes) {
      const tVa = Date.now();
      const idxs = resolvedIndices.slice(0, MAX_BATCH_EPISODES);
      if (resolvedIndices.length > idxs.length) {
        console.warn(`[NOVABOX] voiranime: capping player lookups to ${idxs.length}/${resolvedIndices.length} episodes`);
      }
      await fillVoiranimePlayers(session, idxs);
      console.log(`[NOVABOX] voiranime players resolved for ${idxs.length} ep(s) in ${((Date.now() - tVa) / 1000).toFixed(1)}s`);
      const anyMirror = Object.values(session.episodes || {}).some((arr) => arr.some(Boolean));
      if (!anyMirror) {
        clearUserSession(context.sender);
        return context.reply(
          `❌ *Lecteur introuvable:* impossible de résoudre le lecteur de cette saison depuis le serveur.

` +
            `💡 *Essaie l'autre catalogue :* \`.a ${otherFlagOf(session.source)} <titre> s${targetSeasonNum} ep${resolvedIndices[0] + 1} r2\``
        );
      }
    }

    // 6. Resolution choice provided -> canonical quality + vidmoly-first
    // early-exit resolution (the FIRST mirror with usable tracks decides:
    // exact canonical quality, else the nearest one — audit 8.5).
    if (quickParams.resolutionChoice) {
      const canonical = canonicalResolutionForChoice(quickParams.resolutionChoice);
      const { primary, secondary } = splitMirrorsByLanguage(
        session.episodes || {},
        session.episodeListLabels,
        resolvedIndices[0],
        session.selectedLanguage || "VOSTFR"
      );
      const orderedMirrors = [...primary, ...secondary.filter((u) => !primary.includes(u))];

      const tScan = Date.now();
      const match = await resolveCanonicalQualityTrack(orderedMirrors, canonical);

      let finalRes = canonical;
      if (match) {
        session.selectedVariantUrl = match.url;
        session.selectedVariantHeaders = match.headers;
        finalRes = match.label;
        console.log(
          `[NOVABOX] Quick quality "${canonical}" -> ${match.exact ? "exact" : "nearest"} ${match.label} via ${match.mirror} (scan ${((Date.now() - tScan) / 1000).toFixed(1)}s)`
        );
      } else {
        console.log(`[NOVABOX] Quick quality "${canonical}": no mirror yielded tracks (scan ${((Date.now() - tScan) / 1000).toFixed(1)}s) — adaptive download`);
      }
      if (finalRes === "480P" || finalRes === "360P") {
        session.forceCompress = true; // keep the file WhatsApp-fit on fast lanes
      }
      session.pipelineStartedAt = session.pipelineStartedAt || Date.now();

      await context.react("🚀");
      return await sendFinalEpisode(sock, msg, context, session, finalRes);
    } else {
      // Prompt user for resolution
      session.step = "resolution";

      let detectedTracks: StreamQualityTrack[] = [];
      let hostName = "VidMoly";
      let bestMirrorStream: any = null;

      try {
        const mirrorUrls: string[] = [];
        for (const listId of Object.keys(session.episodes || {}).map(Number)) {
          const url = session.episodes?.[listId]?.[resolvedIndices[0]];
          if (url && !mirrorUrls.includes(url)) {
            mirrorUrls.push(url);
          }
        }
        if (mirrorUrls.length > 0) {
          bestMirrorStream = await resolveBestMirrorStream(mirrorUrls);
          if (bestMirrorStream.availableTracks && bestMirrorStream.availableTracks.length > 0) {
            detectedTracks = bestMirrorStream.availableTracks;
          }
          if (bestMirrorStream.hostName) hostName = bestMirrorStream.hostName;
        }
      } catch {}

      if (detectedTracks.length === 0) {
        const resolved = await resolveEpisodeStream(session.episodes || {}, resolvedIndices[0]);
        if (resolved.hlsUrl) {
          const legacyVariants = await inspectHlsStreams(resolved.hlsUrl, resolved.refererUrl, resolved.originUrl);
          detectedTracks = legacyVariants.map(v => ({
            resolution: v.label,
            url: v.url,
            bandwidth: v.bandwidth,
            fileSizeBytes: v.estimatedSizeMB * 1024 * 1024,
            type: 'hls' as const
          }));
        }
      }

      if (detectedTracks.length > 0) {
        detectedTracks.sort((a, b) => {
          const order: Record<string, number> = { '480P': 1, '360P': 2, '720P': 3, '1080P': 4 };
          const rankA = order[a.resolution.toUpperCase()] || 5;
          const rankB = order[b.resolution.toUpperCase()] || 5;
          return rankA - rankB;
        });

        session.availableVariants = detectedTracks.map(t => ({
          label: t.resolution,
          resolution: t.resolution,
          bandwidth: t.bandwidth || 800000,
          estimatedSizeMB: t.fileSizeBytes ? Math.round(t.fileSizeBytes / (1024 * 1024)) : 75,
          url: t.url,
          headers: t.headers || (bestMirrorStream ? bestMirrorStream.headers : undefined),
          isDirectWhatsAppFit: t.fileSizeBytes ? (t.fileSizeBytes / (1024 * 1024) <= 100) : true
        }));

        const resOptions = session.availableVariants.map((v, i) => {
          const fitTag = v.isDirectWhatsAppFit 
            ? "⚡ _[Vidéo Directe WhatsApp]_" 
            : "📦 _[Téléchargement Direct]_";
          return `*r${i + 1}.* *${v.label}* — *${v.estimatedSizeMB} MB* ${fitTag}`;
        }).join("\n");

        await context.react("⚙️");
        return context.reply(
          `🎬 *Novabox - Choix de la Résolution* 🎬\n` +
          `• *Anime:* ${session.animeTitle}\n` +
          `• *Langue:* ${session.selectedLanguage}\n` +
          `• *Saison:* ${session.selectedSeason?.name}\n` +
          `• *Épisodes sélectionnés:* ${episodeSummary}\n` +
          `• *Source:* 📺 ${hostName}\n\n` +
          `*Résolutions disponibles:*\n` +
          `${resOptions}\n\n` +
          `👉 Répondez avec: \`.a r [numéro]\` (ex: \`.a r 1\` ou \`.a r2\`)`
        );
      } else {
        await context.react("⚙️");
        return context.reply(
          `🎬 *Novabox - Choix de la Résolution* 🎬\n` +
          `• *Anime:* ${session.animeTitle}\n` +
          `• *Langue:* ${session.selectedLanguage}\n` +
          `• *Saison:* ${session.selectedSeason?.name}\n` +
          `• *Épisodes sélectionnés:* ${episodeSummary}\n\n` +
          `⚠️ _Qualités réelles indisponibles (playlist protégée) — tailles estimées._\n` +
          `*Choisissez la qualité souhaitée:*\n` +
          `*r1.* 480P Qualité Moyenne (~75 MB - Rapide)\n` +
          `*r2.* 360P Qualité Légère (~45 MB - Instantané)\n` +
          `*r3.* 720P Haute Définition (~180 MB)\n` +
          `*r4.* 1080P Full HD (~350 MB)\n\n` +
          `👉 Répondez avec: \`.a r [numéro]\` (ex: \`.a r 1\` ou \`.a r2\`)`
        );
      }
    }
  } catch (err: any) {
    console.error("[NOVABOX] Quick Download Pipeline Error:", err);
    clearUserSession(context.sender);
    return context.reply("❌ *Erreur lors du traitement direct:* Impossible de charger les flux d'épisodes.");
  }
}

/**
 * User-facing message for a failed anime search (8.58): simple, actionable,
 * zero jargon — the user is on WhatsApp, not in a terminal. The technical
 * cause (status code, proxy hint) goes to the LOG for the administrator
 * (`nebula logs`), never in the reply.
 */
function searchFailureMessage(err: any): string {
  const status = err?.response?.status;
  if (status === 403 || status === 503) {
    console.warn(`[NOVABOX] Search blocked by the source (HTTP ${status}) — if persistent, NEBULA_ANIME_PROXY is the operator fix.`);
    return (
      `😕 *La recherche est bloquée par le site pour le moment.*\n\n` +
      `Ce n'est pas un problème avec ton titre — le site refuse le bot pour l'instant.\n\n` +
      `🔁 *Réessaie dans quelques minutes.*\n` +
      `_Si le problème dure, préviens l'administrateur du bot._`
    );
  }
  if (err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || "")) {
    console.warn(`[NOVABOX] Search timed out reaching the source (${err?.code || err?.message}).`);
    return `😕 *Le site met trop de temps à répondre.*\n\n🔁 *Réessaie dans un instant.*\n_Si ça persiste, préviens l'administrateur du bot._`;
  }
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") {
    console.warn(`[NOVABOX] DNS resolution failed for the source (${err?.code}) — domain moved?`);
    return `😕 *Le site est injoignable en ce moment.*\n\n🔁 *Réessaie plus tard.*\n_Si ça persiste, préviens l'administrateur du bot._`;
  }
  console.warn(`[NOVABOX] Search failed: ${err?.message || err}`);
  return `😕 *La recherche a échoué.*\n\n🔁 *Réessaie dans un instant* — et vérifie l'orthographe du titre.`;
}

const animeCommand: BotCommand = {
  name: "anime",
  category: "Novabox",
  description: "Search and download anime episodes directly inside WhatsApp.",
  usage: ".anime [anime_name] (or .a [name] / .nv [name])",
  aliases: ["novabox", "a", "nv"],
  execute: async (sock, msg, context) => {
    const args = context.args || [];
    const firstArg = (args[0] || "").toLowerCase();
    const sender = context.sender;
    const quickParams = parseQuickDownloadParams(args);
    // 8.69: the chosen catalog (`as` default / `va` flag) — mono-source flow.
    const source = quickParams.source || DEFAULT_ANIME_SOURCE;

    // Reset session helper
    const refreshSessionTimer = (session: AnimeSession) => {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        clearUserSession(sender);
        context.reply("⏳ *Session expirée* — trop longtemps sans activité.\n\n🔁 Relance ta recherche quand tu veux : `.a <titre>`");
      }, SESSION_TIMEOUT);
    };

    // Episode watcher has its own dedicated command (audit 8.31): a bare
    // `.a watch` used to fall through to a literal search for the word
    // "watch". Inside an active flow (episode step) the handler below
    // still applies.
    if (!sessions.has(sender) && ["watch", "unwatch", "watchlist"].includes(firstArg.toLowerCase())) {
      return context.reply(
        "🔔 *La veille épisodes a sa propre commande :* `.w`\n\n" +
        "• Créer : `.w <titre>` _(_`.w solo leveling`_) puis_ `.w <numéro>`\n" +
        "• Liste : `.w`\n" +
        "• Arrêter : `.w rm <titre>`\n\n" +
        "_Tu peux suivre plusieurs anime à la fois — tu seras notifié ici dès qu'un nouvel épisode sort._"
      );
    }

    // 8.70: a catalog flag ALONE is not a search — the old behavior
    // searched the literal word "as" (production log evidence). Guide instead.
    if (args.length === 1 && ["as", "va"].includes((args[0] || "").toLowerCase().replace(/=+$/, ""))) {
      await context.react("📘");
      return context.reply(
        `📘 *Catalogues au choix :*\n\n` +
        `• \`.a <titre>\` — catalogue complet *(défaut)*\n` +
        `• \`.a va <titre>\` — catalogue VF\n\n` +
        `*Exemples :* \`.a solo leveling\` · \`.a va solo leveling\`\n\n` +
        `_💡 Astuce : sépare bien les mots du titre (« solo leveling », pas « sololeveling »)._`
      );
    }

    // If no args and no active session, show usage
    if (args.length === 0 && !sessions.has(sender)) {
      await context.react("🎬");
      return context.reply(
        `🤖 *Nebula Bot - Anime Novabox Downloader* 🎬\n\n` +
        `Recherche, téléchargement et streaming direct sans pub pour n'importe quel anime !\n\n` +
        `*Catalogues (source au choix) :*\n` +
        `• Catalogue complet *(défaut)* : \`.a [titre]\`\n` +
        `• Catalogue VF : \`.a va [titre]\`\n` +
        `• Langue : \`.a [titre] vostfr\` _(VF par défaut)_\n\n` +
        `*Téléchargement direct :*\n` +
        `• Saison entière : \`.a jjk s3 all r2\`\n` +
        `• Un épisode : \`.a jjk s3 ep6 r2\`\n` +
        `• Liste d'épisodes : \`.a jjk s3 e1,2,3,5,7,8,9 r2\`\n` +
        `• Plage d'épisodes : \`.a jjk s3 2-9 r2\`\n` +
        `• Recherche + choix qualité : \`.a solo leveling s1 all\`\n\n` +
        `*Navigation interactive :*\n` +
        `• Rechercher : \`.a [titre]\` (ex. \`.a Demon Slayer\`)\n` +
        `• Choisir l'anime : \`.a [numéro]\` (ex. \`.a 1\`)\n` +
        `• Choisir la saison : \`.a s[numéro]\` (ex. \`.a s1\`)\n` +
        `• Choisir l'épisode : \`.a ep[numéro]\` (ex. \`.a ep1\`)\n` +
        `• Choisir la qualité : \`.a r [numéro]\` (ex. \`.a r 1\`)`
      );
    }

    // Determine if we should handle this as an interactive step selection or as a new search query
    let isStepAction = false;
    if (sessions.has(sender)) {
      const session = sessions.get(sender)!;
      const step = session.step;
      const fullArgStr = args.join(" ").toLowerCase();
      if (step === "select_anime") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "select" || firstArg === "s" || firstArg === "choice" || /^s?\d+$/i.test(firstArg);
      } else if (step === "language") {
        isStepAction = firstArg === "vostfr" || firstArg === "vf";
      } else if (step === "season") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "season" || firstArg === "s" || /^s\d+/i.test(firstArg) || firstArg === "vostfr" || firstArg === "vf";
      } else if (step === "episode") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "ep" || firstArg === "e" || firstArg === "episode" || /^(?:ep|e)?\d+/i.test(firstArg) || fullArgStr.includes(",") || fullArgStr.includes("-");
      } else if (step === "resolution") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "res" || firstArg === "r" || firstArg === "resolution" || /^(?:r|res)\d+$/i.test(firstArg);
      } else if (step === "single_stream_choice") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "choice" || firstArg === "c" || firstArg === "compress" || firstArg === "links";
      }
    }

    // Step-by-step handler if there's an active session and the user is responding to the step
    if (sessions.has(sender) && (isStepAction || args.length === 0)) {
      const session = sessions.get(sender)!;
      refreshSessionTimer(session);

      // Handle anime selection step
      if (session.step === "select_anime") {
        let choiceIndex = -1;
        const selectMatch = firstArg.match(/^s?(\d+)$/i);
        if (firstArg === "select" || firstArg === "s" || firstArg === "choice") {
          choiceIndex = parseInt(args[1] || "") - 1;
        } else if (selectMatch) {
          choiceIndex = parseInt(selectMatch[1], 10) - 1;
        } else if (!isNaN(parseInt(firstArg))) {
          choiceIndex = parseInt(firstArg) - 1;
        }

        const results = session.searchResults || [];
        if (choiceIndex < 0 || choiceIndex >= results.length) {
          return context.reply(`❌ *Choix invalide :* réponds avec un numéro entre *1* et *${results.length}*.\nExemple : \`.a 1\``);
        }

        const chosen = results[choiceIndex];

        // If this session had pending quick parameters, continue straight through the pipeline
        if (session.pendingQuickParams) {
          return await executeQuickDownloadPipeline(sock, msg, context, session, chosen, session.pendingQuickParams);
        }

        session.animeTitle = chosen.title;
        session.animeUrl = chosen.url;

        await context.react("⏳");
        await context.reply(`✨ *Sélectionné :* *${chosen.title}*\n🔗 Chargement des saisons...`);

        try {
          // 8.69 (refonte sources choisies): wire the CHOSEN catalog with
          // structural languages — VF by default, unless the user picked a
          // labeled entry from the results list (va) or NEBULA_VF_DEFAULT=0.
          let wantLang: "VF" | "VOSTFR" = process.env.NEBULA_VF_DEFAULT !== "0" ? "VF" : "VOSTFR";
          if (session.source === "va") {
            const chosenEntry = (session.searchResults || []).find((r) => r.url === chosen.url);
            if (chosenEntry?.language === "VF" || chosenEntry?.language === "VOSTFR") {
              wantLang = chosenEntry.language;
            }
          }
          const wired = await wireSessionSeasons(session, chosen, wantLang);
          if (wired.status === "missing") {
            clearUserSession(sender);
            return context.reply(wired.message);
          }

          session.step = "season";
          const seasonsList = session.seasons.map((s, i) => `*s${i + 1}.* ${s.name}`).join("\n");

          // Jikan poster enrichment (audit 8.19) — best-effort MyAnimeList
          // card (poster + score + episodes); never blocks or breaks the flow.
          if (process.env.NEBULA_JIKAN_DISABLED !== "1") {
            void (async () => {
              try {
                const info = await bestAnimeMatch(chosen.title);
                if (info?.posterUrl) {
                  await sock.sendMessage(
                    msg.key.remoteJid,
                    { image: { url: info.posterUrl }, caption: formatAnimeCard(info, true) },
                    { quoted: msg }
                  );
                }
              } catch {}
            })();
          }

          await context.react("📂");
          return context.reply(
            `🎬 *Novabox - Choisissez la Saison* 🎬\n` +
            `• *Anime:* ${chosen.title}\n` +
            `• *Langue:* 🇫🇷 *${wired.language}*\n` +
            // ONE clear notice, never two: when the requested language is
            // missing, the policy header replaces the switch hint (8.70).
            (wired.header
              ? wired.header + `\n\n`
              : seasonScreenLanguageHint(wired.language, session.languages.includes("VF")) + `\n\n`) +
            `*Saisons disponibles :*\n` +
            `${seasonsList}\n\n` +
            (wired.guideHint ? wired.guideHint + `\n\n` : ``) +
            `👉 Réponds avec : \`.a s[numéro]\` (ex : \`.a s1\`)`
          );


        } catch (err: any) {
          console.error("[NOVABOX] Search select Error:", err);
          clearUserSession(sender);
          return context.reply("😕 *Impossible de charger les saisons de cet anime.*\n\n🔁 *Réessaie dans un instant* — si ça persiste, relance ta recherche.");
        }
      }

      // Handle language switch (.a vostfr / .a vf) — 8.69: re-filters the
      // stored sourceSeasons LOCALLY (no network, no catalog rebuild, no
      // cross-source jump). Missing language → honest message + other-flag guide.
      if (session.step === "season" || session.step === "language") {
        if (firstArg === "vostfr" || firstArg === "vf") {
          const langChoice: "VF" | "VOSTFR" = firstArg === "vostfr" ? "VOSTFR" : "VF";
          if (!session.sourceSeasons || session.sourceSeasons.length === 0) {
            return context.reply(`😕 *Session invalide.*\n\n🔁 *Relance ta recherche :* \`.a <titre>\``);
          }
          const switched = applyPolicyToSession(session, langChoice);
          if (switched.status === "missing") {
            return context.reply(switched.message);
          }
          session.languageForcedByUser = true;
          session.step = "season";
          const seasonsList = session.seasons.map((s, i) => `*s${i + 1}.* ${s.name}`).join(`\n`);
          await context.react("🗣️");
          return context.reply(
            `🔄 *Langue : ${switched.language}*\n\n` +
            (switched.header ? switched.header + `\n` : `*Saisons disponibles :*\n`) +
            `${seasonsList}\n\n` +
            (switched.guideHint ? switched.guideHint + `\n\n` : ``) +
            `👉 Réponds avec : \`.a s[numéro]\` (ex : \`.a s1\`)`
          );
        }
      }
      // Handle season selection step
      if (session.step === "season") {
        let seasonIndex = -1;
        let isSeasonDownload = false;

        const fullArgStr = args.join(" ").toLowerCase();
        if (fullArgStr.includes("d-") || fullArgStr.includes("d") || fullArgStr.includes("all")) {
          isSeasonDownload = true;
        }

        const sMatch = firstArg.match(/^s(\d+)(?:d|-d|d-)?$/i);
        if (sMatch) {
          seasonIndex = parseInt(sMatch[1], 10) - 1;
        } else if (firstArg === "season" || firstArg === "s") {
          seasonIndex = parseInt(args[1] || "", 10) - 1;
        } else if (!isNaN(parseInt(firstArg))) {
          seasonIndex = parseInt(firstArg, 10) - 1;
        }

        if (seasonIndex < 0 || seasonIndex >= session.seasons.length) {
          return context.reply(`❌ *Choix invalide :* réponds avec un numéro de saison entre *1* et *${session.seasons.length}*.\nExemple : \`.a s1\` — ou \`.a s1 d-\` pour télécharger toute la saison`);
        }

        const selectedSeason = session.seasons[seasonIndex];
        session.selectedSeason = selectedSeason;

        await context.react("⏳");
        await context.reply(`🔍 *Chargement des épisodes de ${selectedSeason.name}...*`);

        try {
          if (selectedSeason.isVoiranime) {
            // voiranime VF season (audit 8.17): positional episode list instead
            // of nakanime episodes.js; players are resolved lazily later.
            const vaEps = (await voiranimeEpisodes(selectedSeason.url)).filter((e) => e.n > 0);
            if (vaEps.length === 0) {
              clearUserSession(sender);
              return context.reply(`❌ *Erreur :* aucun épisode numéroté trouvé pour cette entrée. Session terminée.`);
            }
            session.voiranimeAnimeUrl = selectedSeason.url;
            session.voiranimeEpisodes = vaEps;
            session.episodes = { 1: new Array(vaEps.length).fill("") };
            session.episodeListLabels = {};
          } else {
            const jsUrl = selectedSeason.url + "episodes.js";
            const { lists: eps, labels: epLabels } = await parseEpisodesDetailed(jsUrl);

            if (!eps || Object.keys(eps).length === 0) {
              clearUserSession(sender);
              return context.reply("❌ *Erreur :* aucun épisode trouvé pour cette saison. Session terminée.");
            }

            session.episodes = eps;
            session.episodeListLabels = epLabels;

            // nakanime: register VF as AVAILABLE (`.a vf` accepted) but never
            // auto-select it — language labels are unreliable (audit 8.6).
            if (isNakanimeUrl(selectedSeason.url)) {
              if (
                Object.values(epLabels).some((l) => isNakanimeVfLabel(l.language)) &&
                !session.languages.includes("VF")
              ) {
                session.languages.push("VF");
              }
            }
          }

          const totalEpisodes = Math.max(...Object.values(session.episodes || {}).map(arr => arr.length));

          if (isSeasonDownload) {
            // User requested to download the entire season!
            session.isSeasonZipDownload = true;
            session.selectedEpisodeIndices = Array.from({ length: totalEpisodes }, (_, i) => i);
            session.selectedEpisodeIndex = 0; // Reference first episode for stream quality discovery

            // voiranime: resolve the first episode's player for stream inspection
            if (session.voiranimeAnimeUrl) {
              await fillVoiranimePlayers(session, [0]);
            }

            await context.react("🔍");
            await context.reply(`🔎 *Analyse du flux vidéo pour ${selectedSeason.name} (${totalEpisodes} épisodes)...*`);

            const resolved = await resolveEpisodeStream(session.episodes || {}, 0);
            const hlsUrl = resolved.hlsUrl;
            const refererUrl = resolved.refererUrl;
            const originUrl = resolved.originUrl;

            let variants: HlsVariant[] = [];
            if (hlsUrl) {
              variants = await inspectHlsStreams(hlsUrl, refererUrl, originUrl);
            }

            session.availableVariants = variants;
            session.step = "resolution";
            await context.react("⚙️");

            const resOptions = variants.length > 0
              ? variants.map((v, i) => `*r${i + 1}.* *${v.label}* (${v.resolution}) — ~${v.estimatedSizeMB} MB/ep`).join("\n")
              : `*r1.* 1080P Full HD\n*r2.* 720P High Definition\n*r3.* 480P Medium Quality\n*r4.* 360P Mobile Quality`;

            return context.reply(
              `🎬 *Novabox - Saison complète* 📦\n` +
              `• *Anime :* ${session.animeTitle}\n` +
              `• *Langue :* ${session.selectedLanguage}\n` +
              `• *Saison :* ${selectedSeason.name} (${totalEpisodes} épisodes)\n` +
              `• *Lecteur :* 📺 ${resolved.playerName || "VidMoly"}\n\n` +
              `*Choisis la qualité pour les ${totalEpisodes} épisodes :*\n` +
              `${resOptions}\n\n` +
              `👉 Réponds avec : \`.a r [numéro]\` (ex : \`.a r 1\` ou \`.a r 2\`)`
            );
          }

          session.step = "episode";
          
          return context.reply(
            `🎬 *Novabox - Choisis l’épisode(s)* 🎬\n` +
            `• *Anime :* ${session.animeTitle}\n` +
            `• *Langue :* ${session.selectedLanguage}\n` +
            `• *Saison :* ${selectedSeason.name}\n\n` +
            `📦 *Épisodes disponibles :* ${totalEpisodes}\n\n` +
            `*Options :*\n` +
            `• Un épisode : \`.a e2\` (ou \`.a 2\` / \`.a ep2\`)\n` +
            `• Plusieurs épisodes : \`.a e2,e3,e4,e7,e9\` (ou \`.a 2,3,4,7,9\`)\n` +
            `• Plage d'épisodes : \`.a 1-5\` (ou \`.a e1-e5\`)\n` +
            `• 🔔 Suivre les nouveaux épisodes : \`.a watch\`\n\n` +
            `👉 Réponds avec le(s) épisode(s) voulu(s) :`
          );
        } catch (err: any) {
          console.error("[NOVABOX] Failed to parse episodes:", err);
          clearUserSession(sender);
          return context.reply("😕 *Impossible de charger les épisodes de cette saison.*\n\n🔁 *Réessaie dans un instant.*\n_Si ça persiste, préviens l\u2019administrateur du bot._");
        }
      }

      // Handle episode selection step (Single episode, multiple comma-separated episodes, or range)
      if (session.step === "episode") {
        const fullArgStr = args.join(" ").trim();
        const totalEpisodes = Math.max(...Object.values(session.episodes || {}).map(arr => arr.length));
        const selectedIndices: number[] = [];

        // Episode watcher (audit S4): `.a watch` / `.a unwatch [titre]` / `.a watchlist`
        if (firstArg === "watch" || firstArg === "unwatch" || firstArg === "watchlist") {
          return await handleWatchAction(context, session, msg);
        }

        // Check for range format (e.g. 1-5 or e1-e5)
        const rangeMatch = fullArgStr.match(/^(?:ep|e)?(\d+)\s*-\s*(?:ep|e)?(\d+)$/i);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let ep = min; ep <= max; ep++) {
            if (ep >= 1 && ep <= totalEpisodes) {
              selectedIndices.push(ep - 1);
            }
          }
        } else {
          // Check for comma or whitespace separated list (e.g. e2,e3,e4 or 2,3,4 or e2 e3 e4)
          const tokens = fullArgStr.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
          for (const token of tokens) {
            const tokenMatch = token.match(/^(?:ep|e)?(\d+)$/i);
            if (tokenMatch) {
              const epNum = parseInt(tokenMatch[1], 10);
              if (epNum >= 1 && epNum <= totalEpisodes) {
                const idx = epNum - 1;
                if (!selectedIndices.includes(idx)) {
                  selectedIndices.push(idx);
                }
              }
            }
          }
        }

        if (selectedIndices.length === 0) {
          return context.reply(
            `❌ *Invalid Episode Selection:* Please choose valid episode number(s) between *1* and *${totalEpisodes}*.\n` +
            `Examples:\n` +
            `• Single: \`.a e2\` or \`.a 2\`\n` +
            `• Multi: \`.a e2,e3,e4,e7,e9\` or \`.a 2,3,4,7,9\`\n` +
            `• Range: \`.a 1-5\``
          );
        }

        session.selectedEpisodeIndices = selectedIndices;
        session.selectedEpisodeIndex = selectedIndices[0]; // Reference for initial stream inspection

        // voiranime VF wiring (audit 8.17): resolve the players for the chosen
        // episodes so stream inspection works exactly like the quick pipeline.
        if (session.voiranimeAnimeUrl && session.voiranimeEpisodes) {
          await fillVoiranimePlayers(session, selectedIndices);
        }

        const isMulti = selectedIndices.length > 1;
        const episodeSummary = isMulti 
          ? selectedIndices.map(i => `Ep ${i + 1}`).join(", ")
          : `Episode ${selectedIndices[0] + 1}`;

        // Probe available stream sources across all mirrors
        await context.react("🔍");
        await context.reply(`🔎 *Inspecting media streams for ${episodeSummary}...*`);

        let detectedTracks: StreamQualityTrack[] = [];
        let hostName = "VidMoly";
        let bestMirrorStream: any = null;

        try {
          // Collect mirror URLs for this episode
          const mirrorUrls: string[] = [];
          for (const listId of Object.keys(session.episodes || {}).map(Number)) {
            const url = session.episodes?.[listId]?.[selectedIndices[0]];
            if (url && !mirrorUrls.includes(url)) {
              mirrorUrls.push(url);
            }
          }

          if (mirrorUrls.length > 0) {
            bestMirrorStream = await resolveBestMirrorStream(mirrorUrls);
            if (bestMirrorStream.availableTracks && bestMirrorStream.availableTracks.length > 0) {
              detectedTracks = bestMirrorStream.availableTracks;
            }
            if (bestMirrorStream.hostName) {
              hostName = bestMirrorStream.hostName;
            }
          }
        } catch (err: any) {
          console.warn("[NOVABOX] Multi-mirror stream probe note:", err.message);
        }

        // Fallback to legacy VidMoly inspector if no tracks found
        if (detectedTracks.length === 0) {
          const resolved = await resolveEpisodeStream(session.episodes || {}, selectedIndices[0]);
          const hlsUrl = resolved.hlsUrl;
          const refererUrl = resolved.refererUrl;
          const originUrl = resolved.originUrl;

          if (hlsUrl) {
            const legacyVariants = await inspectHlsStreams(hlsUrl, refererUrl, originUrl);
            detectedTracks = legacyVariants.map(v => ({
              resolution: v.label,
              url: v.url,
              bandwidth: v.bandwidth,
              fileSizeBytes: v.estimatedSizeMB * 1024 * 1024,
              type: 'hls' as const
            }));
          }
        }

        // Sort tracks: prioritize lightweight, fast mobile resolutions (480P / 360P) first, then HD (720P / 1080P)
        if (detectedTracks.length > 0) {
          detectedTracks.sort((a, b) => {
            const order: Record<string, number> = { '480P': 1, '360P': 2, '720P': 3, '1080P': 4 };
            const rankA = order[a.resolution.toUpperCase()] || 5;
            const rankB = order[b.resolution.toUpperCase()] || 5;
            return rankA - rankB;
          });

          // Store variants in session
          session.availableVariants = detectedTracks.map(t => ({
            label: t.resolution,
            resolution: t.resolution,
            bandwidth: t.bandwidth || 800000,
            estimatedSizeMB: t.fileSizeBytes ? Math.round(t.fileSizeBytes / (1024 * 1024)) : 75,
            url: t.url,
            headers: t.headers || (bestMirrorStream ? bestMirrorStream.headers : undefined),
            isDirectWhatsAppFit: t.fileSizeBytes ? (t.fileSizeBytes / (1024 * 1024) <= 100) : true
          }));

          session.step = "resolution";
          await context.react("⚙️");

          const resOptions = session.availableVariants.map((v, i) => {
            const fitTag = v.isDirectWhatsAppFit 
              ? "⚡ _[Fast & Lightweight Direct Video]_" 
              : "📦 _[High-Res Direct Links]_";
            return `*r${i + 1}.* *${v.label}* — *${v.estimatedSizeMB} MB* ${fitTag}`;
          }).join("\n");

          return context.reply(
            `🎬 *Novabox - Choisis la Qualité* 🎬\n` +
            `• *Anime :* ${session.animeTitle}\n` +
            `• *Langue :* ${session.selectedLanguage}\n` +
            `• *Saison :* ${session.selectedSeason?.name}\n` +
            `• *Épisodes :* ${episodeSummary} (${selectedIndices.length} au total)\n` +
            `• *Flux actif :* 📺 ${hostName}\n\n` +
            `*Qualités réellement disponibles (480p/360p rapides en priorité) :*\n` +
            `${resOptions}\n\n` +
            `👉 Réponds avec : \`.a r [numéro]\` (ex : \`.a r 1\` ou \`.a r1\`)`
          );
        } else {
          // Standard resolution fallback when manifest could not be read
          session.step = "resolution";
          await context.react("⚙️");
          return context.reply(
            `🎬 *Novabox - Choisis la Qualité* 🎬\n` +
            `• *Anime :* ${session.animeTitle}\n` +
            `• *Langue :* ${session.selectedLanguage}\n` +
            `• *Saison :* ${session.selectedSeason?.name}\n` +
            `• *Épisodes :* ${episodeSummary} (${selectedIndices.length} au total)\n\n` +
            `⚠️ _Qualités réelles indisponibles (playlist protégée) — tailles estimées._\n` +
            `*Choisis ta qualité de téléchargement :*\n` +
            `*r1.* 480P Qualité moyenne (~75 Mo — téléchargement rapide, vidéo directe)\n` +
            `*r2.* 360P Qualité mobile (~45 Mo — téléchargement instantané)\n` +
            `*r3.* 720P Haute définition (~180 Mo)\n` +
            `*r4.* 1080P Full HD (~350 Mo)\n\n` +
            `👉 Réponds avec : \`.a r [numéro]\` (ex : \`.a r 1\` ou \`.a r1\`)`
          );
        }
      }

      // Handle single stream choice step
      if (session.step === "single_stream_choice") {
        let choice = 0;
        if (!isNaN(parseInt(firstArg))) {
          choice = parseInt(firstArg);
        } else if (firstArg === "1" || firstArg === "compress" || firstArg === "c") {
          choice = 1;
        } else if (firstArg === "2" || firstArg === "links" || firstArg === "l") {
          choice = 2;
        }

        if (choice === 1) {
          session.forceCompress = true;
          if (session.singleStreamDetected?.streamUrl) {
            session.selectedVariantUrl = session.singleStreamDetected.streamUrl;
          }
          await context.react("🚀");
          return await sendFinalEpisode(sock, msg, context, session, "480P [Compressed]");
        } else if (choice === 2) {
          // Send direct streaming & download resources
          const epIndex = session.selectedEpisodeIndex || 0;
          const epNum = epIndex + 1;
          const animeClean = session.animeTitle.replace(/\s+/g, "_");
          const lang = session.selectedLanguage || "VOSTFR";
          const seasonNum = session.selectedSeason?.name.match(/\d+/)?.[0] || "01";
          const formattedSeason = `S${seasonNum.padStart(2, "0")}`;
          const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;
          const filename = sanitizeFilename(`${animeClean}_${lang}_1080P_${formattedSeason}_${formattedEpisode}`) + ".mp4";

          const vidmolyUrl = getVidMolyUrl(session.episodes, epIndex, session.episodeListLabels, session.selectedLanguage);

          clearUserSession(sender);
          await context.react("✅");
          return context.reply(
            `📥 *NEBULA NOVABOX - STREAM DETAILS* 📥\n\n` +
            `🎬 *Anime:* ${session.animeTitle}\n` +
            `🗣️ *Language:* ${lang}\n` +
            `📅 *Season:* ${session.selectedSeason?.name}\n` +
            `🎞️ *Episode:* Episode ${epNum}\n` +
            `⚙️ *Detected Resolution:* ${session.singleStreamDetected?.label || "1080P"} (~${session.singleStreamDetected?.estimatedSizeMB || 486} MB)\n` +
            `📺 *Official Player Engine:* VidMoly\n` +
            `📄 *Filename:* \`${filename}\`\n\n` +
            `🔗 *Direct Streaming & Download:* \n` +
            (vidmolyUrl ? `• 📺 *Play Ad-Free (${playerSourceLabel(vidmolyUrl)}):* ${vidmolyUrl}\n` : "• 📺 *Stream:* Direct HLS ready\n") +
            `\n🌌 _Nebula Bot - Your ultimate media center_`
          );
        } else {
          return context.reply("❌ *Choix invalide :* réponds *1* (compresser et envoyer) ou *2* (liens directs).\nExemple : `.a 1`");
        }
      }

      // Handle resolution selection step
      if (session.step === "resolution") {
        console.log(`[NOVABOX] Resolution selection step triggered for ${session.animeTitle}. User input: "${args.join(" ")}"`);
        let resChoice = "";
        let resIndex = -1;

        const rMatch = firstArg.match(/^(?:r|res)(\d+)$/i);
        if (rMatch) {
          resIndex = parseInt(rMatch[1], 10);
        } else if (firstArg === "res" || firstArg === "r" || firstArg === "resolution") {
          resIndex = parseInt(args[1] || "", 10);
        } else if (!isNaN(parseInt(firstArg))) {
          resIndex = parseInt(firstArg, 10);
        }

        const variants = session.availableVariants || [];
        console.log(`[NOVABOX] Mapped index: ${resIndex}, Total variants available: ${variants.length}`);

        if (variants.length > 0) {
          if (resIndex >= 1 && resIndex <= variants.length) {
            const selectedVariant = variants[resIndex - 1];
            session.selectedVariantUrl = selectedVariant.url;
            session.selectedVariantHeaders = selectedVariant.headers;
            resChoice = selectedVariant.label;
            console.log(`[NOVABOX] Selected variant label: ${resChoice}, URL: ${selectedVariant.url}, estimatedSizeMB: ${selectedVariant.estimatedSizeMB}`);
            if (selectedVariant.estimatedSizeMB > 100 && (resChoice === "480P" || resChoice === "360P")) {
              session.forceCompress = true;
              console.log(`[NOVABOX] Large lightweight resolution requires forced compression.`);
            }
          }
        } else {
          if (resIndex === 1) {
            resChoice = "480P";
            session.forceCompress = true;
          } else if (resIndex === 2) {
            resChoice = "360P";
            session.forceCompress = true;
          } else if (resIndex === 3) {
            resChoice = "720P";
          } else if (resIndex === 4) {
            resChoice = "1080P";
          }
          console.log(`[NOVABOX] Fallback resolution chosen: ${resChoice}`);
        }

        if (!resChoice) {
          const maxChoice = variants.length > 0 ? variants.length : 4;
          return context.reply(`❌ *Choix invalide :* réponds avec une qualité entre *1* et *${maxChoice}*.\nExemple : \`.a r 1\` ou \`.a r1\``);
        }

        await context.react("🚀");
        return await sendFinalEpisode(sock, msg, context, session, resChoice);
      }
    }

    // 1. Quick Command Direct Flow (e.g. .a jjk s3 all r2, .a jjk s3 ep6 r2, .a solo leveling s1 all)
    if (quickParams.isQuickCommand && quickParams.animeQuery) {
      await context.react("🔍");
      await context.reply(`🔍 *Recherche rapide pour:* "${quickParams.animeQuery}"...`);

      try {
        let searchResults = await searchAnime(quickParams.canonicalQuery, source);
        if (searchResults.length === 0 && quickParams.canonicalQuery !== quickParams.animeQuery) {
          searchResults = await searchAnime(quickParams.animeQuery, source);
        }

        if (searchResults.length === 0) {
          await context.react("❌");
          return context.reply(searchEmptyMessage(quickParams.animeQuery, source));
        }

        // Clear previous session
        clearUserSession(sender);

        const matchResult = isExactAnimeMatch(quickParams.animeQuery, searchResults);

        if (matchResult.isExact && matchResult.exactMatchIndex >= 0) {
          // Exact / unambiguous match -> auto select immediately
          const chosen = searchResults[matchResult.exactMatchIndex];
          const newSession: AnimeSession = {
            step: "select_anime",
            source,
            searchResults,
            animeTitle: chosen.title,
            animeUrl: chosen.url,
            languages: [],
            seasons: [],
            pendingQuickParams: quickParams,
            timer: null
          };

          setUserSession(sender, newSession);
          refreshSessionTimer(newSession);

          return await executeQuickDownloadPipeline(sock, msg, context, newSession, chosen, quickParams);
        } else {
          // Vague / ambiguous query (e.g. "solo lev", "demon", "dragon") -> ask user to choose from list
          const newSession: AnimeSession = {
            step: "select_anime",
            source,
            searchResults,
            animeTitle: "",
            animeUrl: "",
            languages: [],
            seasons: [],
            pendingQuickParams: quickParams,
            timer: null
          };

          setUserSession(sender, newSession);
          refreshSessionTimer(newSession);

          const listText = searchResults
            .map((r, i) => `*${i + 1}.* ${r.title}${r.subtitle ? ` (_${r.subtitle}_)` : ""}`)
            .join("\n");

          await context.react("🎬");
          return context.reply(
            `🎬 *Novabox - Sélectionnez l'Anime* 🎬\n\n` +
            `Plusieurs animes correspondent à *"${quickParams.animeQuery}"*. Veuillez choisir pour continuer le téléchargement direct:\n\n` +
            `${listText}\n\n` +
            `👉 Répondez avec: \`.a [numéro]\` (ex: \`.a 1\`)`
          );
        }
      } catch (err: any) {
        console.error("[NOVABOX] Quick Search Error:", err?.response?.status || err?.code || err?.message);
        await context.react("❌");
        if (err?.message === VA_DISABLED_CODE) return context.reply(vaDisabledMessage());
        return context.reply(searchFailureMessage(err));
      }
    }

    // 2. Default: Standard anime title search
    await context.react("🔍");
    const query = quickParams.animeQuery || args.join(" ").trim();
    const searchQuery = quickParams.canonicalQuery || query;
    await context.reply(`🔍 *Recherche de:* "${query}"...`);

    try {
      let searchResults = await searchAnime(searchQuery, source);
      if (searchResults.length === 0 && searchQuery !== query) {
        searchResults = await searchAnime(query, source);
      }

      if (searchResults.length === 0) {
        await context.react("❌");
        return context.reply(searchEmptyMessage(query, source));
      }

      // Clear any existing session to start fresh
      clearUserSession(sender);

      // Check if match is exact
      const matchResult = isExactAnimeMatch(query, searchResults);

      if (matchResult.isExact && matchResult.exactMatchIndex >= 0 && searchResults.length === 1) {
        const chosen = searchResults[matchResult.exactMatchIndex];
        const newSession: AnimeSession = {
          step: "select_anime",
          source,
          searchResults,
          animeTitle: chosen.title,
          animeUrl: chosen.url,
          languages: [],
          seasons: [],
          userSearchQuery: searchQuery, // 8.55: raw query for VF title matching
          timer: null
        };
        setUserSession(sender, newSession);
        refreshSessionTimer(newSession);

        await context.react("⏳");
        await context.reply(`✨ *Sélectionné:* *${chosen.title}*\n🔗 Chargement des saisons...`);

        // 8.69 (refonte sources choisies): chosen-catalog wiring with
        // structural languages — VF default, labeled-entry override on va.
        let wantLang: "VF" | "VOSTFR" = process.env.NEBULA_VF_DEFAULT !== "0" ? "VF" : "VOSTFR";
        if (newSession.source === "va") {
          const chosenEntry = searchResults.find((r) => r.url === chosen.url);
          if (chosenEntry?.language === "VF" || chosenEntry?.language === "VOSTFR") {
            wantLang = chosenEntry.language;
          }
        }
        const wired = await wireSessionSeasons(newSession, chosen, wantLang);
        if (wired.status === "missing") {
          clearUserSession(sender);
          return context.reply(wired.message);
        }
        newSession.step = "season";
        const seasonsList = newSession.seasons.map((s, i) => `*s${i + 1}.* ${s.name}`).join("\n");

        await context.react("📂");
        return context.reply(
          `🎬 *Novabox - Choisissez la Saison* 🎬\n` +
          `• *Anime:* ${chosen.title}\n` +
          `• *Langue:* 🇫🇷 *${wired.language}*\n` +
          (wired.header
            ? wired.header + `\n\n`
            : seasonScreenLanguageHint(wired.language, newSession.languages.includes("VF")) + `\n\n`) +
          `*Saisons disponibles :*\n` +
          `${seasonsList}\n\n` +
          (wired.guideHint ? wired.guideHint + `\n\n` : ``) +
          `👉 Réponds avec : \`.a s[numéro]\` (ex : \`.a s1\`)`
        );

      }

      // Create a user session at the select_anime step
      const newSession: AnimeSession = {
        step: "select_anime",
        source,
        searchResults,
        animeTitle: "",
        animeUrl: "",
        languages: [],
        seasons: [],
        userSearchQuery: searchQuery, // 8.55: raw query for VF title matching
        timer: null
      };

      setUserSession(sender, newSession);
      refreshSessionTimer(newSession);

      // Print list of matching anime
      const listText = searchResults
        .map((r, i) => `*${i + 1}.* ${r.title}${r.subtitle ? ` (_${r.subtitle}_)` : ""}`)
        .join("\n");

      await context.react("🎬");
      return context.reply(
        `🎬 *Novabox - Sélectionner l'Anime* 🎬\n\n` +
        `Résultats trouvés pour *"${query}"*. Choisissez l'anime souhaité:\n\n` +
        `${listText}\n\n` +
        `👉 Répondez avec: \`.a [numéro]\` (ex: \`.a 1\`)`
      );

    } catch (err: any) {
      console.error("[NOVABOX] Search Error:", err?.response?.status || err?.code || err?.message);
      await context.react("❌");
      if (err?.message === VA_DISABLED_CODE) return context.reply(vaDisabledMessage());
      return context.reply(searchFailureMessage(err));
    }
  }
};

// Universal helper to locate the official VidMoly embed URL exclusively
function getVidMolyUrl(
  episodes: Record<number, string[]> | undefined,
  epIndex: number,
  labels?: Record<number, { host: string; language: string }>,
  language?: string
): string {
  if (!episodes) return "";
  const isVidMolyLike = (u: string) => u.includes("vidmoly") || u.includes("ansembed");

  // 0. Language-aware pick first: the card's player link must match the
  // session language instead of blindly returning the first vidmoly list
  // (audit 8.6 — the link used to contradict the downloaded file).
  if (labels && language) {
    const wantVf = language.toUpperCase() === "VF";
    for (const listId of Object.keys(episodes).map(Number).sort((a, b) => a - b)) {
      const candidate = episodes[listId]?.[epIndex] || "";
      if (candidate && isVidMolyLike(candidate) && isNakanimeVfLabel(labels[listId]?.language || "") === wantVf) {
        return candidate;
      }
    }
  }

  // 1. Primary Check: List 2 is the official VidMoly player on the streaming catalog
  const eps2Url = episodes[2]?.[epIndex] || "";
  if (eps2Url && isVidMolyLike(eps2Url)) {
    return eps2Url;
  }

  // 2. Scan all other player lists specifically for VidMoly / ansembed mirrors
  for (const listId of Object.keys(episodes).map(Number)) {
    const candidate = episodes[listId]?.[epIndex] || "";
    if (candidate && isVidMolyLike(candidate)) {
      return candidate;
    }
  }

  // 3. Fallback to eps2 if available even if obfuscated
  if (eps2Url) {
    return eps2Url;
  }

  return "";
}

// Standard Dean Edwards Unpacker
function unpack(p: string, a: number, c: number, k: string[]): string {
  let count = c;
  while (count--) {
    if (k[count]) {
      p = p.replace(new RegExp('\\b' + count.toString(a) + '\\b', 'g'), k[count]);
    }
  }
  return p;
}

/**
 * Decodes a JavaScript string literal the way `eval` would for the simple
 * escaped strings found in Dean Edwards packed scripts — without eval.
 * Supports the escapes actually emitted by packers (\xNN, \uNNNN,
 * \n \r \t \\ \' \").
 */
export function decodeJsStringLiteral(literal: string): string {
  const trimmed = literal.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }
  const body = trimmed.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    switch (next) {
      case "n": out += "\n"; i++; break;
      case "r": out += "\r"; i++; break;
      case "t": out += "\t"; i++; break;
      case "\\": out += "\\"; i++; break;
      case "'": out += "'"; i++; break;
      case '"': out += '"'; i++; break;
      case "x": {
        const hex = body.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 3;
        } else {
          out += "x";
        }
        break;
      }
      case "u": {
        const hex = body.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else {
          out += "u";
        }
        break;
      }
      default:
        out += next;
        i++;
    }
  }
  return out;
}

/**
 * Parses the simple flat array literal used as the `k` parameter of packed
 * scripts (['a','b',...]) without eval. Numeric elements are kept as-is.
 */
export function decodeJsArrayLiteral(literal: string): string[] {
  const trimmed = literal.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map((part) => decodeJsStringLiteral(part));
}

/** Layer counter guard so untrusted inputs cannot cause a pathological loop. */
const MAX_UNPACK_LAYERS = 4;

// Extract HLS stream URL exclusively from VidMoly (vidmoly.to, vidmoly.net, vidmoly.me, ansembed.net)
async function extractHlsUrlFromVidMoly(embedUrl: string): Promise<{ hlsUrl: string | null; refererUrl: string; originUrl: string }> {
  if (!embedUrl) {
    return { hlsUrl: null, refererUrl: "", originUrl: "https://vidmoly.to" };
  }

  try {
    let originUrl = "https://vidmoly.to";
    if (embedUrl.includes("vidmoly.net")) originUrl = "https://vidmoly.net";
    else if (embedUrl.includes("vidmoly.me")) originUrl = "https://vidmoly.me";
    else if (embedUrl.includes("ansembed.net")) originUrl = "https://ansembed.net";
    else if (embedUrl.includes("vidmoly")) {
      const match = embedUrl.match(/https?:\/\/[^/]+/);
      if (match) originUrl = match[0];
    }

    if (!(await isPublicFetchTarget(embedUrl, "embed page"))) {
      return { hlsUrl: null, refererUrl: embedUrl, originUrl };
    }
    const html = await robustFetchText(embedUrl, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://anime-sama.to/",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    }) || "";

    // 1. Direct sources array or file property match in script
    const m3u8Match = html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/file:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/src:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/source\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
    if (m3u8Match) {
      return { hlsUrl: m3u8Match[1], refererUrl: embedUrl, originUrl };
    }

    // 2. Packed Dean Edwards JS unpacker (handle single or multi-layer packed scripts)
    const packedRegex = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?return p\}\((['"][\s\S]*?['"])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"][\s\S]*?['"])\.split\(['"]\|['"]\)(?:\s*,\s*[^)]*)?\)/g;
    let match: RegExpExecArray | null;
    while ((match = packedRegex.exec(html)) !== null) {
      try {
        // Eval-free unpacking: the packed parameters are plain escaped
        // string/array literals; decoding them keeps third-party fetched
        // content from ever being executed as code.
        const pVal = decodeJsStringLiteral(match[1]);
        const aVal = parseInt(match[2], 10);
        const cVal = parseInt(match[3], 10);
        const kVal = decodeJsArrayLiteral(match[4]);
        let unpacked = unpack(pVal, aVal, cVal, kVal);

        // Handle multi-layer packing (unpacked output may contain another
        // packed script) with a hard layer ceiling.
        for (let layer = 0; layer < MAX_UNPACK_LAYERS; layer++) {
          const innerMatch = packedRegex.exec(unpacked);
          if (!innerMatch || unpacked.includes("eval")) break;
          const innerP = decodeJsStringLiteral(innerMatch[1]);
          const innerA = parseInt(innerMatch[2], 10);
          const innerC = parseInt(innerMatch[3], 10);
          const innerK = decodeJsArrayLiteral(innerMatch[4]);
          unpacked = unpack(innerP, innerA, innerC, innerK);
        }

        const unpackedM3u8 = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/file:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/src:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/source\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
        if (unpackedM3u8) {
          return { hlsUrl: unpackedM3u8[1], refererUrl: embedUrl, originUrl };
        }
      } catch (unpackErr: any) {
        console.warn("[NOVABOX] VidMoly packed script unpack error:", unpackErr.message);
      }
    }

    // 3. Vidmoly direct mp4 fallback pattern in HTML if m3u8 not detected
    const mp4Match = html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.mp4[^"']*)["']/i) ||
                     html.match(/file:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
                     html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    if (mp4Match) {
      return { hlsUrl: mp4Match[1], refererUrl: embedUrl, originUrl };
    }
  } catch (err: any) {
    console.warn("[NOVABOX] VidMoly stream extraction error:", err.message);
  }
  return { hlsUrl: null, refererUrl: embedUrl, originUrl: "https://vidmoly.to" };
}

// Universal extractor exclusively targeting VidMoly as the single official media player
async function resolveEpisodeStream(episodes: Record<number, string[]>, epIndex: number): Promise<{ hlsUrl: string | null; refererUrl: string; originUrl: string; playerName: string }> {
  const vidmolyEmbedUrl = getVidMolyUrl(episodes, epIndex);
  if (!vidmolyEmbedUrl) {
    console.warn(`[NOVABOX] VidMoly player URL not found for episode index ${epIndex}`);
    return { hlsUrl: null, refererUrl: "", originUrl: "", playerName: "VidMoly (Unavailable)" };
  }

  console.log(`[NOVABOX] Exclusively scraping VidMoly Player: ${vidmolyEmbedUrl}`);
  const result = await extractHlsUrlFromVidMoly(vidmolyEmbedUrl);
  return {
    ...result,
    playerName: "VidMoly"
  };
}

// Inspect and perform HEAD / Range diagnostic request to media source to verify stream reachability & content size
export async function probeMediaHeaders(targetUrl: string, refererUrl: string, originUrl: string): Promise<{ contentLengthBytes: number; isRangeSupported: boolean; httpStatus: number; contentType: string }> {
  try {
    if (!(await isPublicFetchTarget(targetUrl, "stream probe"))) {
      return { contentLengthBytes: 0, isRangeSupported: false, httpStatus: 0, contentType: "unknown" };
    }
    const res = await axios.head(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": refererUrl,
        "Origin": originUrl
      },
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: () => true,
      ...animeProxyOptions()
    });

    const rawContentLength = res.headers["content-length"];
    const contentLength = typeof rawContentLength === "number" ? rawContentLength : parseInt(String(rawContentLength || "0"), 10);
    const acceptRanges = String(res.headers["accept-ranges"] || "").toLowerCase() === "bytes";
    const contentType = String(res.headers["content-type"] || "unknown");

    return {
      contentLengthBytes: isNaN(contentLength) ? 0 : contentLength,
      isRangeSupported: acceptRanges,
      httpStatus: res.status,
      contentType
    };
  } catch (err: any) {
    console.warn(`[NOVABOX] HEAD diagnostic probe note for ${targetUrl}:`, err.message);
    return {
      contentLengthBytes: 0,
      isRangeSupported: false,
      httpStatus: 0,
      contentType: "unknown"
    };
  }
}

// Inspect the master HLS playlist via the shared extractor so resolutions and
// sizes are the REAL ones served by the CDN. Returns [] when the manifest
// cannot be read — callers then offer an adaptive-quality attempt instead of
// fabricated resolutions (audit findings R8).
async function inspectHlsStreams(hlsUrl: string, refererUrl: string, originUrl: string): Promise<HlsVariant[]> {
  try {
    if (!(await isPublicFetchTarget(hlsUrl, "HLS playlist"))) return [];
    const tracks = await fetchHlsTracksAndSizes(hlsUrl, refererUrl || hlsUrl, originUrl);
    return tracks
      .filter((t) => !!t.url)
      .map((t) => ({
        label: t.resolution,
        resolution: t.resolution,
        bandwidth: t.bandwidth || 800000,
        estimatedSizeMB: t.fileSizeBytes ? Math.max(1, Math.round(t.fileSizeBytes / (1024 * 1024))) : 75,
        url: t.url,
        isDirectWhatsAppFit: !t.fileSizeBytes || t.fileSizeBytes / (1024 * 1024) <= 100,
        headers: t.headers
      }));
  } catch (err: any) {
    console.warn("[NOVABOX] HLS inspection note:", err.message);
    return [];
  }
}

/** True when re-encoding to targetHeight cannot shrink the file (audit 8.47). */
export function compressionPointless(sourceHeight: number | null, targetHeight: number): boolean {
  return sourceHeight !== null && sourceHeight > 0 && sourceHeight <= targetHeight;
}

// Execute high-performance stream download using FFmpeg with safe process isolation
async function executeFfmpegDownload(
  targetHlsUrl: string,
  downloadSourceUrl: string,
  originUrl: string,
  localPath: string,
  timeoutMs: number = 25000
): Promise<boolean> {
  // SSRF through downloader: never hand an unvalidated URL to a subprocess.
  if (!(await isPublicFetchTarget(targetHlsUrl, "downloader input"))) {
    return false;
  }
  if (isDeadFileSlug(targetHlsUrl)) {
    console.warn(`[NOVABOX_FFMPEG] Skipping known-dead file: ${targetHlsUrl.split("?")[0]}`);
    return false;
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": downloadSourceUrl,
    "Origin": originUrl
  };

  // Try Cat-Catch style HLS Downloader first
  try {
    console.log(`[NOVABOX_FFMPEG] Starting primary Cat-Catch style downloader for: ${targetHlsUrl}`);
    // Use an elevated timeout for full HLS segment downloads (default to 4 minutes)
    const success = await downloadHlsAppLevel(targetHlsUrl, localPath, headers, 240000);
    if (success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
      console.log(`[NOVABOX_FFMPEG] Primary Cat-Catch style downloader succeeded! Size: ${fs.statSync(localPath).size} bytes`);
      return true;
    }
    console.warn(`[NOVABOX_FFMPEG] Primary Cat-Catch downloader failed. Falling back to legacy network FFmpeg...`);
  } catch (err: any) {
    console.warn(`[NOVABOX_FFMPEG] Primary Cat-Catch downloader error: ${err.message}. Falling back to legacy network FFmpeg...`);
  }

  return new Promise<boolean>(async (resolve) => {
    let localPlaylistPath: string | null = null;
    try {
      // Pre-resolve segments with tokens to prevent 403 CDN Forbidden errors
      localPlaylistPath = await prepareLocalHlsPlaylist(targetHlsUrl, headers);
      const ffmpegInput = localPlaylistPath || targetHlsUrl;

      const headersStr = `Referer: ${downloadSourceUrl}\r\nOrigin: ${originUrl}\r\n`;
      const args = [
        "-y",
        "-user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-headers",
        headersStr,
        "-reconnect",
        "1",
        "-reconnect_at_eof",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "3",
        "-rw_timeout",
        "10000000",
        "-analyzeduration",
        "5M",
        "-probesize",
        "5M",
        "-i",
        ffmpegInput,
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        localPath
      ];

      const child = spawn(resolvedFfmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      const timer: NodeJS.Timeout = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        resolve(false);
      }, timeoutMs);

      child.on("error", () => {
        clearTimeout(timer);
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        resolve(false);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        if (code === 0 && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
          resolve(true);
        } else {
          if (fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch {}
          }
          resolve(false);
        }
      });
    } catch {
      if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
        try { fs.unlinkSync(localPlaylistPath); } catch {}
      }
      resolve(false);
    }
  });
}

// Send final direct download URLs, transcode if needed, or send batch streaming/download links
async function sendFinalEpisode(sock: any, msg: any, context: BotCommandContext, session: AnimeSession, resolution: string) {
  const indices = session.selectedEpisodeIndices && session.selectedEpisodeIndices.length > 0 
    ? session.selectedEpisodeIndices 
    : [session.selectedEpisodeIndex || 0];

  const animeClean = session.animeTitle.replace(/\s+/g, "_");
  const lang = session.selectedLanguage || "VOSTFR";
  const seasonNum = session.selectedSeason?.name.match(/\d+/)?.[0] || "01";
  const formattedSeason = `S${seasonNum.padStart(2, "0")}`;

  // If multiple episodes or full season requested, run batch processor
  if (indices.length > 1 || session.isSeasonZipDownload) {
    if (indices.length > MAX_BATCH_EPISODES) {
      await context.react("⚠️");
      return context.reply(
        `⚠️ *Trop d\u2019épisodes d\u2019un coup (${indices.length}).*\n\n` +
        `La limite est de *${MAX_BATCH_EPISODES} épisodes par demande* — découpe en plusieurs fois (ex. épisodes 1 à ${MAX_BATCH_EPISODES}, puis la suite).`
      );
    }
    await context.react("⏳");
    await context.reply(
      `📦 *Nebula Novabox - Batch Media Preparation* 🚀\n\n` +
      `🎬 *Anime:* ${session.animeTitle}\n` +
      `🗣️ *Language:* ${lang}\n` +
      `📅 *Season:* ${session.selectedSeason?.name}\n` +
      `⚙️ *Resolution:* ${resolution}\n` +
      `📦 *Episodes to Process:* ${indices.length} episodes\n\n` +
      `⏳ _Preparing direct episode links... Please wait a moment._`
    );

    // Create tracked batch job for live status component
    const batchJob = createBatchJob({
      animeTitle: session.animeTitle,
      season: session.selectedSeason?.name || formattedSeason,
      resolution,
      language: lang,
      totalEpisodes: indices.length,
      episodeNumbers: indices.map((idx) => idx + 1),
    });
    updateJobStatus(batchJob.id, "downloading", `Processing ${indices.length} episodes in parallel`);

    // 8.78 — garde-fou disque GLOBAL inter-bots : ce batch réclame son pire
    // cas (plafond NEBULA_NOVABOX_MAX_BATCH_MB) dans un dossier partagé.
    // Les autres moteurs du même hôte voient la réservation et refusent de
    // démarrer si l'espace libre passait sous la réserve. Libérée dans
    // batchDownloadManager aux états terminaux (completed/failed/cancelled).
    const diskClaim = acquireDiskClaim(batchJob.id, MAX_BATCH_TOTAL_MB * 1024 * 1024);
    if (!diskClaim.ok) {
      updateJobStatus(batchJob.id, "failed", "Disk guard refused this batch", diskClaim.error);
      await context.react("⚠️");
      return context.reply(
        `⚠️ *Espace disque insuffisant pour lancer ce batch.*\n\n` +
        `${diskClaim.error}\n\n` +
        `🛡️ _Les téléchargements en cours (tous bots confondus) ne sont pas affectés — réessaie une fois terminés._`
      );
    }

    const generatedLinks: Array<{ epNum: number; downloadUrl: string; sizeMB: number; filename: string; expiresAt: number }> = [];
    let failedEpisodeCount = 0;
    const downloadedFilePaths: string[] = [];

    // Clear session to prevent re-entrant execution
    clearUserSession(context.sender);

    // Process episodes with bounded concurrency (concurrency = 2) for maximum speed and container safety
    // Episodes are processed SEQUENTIALLY by default: each pipeline holds
    // ~2x the episode size in flight (segments + consolidated TS + ffmpeg),
    // and two in parallel OOM-killed the whole bot on a 12-episode batch
    // (audit 8.12). Raise with NEBULA_BATCH_CONCURRENCY on fat hosts.
    const CONCURRENCY_LIMIT = Math.max(1, Number(process.env.NEBULA_BATCH_CONCURRENCY || 1));
    let totalMBDownloaded = 0;
    let quotaExceeded = false;
    // 8.51: when RSS is still CRITICAL after the headroom pauses, launching
    // another ~120 MB episode pipeline is how the kernel OOM-killer ended the
    // 8.50 batch. Stop claiming new episodes and tell the user to re-ask.
    let memoryStop = false;

    const processEpisodeTask = async (i: number) => {
      if (quotaExceeded) return;
      const epIndex = indices[i];
      const epNum = epIndex + 1;
      const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;
      const filenameBase = `${animeClean}_${lang}_${resolution}_${formattedSeason}_${formattedEpisode}`;
      const filename = sanitizeFilename(filenameBase) + ".mp4";
      const localPath = path.join(os.tmpdir(), `batch_${Date.now()}_${i}_${filename}`);

      updateEpisodeProgress(batchJob.id, epNum, { status: "downloading", progressPercent: 35 });

      try {
        // Collect mirror URLs for this episode (session language first, audit 8.3)
        const { primary: batchPrimary, secondary: batchSecondary } = splitMirrorsByLanguage(
          session.episodes || {},
          session.episodeListLabels,
          epIndex,
          session.selectedLanguage || "VOSTFR"
        );

        let success = false;
        for (const tier of [batchPrimary, batchSecondary]) {
          if (success || tier.length === 0) continue;
          try {
            const fallbackResult = await downloadWithAllMirrorsFallback(tier, resolution, localPath, 240000);
            if (fallbackResult.success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
              success = true;
            }
          } catch {}
        }

        if (!success) {
          const resolved = await resolveEpisodeStream(session.episodes || {}, epIndex);
          let targetHlsUrl = resolved.hlsUrl;
          const downloadSourceUrl = resolved.refererUrl;
          const originUrl = resolved.originUrl;

          if (targetHlsUrl) {
            if (targetHlsUrl.endsWith("master.txt")) {
              const baseUrl = targetHlsUrl.substring(0, targetHlsUrl.lastIndexOf("/") + 1);
              if (resolution === "360P" || resolution === "480P") {
                targetHlsUrl = baseUrl + "index-f1-v1-a1.txt";
              } else if (resolution === "720P") {
                targetHlsUrl = baseUrl + "index-f2-v1-a1.txt";
              } else if (resolution === "1080P") {
                targetHlsUrl = baseUrl + "index-f3-v1-a1.txt";
              }
            }

            success = await executeFfmpegDownload(targetHlsUrl, downloadSourceUrl, originUrl, localPath, 240000);
            if (!success) markDeadFileSlug(targetHlsUrl);
          }
        }

        if (success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
          const thisMB = fs.statSync(localPath).size / (1024 * 1024);
          if (totalMBDownloaded + thisMB > MAX_BATCH_TOTAL_MB) {
            try { fs.unlinkSync(localPath); } catch {}
            quotaExceeded = true;
            failedEpisodeCount++;
            updateEpisodeProgress(batchJob.id, epNum, { status: "failed", progressPercent: 0, error: "Batch byte quota exceeded" });
            return;
          }
          totalMBDownloaded += thisMB;

          // Move file into managed temporary store so the download link remains valid for full TTL
          const tempDownload = registerTempDownload(localPath, filename, {
            ttlMinutes: 120, // 2 hours for individual episodes
            moveFile: true
          });

          downloadedFilePaths.push(tempDownload.filePath);

          generatedLinks.push({
            epNum,
            downloadUrl: tempDownload.downloadUrl,
            sizeMB: tempDownload.sizeMB,
            filename,
            expiresAt: tempDownload.expiresAt
          });

          updateEpisodeProgress(batchJob.id, epNum, {
            status: "completed",
            progressPercent: 100,
            sizeMB: tempDownload.sizeMB,
            downloadUrl: tempDownload.downloadUrl
          });
        } else {
          // 8.69: mono-source strict — no cross-source rescue anymore.
          // The episode is honestly reported as failed; the user can
          // switch catalogs himself if a CDN node blocks this file.
          if (fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch {}
          }
          failedEpisodeCount++;
          updateEpisodeProgress(batchJob.id, epNum, { status: "failed", progressPercent: 0, error: "Stream unavailable" });
        }
      } catch (err: any) {
        if (fs.existsSync(localPath)) {
          try { fs.unlinkSync(localPath); } catch {}
        }
        failedEpisodeCount++;
        updateEpisodeProgress(batchJob.id, epNum, { status: "failed", progressPercent: 0, error: err?.message || "Stream error" });
      }
    };

    let nextEpisodeIdx = 0;
    // Batch OOM hardening (audit 8.14): the VPS container is capped by its
    // cgroup (~954 MB) while Node sizes its heap from HOST RAM, so V8 defers
    // major GC indefinitely and transient Buffer garbage accumulates across
    // episodes until the kernel OOM-killer strikes. npm start now passes
    // --max-old-space-size=384 --expose-gc; an explicit GC between episodes
    // keeps RSS flat. No-op when --expose-gc is absent.
    const gcBetweenEpisodes = () => {
      try {
        (globalThis as any).gc?.();
      } catch {}
    };
    const worker = async () => {
      while (nextEpisodeIdx < indices.length) {
        if (quotaExceeded || memoryStop) break;
        const currentIdx = nextEpisodeIdx++;
        await processEpisodeTask(currentIdx);
        gcBetweenEpisodes();
        // 8.50 OOM hardening: heavy batches (~120 MB/episode) pushed RSS into
        // the ~954 MB cgroup ceiling and the kernel killed the bot mid-batch.
        // Observe the footprint and back off when pressure rises.
        const level = await enforceMemoryHeadroom(`batch episode ${currentIdx + 1}/${indices.length} done`);
        if (level === "critical") {
          console.warn(`[NOVABOX] Memory guard: RSS critical after headroom wait — deferring remaining episodes.`);
          memoryStop = true;
          break;
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, indices.length) }, () => worker());
    await Promise.all(workers);
    // Episodes never claimed by a worker = deferred by the memory guard (an
    // episode claimed and failed is NOT deferred — it is reported as failed).
    const memoryDeferredCount = memoryStop ? indices.length - nextEpisodeIdx : 0;

    // If season zip was requested and multiple files downloaded, create a Season ZIP archive
    let zipDownloadUrl = "";
    let zipFilename = "";
    let zipSizeMB = 0;
    let zipFilePath = "";

    // Season ZIP packaging is OFF by default (audit 8.16, user decision
    // 2026-08-31): batches deliver one high-speed temp link per episode.
    // Set NEBULA_BATCH_ZIP=1 to restore the all-in-one archive behaviour.
    const batchZipEnabled = process.env.NEBULA_BATCH_ZIP === "1";

    if (batchZipEnabled && downloadedFilePaths.length > 1) {
      updateJobStatus(batchJob.id, "packaging", `📦 Packaging ${downloadedFilePaths.length} episodes into ZIP archive...`);
      try {
        const episodeInputs = generatedLinks.map((item, idx) => ({
          filePath: downloadedFilePaths[idx],
          episodeNumber: item.epNum
        }));

        const zipResult = await BatchZipManager.packageEpisodes({
          episodes: episodeInputs,
          animeTitle: session.animeTitle,
          season: formattedSeason,
          resolution,
          language: lang,
          ttlMinutes: 180,
          namingStyle: "simple",
          batchJobId: batchJob.id,
          cleanupSourceFiles: false // Retain individual files for the individual episode links
        });

        if (zipResult.success) {
          zipDownloadUrl = zipResult.downloadUrl;
          zipFilename = zipResult.zipFilename;
          zipSizeMB = zipResult.sizeMB;
          zipFilePath = zipResult.zipFilePath;
        }
      } catch (err: any) {
        console.warn("[NOVABOX] Batch zip packaging note:", err.message);
      }
    } else if (generatedLinks.length > 0) {
      updateJobStatus(
        batchJob.id,
        "completed",
        memoryDeferredCount > 0 ? `Batch ready (partiel — ${memoryDeferredCount} épisode(s) différé(s) par la garde mémoire)` : "Batch download ready"
      );
    } else {
      updateJobStatus(
        batchJob.id,
        "failed",
        memoryDeferredCount > 0 ? "Memory guard deferred all episodes" : "No streams could be resolved",
        memoryDeferredCount > 0 ? "Pression RAM critique — réessaye dans quelques minutes" : "Aucun épisode téléchargeable (sources indisponibles)"
      );
    }

    await context.react("✅");

    if (generatedLinks.length > 0) {
      // Multi-episode delivery (audit 8.39): ONE offline HTML document with
      // per-episode buttons + "download all" instead of a wall of links the
      // user must tap one by one inside WhatsApp. Falls back to the legacy
      // links message if the document cannot be sent.
      let pageDelivered = false;
      // ZIP mode (NEBULA_BATCH_ZIP=1) is an explicit one-archive request — skip
      // the HTML page then to avoid delivering both (audit 8.41).
      if (generatedLinks.length > 1 && !zipDownloadUrl) {
        try {
          const expiresAt = generatedLinks.reduce(
            (min, g) => (g.expiresAt && (!min || g.expiresAt < min) ? g.expiresAt : min),
            0
          );
          const slug = (session.animeTitle || "anime").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "anime";
          const html = buildDownloadPage({
            title: `${session.animeTitle} — ${session.selectedSeason?.name || formattedSeason}`,
            subtitle: `${lang} · ${resolution} · ${generatedLinks.length} épisodes prêts`,
            entries: generatedLinks.map(g => ({ label: `Épisode ${g.epNum}`, url: g.downloadUrl, sizeMB: g.sizeMB })),
            expiresAt
          });
          await sock.sendMessage(
            msg.key.remoteJid,
            {
              document: Buffer.from(html, "utf-8"),
              mimetype: "text/html",
              fileName: `nebula-${slug}-${(session.selectedSeason?.name || formattedSeason || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "saison"}.html`
            },
            { quoted: msg }
          );
          pageDelivered = true;
          console.log(`[NOVABOX] Delivered offline download page (${generatedLinks.length} links) as HTML document.`);
        } catch (pageErr: any) {
          console.warn("[NOVABOX] HTML download page could not be sent — legacy links message:", pageErr?.message);
        }
      }

      let responseMsg =
        `🚀 *NEBULA NOVABOX - BATCH DOWNLOAD COMPLETED* 🚀\n\n` +
        `🎬 *Anime:* ${session.animeTitle}\n` +
        `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name}\n` +
        `⚙️ *Quality:* ${resolution}\n` +
        `📦 *Ready Episodes:* ${generatedLinks.length}/${indices.length}\n` +
        formatFailedEpisodes(
          indices.map(i => i + 1),
          generatedLinks.map(g => g.epNum)
        ) +
        (memoryDeferredCount > 0
          ? `🛡️ *Garde mémoire:* ${memoryDeferredCount} épisode(s) non lancé(s) pour protéger le bot (pression RAM critique). Les épisodes livrés ci-dessus sont intacts — redemande les épisodes manquants dans quelques minutes.\n`
          : "") +
        `⏳ *Links Validity:* 2 Hours\n\n` +
        (pageDelivered
          ? `📄 *Ouvre le fichier HTML ci-dessus dans Chrome* → un seul bouton *« Tout télécharger »* lance tous les épisodes d'un coup (ou bouton par épisode).\n\n`
          : `📥 *Direct Episode Links:*\n\n` +
            generatedLinks
              .map(g => `• 🎬 *Episode ${g.epNum}:* [${g.sizeMB} MB]\n  🔗 ${g.downloadUrl}`)
              .join("\n\n") + "\n\n");

      if (zipDownloadUrl) {
        responseMsg += 
          `📦 *All-in-One Season ZIP Archive:*\n` +
          `📁 *File:* \`${zipFilename}\` (~${zipSizeMB} MB)\n` +
          (zipSizeMB > 100 
            ? `⚠️ *Exceeds WhatsApp 100MB limit* - Use High-Speed link below:\n🔗 *Download ZIP:* ${zipDownloadUrl}\n\n` 
            : `🔗 *High-Speed Link:* ${zipDownloadUrl}\n\n`);
      }

      responseMsg +=
        pageDelivered && !zipDownloadUrl
          ? `🌌 _Nebula Bot - Your ultimate media center_`
          : `💡 _Click any link above to start instant high-speed download or stream in your browser._\n🌌 _Nebula Bot - Your ultimate media center_`;

      await context.reply(responseMsg);

      // If the ZIP archive is <= 100MB, send it directly to WhatsApp as a document attachment
      if (zipFilePath && fs.existsSync(zipFilePath) && zipSizeMB > 0 && zipSizeMB <= 100) {
        try {
          console.log(`[NOVABOX] Delivering batch ZIP file directly on WhatsApp: "${zipFilePath}" (${zipSizeMB.toFixed(2)} MB)`);
          await sock.sendMessage(msg.key.remoteJid, {
            document: { url: zipFilePath },
            mimetype: "application/zip",
            fileName: zipFilename || `Season_${formattedSeason}.zip`,
            caption: `📦 *${session.animeTitle} - ${session.selectedSeason?.name}* (Full Season ZIP)`
          }, { quoted: msg });
        } catch (zipSendErr: any) {
          console.warn("[NOVABOX] Could not send ZIP document directly on WhatsApp:", zipSendErr.message);
        }
      }

      return;
    } else {
      // Fallback: Generate full batch episode directory with instant high-speed player streaming links exclusively via VidMoly
      const failureNotice =
        memoryDeferredCount > 0
          ? `🛡️ *Garde mémoire:* pression RAM critique — aucun épisode n'a été lancé pour protéger le bot. Redemande dans quelques minutes.\n\n`
          : failedEpisodeCount > 0
          ? `❌ *Téléchargement impossible pour les ${failedEpisodeCount} épisode(s)* — les sources les refusent pour le moment.\n🔁 Réessaie dans quelques minutes. En attendant, voici les liens de lecture :\n\n`
          : "";
      const episodeLinksText = indices.map((idx) => {
        const epN = idx + 1;
        const vUrl = getVidMolyUrl(session.episodes, idx, session.episodeListLabels, session.selectedLanguage);
        let line = `• 🎬 *Episode ${epN}:*\n`;
        if (vUrl) {
          line += `  📺 *Lecteur (${playerSourceLabel(vUrl)}):* ${vUrl}\n`;
        } else {
          line += `  📺 *Lecteur:* Stream ready in app\n`;
        }
        return line.trim();
      }).join("\n\n");

      return await context.reply(
        `${failureNotice}📥 *NEBULA NOVABOX - BATCH EPISODES READY* 📥\n\n` +
        `🎬 *Anime:* ${session.animeTitle}\n` +
        `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name}\n` +
        `⚙️ *Selected Resolution:* ${resolution}\n` +
        `📺 *Official Player:* VidMoly\n` +
        `📦 *Total Episodes:* ${indices.length} episodes\n\n` +
        `🔗 *Official VidMoly Streaming & Download Links:*\n\n` +
        `${episodeLinksText}\n\n` +
        `💡 _Click any episode link above to watch or download directly via VidMoly in full resolution!_\n` +
        `🌌 _Nebula Bot - Your ultimate media center_`
      );
    }
  }

  // --- SINGLE EPISODE DOWNLOAD FLOW ---
  const epIndex = indices[0];
  const epNum = epIndex + 1;
  const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;

  // Formatted filename: [AnimeName]_[Language]_[Resolution]_[Season]_[Episode]
  const filenameBase = `${animeClean}_${lang}_${resolution}_${formattedSeason}_${formattedEpisode}`;
  const filename = sanitizeFilename(filenameBase) + ".mp4";

  const vidmolyUrl = getVidMolyUrl(session.episodes, epIndex, session.episodeListLabels, session.selectedLanguage);

  // React to let the user know we are downloading the video
  await context.react("⏳");
  await context.reply(
    `📥 *Nebula Novabox* - _Direct Media Preparation_\n\n` +
    `🎬 *Anime:* ${session.animeTitle}\n` +
    `🎞️ *Episode:* Episode ${epNum}\n` +
    `⚙️ *Resolution:* ${resolution}\n\n` +
    `⏳ _Downloading and packing stream segments into MP4... This will take about 10-25 seconds._`
  );

  let localPath = path.join(os.tmpdir(), filename);
  let compressedPath = "";
  let downloadSuccess = false;
  let activePlayerName = "Direct Stream";

  // Collect mirror URLs for this episode, split into language tiers so the
  // session language (VF by default when available) is tried first (audit 8.3).
  const { primary: langPrimaryMirrors, secondary: mirrorUrls } = splitMirrorsByLanguage(
    session.episodes || {},
    session.episodeListLabels,
    epIndex,
    session.selectedLanguage || "VOSTFR"
  );

  // Multi-host stream resolution
  let streamToDownload: any = null;
  if (session.selectedVariantUrl) {
    const originMatch = session.selectedVariantUrl.match(/^(https?:\/\/[^/]+)/i);
    const streamOrigin = originMatch ? originMatch[1] : "https://Smoothpre.com";
    streamToDownload = {
      url: session.selectedVariantUrl,
      type: session.selectedVariantUrl.includes('.m3u8') || session.selectedVariantUrl.includes('.txt') ? 'hls' : 'mp4',
      headers: session.selectedVariantHeaders || {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': `${streamOrigin}/`,
        'Origin': streamOrigin
      }
    };
    downloadSuccess = await executeDirectOrFfmpegDownload(streamToDownload, localPath, 240000);
    if (downloadSuccess) {
      try {
        activePlayerName = new URL(session.selectedVariantUrl).hostname.replace(/^www\./, "");
      } catch {}
    }
  }

  // Multi-mirror fallback if direct selected variant failed or wasn't pre-selected
  if (!downloadSuccess && langPrimaryMirrors.length > 0) {
    console.log(`[NOVABOX] Multi-mirror download (${session.selectedLanguage || "VOSTFR"} lists first): ${langPrimaryMirrors.length} mirrors...`);
    const fallbackResult = await downloadWithAllMirrorsFallback(langPrimaryMirrors, resolution, localPath, 240000);
    if (fallbackResult.success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
      downloadSuccess = true;
      if (fallbackResult.hostName) activePlayerName = fallbackResult.hostName;
      console.log(`[NOVABOX] Multi-mirror download fallback succeeded with host: ${fallbackResult.hostName}`);
    }
  }
  if (!downloadSuccess && mirrorUrls.length > 0) {
    console.log(`[NOVABOX] Retrying with the other language mirrors (${mirrorUrls.length})...`);
    const fallbackResult = await downloadWithAllMirrorsFallback(mirrorUrls, resolution, localPath, 240000);
    if (fallbackResult.success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
      downloadSuccess = true;
      if (fallbackResult.hostName) activePlayerName = fallbackResult.hostName;
      console.log(`[NOVABOX] Cross-language mirror fallback succeeded with host: ${fallbackResult.hostName}`);
    }
  }

  // Fallback to legacy VidMoly resolution if needed
  if (!downloadSuccess) {
    console.log(`[NOVABOX] Direct download failed. Attempting legacy VidMoly fallback resolution lookup...`);
    const resolved = await resolveEpisodeStream(session.episodes || {}, epIndex);
    let downloadSourceUrl = resolved.refererUrl;
    let originUrl = resolved.originUrl;
    let targetHlsUrl = resolved.hlsUrl;
    console.log(`[NOVABOX] Legacy VidMoly Resolved HLS: "${targetHlsUrl}", Referer: "${downloadSourceUrl}", Origin: "${originUrl}"`);

    if (targetHlsUrl) {
      let isMasterTxt = false;
      try {
        isMasterTxt = !!targetHlsUrl && new URL(targetHlsUrl).pathname.endsWith("master.txt");
      } catch {
        isMasterTxt = !!targetHlsUrl && targetHlsUrl.includes("master.txt");
      }

      if (isMasterTxt) {
        if (resolution === "360P" || resolution === "480P") {
          targetHlsUrl = resolveAbsoluteUrl(targetHlsUrl, "index-f1-v1-a1.txt");
        } else if (resolution === "720P") {
          targetHlsUrl = resolveAbsoluteUrl(targetHlsUrl, "index-f2-v1-a1.txt");
        } else if (resolution === "1080P") {
          targetHlsUrl = resolveAbsoluteUrl(targetHlsUrl, "index-f3-v1-a1.txt");
        }
      }
      // Multi-quality urlset masters 403 on some CDN nodes while their variant
      // paths answer with the right referer — resolve the pair here too (the
      // mirror path already does it at extraction time; audit 8.44).
      if (targetHlsUrl.includes(".urlset/")) {
        try {
          const resolvedUrlset = await resolveVidmolyUrlset(targetHlsUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": downloadSourceUrl,
            "Origin": originUrl
          });
          if (resolvedUrlset) {
            targetHlsUrl = resolvedUrlset.mediaPlaylistUrl;
            if (resolvedUrlset.headers.Referer) downloadSourceUrl = resolvedUrlset.headers.Referer;
            if (resolvedUrlset.headers.Origin) originUrl = resolvedUrlset.headers.Origin;
          }
        } catch {}
      }
      console.log(`[NOVABOX] Final target sub-playlist URL for download: "${targetHlsUrl}"`);
      downloadSuccess = await executeFfmpegDownload(targetHlsUrl, downloadSourceUrl, originUrl, localPath, 240000);
      console.log(`[NOVABOX] Legacy VidMoly ffmpeg download finished. Success: ${downloadSuccess}`);
      if (!downloadSuccess) markDeadFileSlug(targetHlsUrl);
    }
  }

  // 8.69: mono-source strict — the cross-source fallback is GONE. The
  // delivered language is the requested one, period.
  const deliveredLang = lang;
  const fbLanguageNote = "";
  const deliveredFilename = filename;

  // Clear user session to free memory
  clearUserSession(context.sender);

  let activeSendPath = localPath;

  if (downloadSuccess && fs.existsSync(localPath)) {
    // 8.63: assigned inside try once the shared caption builder exists.
    let fallbackCaption = "";
    try {
      let stats = fs.statSync(localPath);
      let fileSizeMB = stats.size / (1024 * 1024);
      console.log(`[NOVABOX] Downloaded raw file size: ${fileSizeMB.toFixed(2)} MB`);

      // Auto-compress ONLY when the raw file exceeds the 100 MB WhatsApp
      // document ceiling (95-100 MB sends fine as a document — transcoding
      // there was a pure time sink, audit 8.5). x264 veryfast + all cores.
      let fitOptions: string[] | null = null;
      let shouldCompress =
        fileSizeMB > 100 &&
        (session.forceCompress || resolution === "480P" || resolution === "360P" || resolution.includes("Compress"));

      if (shouldCompress) {
        // A source already at/below 480p cannot meaningfully shrink by
        // re-encoding to 480p — the 2-minute encode just times out (production
        // log: 121.8s wasted) before the raw high-speed-link delivery anyway.
        const probed = await probeVideoInfo(localPath);
        if (compressionPointless(probed.height, 480)) {
          shouldCompress = false;
          console.log(`[NOVABOX] Source is already ${probed.height}p — compression skipped, delivering via high-speed link.`);
        } else {
          // Deterministic WhatsApp fit (audit 8.48): compute the bitrate that
          // lands the output under the ceiling instead of CRF-26-and-hope.
          // 92 MB target keeps a safety margin under the ~95-100 MB cap.
          const fit = whatsappFitVideoOptions(probed.durationSec, 92, 480);
          if (fit) {
            fitOptions = fit.options;
            console.log(`[NOVABOX] Deterministic WhatsApp fit: ${fit.videoKbps} kbps → ${fit.note}.`);
          }
        }
      }

      if (shouldCompress) {
        const tComp = Date.now();
        console.log(`[NOVABOX] Compressing ${fileSizeMB.toFixed(1)} MB -> 480p (veryfast) to fit WhatsApp limits...`);
        await context.reply(`🔄 *Compressing media for WhatsApp direct delivery...* (Target: < 95 MB)\n_This ensures smooth playable video in chat._`);
        compressedPath = path.join(os.tmpdir(), "comp_" + filename);
        
        try {
          // Audit 8.48: when the duration probe succeeded, splice the
          // deterministic WhatsApp-fit args (computed bitrate + maxrate) in
          // place of the legacy fixed CRF 26 — the output size is then a
          // mathematical certainty instead of a coin flip.
          const ffmpegArgs = [
            "-y",
            "-threads",
            "0",
            "-i",
            localPath,
            ...(fitOptions || ["-vf", "scale=-2:480", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast"]),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            compressedPath
          ];

          await new Promise<void>((resolve, reject) => {
            const proc = spawn(resolvedFfmpegPath, ffmpegArgs, { stdio: "ignore" });
            const timer = setTimeout(() => {
              try { proc.kill("SIGKILL"); } catch {}
              reject(new Error("FFmpeg compression timed out"));
            }, 120000);

            proc.on("close", (code) => {
              clearTimeout(timer);
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg exited with code ${code}`));
            });

            proc.on("error", (err) => {
              clearTimeout(timer);
              reject(err);
            });
          });

          if (fs.existsSync(compressedPath)) {
            const compStats = fs.statSync(compressedPath);
            if (compStats.size > 0 && compStats.size < stats.size) {
              activeSendPath = compressedPath;
              fileSizeMB = compStats.size / (1024 * 1024);
              console.log(
                `[NOVABOX] Compression OK: ${(compStats.size / 1048576).toFixed(2)} MB in ${((Date.now() - tComp) / 1000).toFixed(1)}s`
              );
            } else {
              console.warn(`[NOVABOX] Compression produced no smaller file (${(compStats.size / 1048576).toFixed(1)} MB) in ${((Date.now() - tComp) / 1000).toFixed(1)}s — sending raw`);
            }
          }
        } catch (compErr: any) {
          console.warn(`[NOVABOX] Compression failed/skipped after ${((Date.now() - tComp) / 1000).toFixed(1)}s: ${compErr?.message || compErr} — sending raw file`);
        }
      }

      if (session.pipelineStartedAt) {
        console.log(`[NOVABOX] Pipeline total so far (players+scan+download${shouldCompress ? "+compress" : ""}): ${((Date.now() - session.pipelineStartedAt) / 1000).toFixed(1)}s`);
      }

      // Move file into managed temporary store so the download link remains valid for 2 hours
      let tempDownload: any = null;
      try {
        tempDownload = registerTempDownload(activeSendPath, deliveredFilename, {
          ttlMinutes: 120,
          moveFile: true
        });
        if (tempDownload && tempDownload.filePath) {
          activeSendPath = tempDownload.filePath;
        }
      } catch (tErr: any) {
        console.warn("[NOVABOX] Temp download registration note:", tErr.message);
      }

      const tempDownloadLink = tempDownload ? tempDownload.downloadUrl : "";

      // 8.63 (M2 tranche 1): shared caption builder — the success and the
      // delivery-error captions previously duplicated these lines; keeping
      // ONE source of truth so language honesty edits cannot drift apart.
      const captionHead =
        `📥 *NEBULA NOVABOX DOWNLOAD* 📥\n\n` +
        `🎬 *Anime:* ${session.animeTitle}\n` +
        `🗣️ *Language:* ${deliveredLang}${fbLanguageNote}\n` +
        `📅 *Season:* ${session.selectedSeason?.name}\n` +
        `🎞️ *Episode:* Episode ${epNum}\n` +
        `⚙️ *Resolution:* ${resolution}\n`;
      const captionTail = (highSpeedLink: string) =>
        `📺 *Player Source:* ${activePlayerName}\n` +
        `📄 *Filename:* \`${deliveredFilename}\`\n\n` +
        (highSpeedLink ? `🚀 *Direct High-Speed Download (Browser/PC):*\n🔗 ${highSpeedLink}\n⏳ _Valid for 2 Hours_\n\n` : "") +
        (vidmolyUrl ? `• 📺 *Play Ad-Free (${playerSourceLabel(vidmolyUrl)}):* ${vidmolyUrl}\n` : "") +
        `\n🌌 _Nebula Bot - Your ultimate media center_`;

      const caption = captionHead + `📦 *Size:* ${fileSizeMB.toFixed(1)} MB\n` + captionTail(tempDownloadLink);
      fallbackCaption = captionHead + captionTail("");

      const tSend = Date.now();
      const logSendDone = (lane: string) =>
        console.log(`[NOVABOX] WhatsApp ${lane} send resolved in ${((Date.now() - tSend) / 1000).toFixed(1)}s`);
      if (fileSizeMB <= 60) {
        // Send as a direct playable video in chat
        console.log(`[NOVABOX] Delivering direct video file in chat: "${activeSendPath}" (${fileSizeMB.toFixed(2)} MB)`);
        await sock.sendMessage(msg.key.remoteJid, {
          video: { url: activeSendPath },
          caption: caption,
          mimetype: "video/mp4"
        }, { quoted: msg });
        logSendDone("video");
      } else if (fileSizeMB <= 100) {
        // Send caption first
        await context.reply(caption);
        // Send as standard document so it delivers without size degradation
        console.log(`[NOVABOX] Delivering video as document attachment: "${activeSendPath}" (${fileSizeMB.toFixed(2)} MB)`);
        await sock.sendMessage(msg.key.remoteJid, {
          document: { url: activeSendPath },
          mimetype: "video/mp4",
          fileName: deliveredFilename
        }, { quoted: msg });
        logSendDone("document");
      } else {
        // File exceeds WhatsApp 100MB direct attachment limit
        if (tempDownloadLink) {
          await context.reply(
            `🚀 *TEMPORARY HIGH-SPEED DOWNLOAD LINK* 🚀\n\n` +
            `⚠️ *File Size:* ${fileSizeMB.toFixed(1)} MB (Exceeds WhatsApp 100MB limit)\n` +
            `⏳ *Link Validity:* 2 Hours (Auto-expires)\n` +
            `🎬 *Anime:* ${session.animeTitle}\n` +
            `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name} - Ep ${epNum}\n` +
            `⚙️ *Quality:* ${resolution}\n` +
            `📄 *File:* \`${filename}\`\n\n` +
            `🔗 *Secure Download Link:*\n` +
            `${tempDownloadLink}\n\n` +
            `💡 _Click the link to download directly at full speed or stream in your browser._\n\n` +
            caption
          );
        } else {
          await context.reply(
            `⚠️ *File is too large (${fileSizeMB.toFixed(1)} MB) to send directly via WhatsApp (limit is 100MB).* Here are your streaming & download links:\n\n` + caption
          );
        }
      }

      await context.react("✅");
    } catch (sendErr: any) {
      console.error("[NOVABOX] Delivery error:", sendErr);
      await context.reply(
        `❌ *Impossible d\u2019envoyer le fichier — voici les liens de lecture à la place :*\n\n` + fallbackCaption
      );
    } finally {
      // Cleanup raw local temp files if they still exist and were not moved into temp download manager
      if (fs.existsSync(localPath) && localPath !== activeSendPath) {
        try {
          fs.unlinkSync(localPath);
        } catch {}
      }
      if (compressedPath && fs.existsSync(compressedPath) && compressedPath !== activeSendPath) {
        try {
          fs.unlinkSync(compressedPath);
        } catch {}
      }
    }
  } else {
    const caption = 
      `📥 *NEBULA NOVABOX DOWNLOAD* 📥\n\n` +
      `🎬 *Anime:* ${session.animeTitle}\n` +
      `🗣️ *Language:* ${lang}\n` +
      `📅 *Season:* ${session.selectedSeason?.name}\n` +
      `🎞️ *Episode:* Episode ${epNum}\n` +
      `⚙️ *Resolution:* ${resolution}\n` +
      `📺 *Player Source:* ${activePlayerName}\n` +
      `📄 *Filename:* \`${filename}\`\n\n` +
      (vidmolyUrl ? `• 📺 *Play Ad-Free (${playerSourceLabel(vidmolyUrl)}):* ${vidmolyUrl}\n` : "") +
      `\n🌌 _Nebula Bot - Your ultimate media center_`;

    // If download failed or file doesn't exist, fallback to sending streaming links
    await context.react("✅");
    await context.reply(
      `⚠️ *Le téléchargement direct est momentanément indisponible.*\nVoici tes liens de lecture :\n\n` + caption
    );
  }

  // 8.51: single-episode pipelines churn ~2x episode size in Buffers too —
  // run the same headroom check as the batch worker so sequential single
  // downloads across a long session also give the kernel room to reclaim.
  // (The batch path returns above — its guard runs per episode instead.)
  await enforceMemoryHeadroom(`single E${String(epNum).padStart(2, "0")} done`);
}


export default animeCommand;
