import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";
import { extractInstagramMedia, instagramShortcode } from "../services/instagramExtractor.js";
import {
  igReuseKey,
  lookupMediaReuse,
  storeMediaReuse,
  SOCIAL_REUSE_TTL_MS
} from "../services/mediaReuseStore.js";
import { registerTempDownload, getLinkTtlMinutes } from "../tempDownloadManager.js";
import { fetchMediaToTempFile, registerMediaLink } from "../services/mediaLinkDelivery.js";
import { createProgressReporter, type ProgressSendFn } from "../services/progressMessenger.js";
import { resolveLiveSocket } from "../liveSocket.js";

/**
 * `.instagram` — portage natif de l'original neb (media/instagram.js, owner
 * request 8.59) : scraper npm `ruhend-scraper` (igdl puis igdl2, chaîne
 * 9.18p), dédoublonnage par URL exacte, max 20 médias, délai 1 s entre
 * envois. Si les deux backends tiers échouent : extracteur maison
 * (instagramExtractor.ts — embed public + API web Instagram). Messages FR,
 * import dynamique (le paquet n'a pas de types).
 */

interface IgdlMedia { url?: string; type?: string }
type Igdl = (url: string) => Promise<{ data?: IgdlMedia[] }>;

/** 9.18r : mémoire du dernier backend qui a réussi — essayé en premier ensuite. */
let lastWorkingIgBackend: "igdl" | "igdl2" | null = null;

/** Pur : ordre d'essai des backends (le gagnant récent d'abord). */
export function orderIgBackends(last: "igdl" | "igdl2" | null): Array<"igdl" | "igdl2"> {
  return last === "igdl2" ? ["igdl2", "igdl"] : ["igdl", "igdl2"];
}

const processedMessages = new Set<string>();

function extractUniqueMedia(mediaData: IgdlMedia[]): IgdlMedia[] {
  const unique: IgdlMedia[] = [];
  const seen = new Set<string>();
  for (const media of mediaData) {
    if (!media.url) continue;
    if (!seen.has(media.url)) {
      seen.add(media.url);
      unique.push(media);
    }
  }
  return unique;
}

const instagramCommand: BotCommand = {
  name: "instagram",
  acceptsUrlArgs: true, // 9.3b — le guardrail agent préserve les URLs ici
  aliases: ["ig", "insta", "igdl", "reels"],
  category: "Media",
  description: "Télécharger photos / vidéos / reels Instagram.",
  usage: ".instagram <lien Instagram>",
  execute: async (sock, msg, context) => {
    try {
      const chatId = msg.key.remoteJid!;

      if (msg.key.id && processedMessages.has(msg.key.id)) return;
      if (msg.key.id) {
        processedMessages.add(msg.key.id);
        setTimeout(() => processedMessages.delete(msg.key.id!), 5 * 60 * 1000);
      }

      const args = context.args || [];
      const text = args.join(" ").trim();
      if (!text) {
        return void (await context.reply("Envoie un lien Instagram pour la vidéo."));
      }

      const instagramPatterns = [
        /https?:\/\/(?:www\.)?instagram\.com\//,
        /https?:\/\/(?:www\.)?instagr\.am\//,
        /https?:\/\/(?:www\.)?instagram\.com\/p\//,
        /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
        /https?:\/\/(?:www\.)?instagram\.com\/tv\//
      ];
      if (!instagramPatterns.some(p => p.test(text))) {
        return void (await context.reply("Ce lien n'est pas valide — envoie un lien de post, reel ou vidéo Instagram."));
      }

      await sock.sendMessage(chatId, { react: { text: "📥", key: msg.key } });
      await context.reply("📥 *Téléchargement...* ⏳ Patiente quelques secondes.");

      // 9.18p (retour terrain reel DeZL1mfhKjw) : chaîne de repli à 3 étages.
      // igdl et igdl2 sont les deux backends obfusqués du paquet (sites
      // tiers snapsave/fapper — muets le jour où ces sites changent leur
      // HTML) ; l'extracteur maison (embed public + API web Instagram,
      // zéro site tiers) ferme la marche en filet de sécurité.
      // 8.84 (audit commandes C5) : le scraper n'a aucun timeout intégré —
      // sans cette borne, un appel qui pend bloquait la commande indéfiniment.
      const mod = (await import("ruhend-scraper")) as unknown as { igdl: Igdl; igdl2: Igdl };
      const withTimeout = (p: Promise<{ data?: IgdlMedia[] }>, label: string) =>
        Promise.race([
          p,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), 30000)),
        ]);

      let scrapedMedia: IgdlMedia[] = [];
      let mediaSource = "";
      const backends = orderIgBackends(lastWorkingIgBackend); // 9.18r : le gagnant récent d'abord
      for (const label of backends) {
        const fn = label === "igdl" ? mod.igdl : mod.igdl2;
        try {
          const data = await withTimeout(fn(text), label);
          if (data?.data?.length) {
            scrapedMedia = data.data;
            mediaSource = label;
            lastWorkingIgBackend = label;
            break;
          }
          console.warn(`[IG] ${label}: no media (backend tiers indisponible ou muet)`);
        } catch (err: any) {
          console.warn(`[IG] ${label} failed: ${err?.message || err}`);
        }
      }

      if (!scrapedMedia.length) {
        try {
          const own = await extractInstagramMedia(text);
          if (own && own.items.length) {
            scrapedMedia = own.items;
            mediaSource = `extractor:${own.strategy}`;
          }
        } catch (err: any) {
          console.warn(`[IG] extractor failed: ${err?.message || err}`);
        }
      }

      if (!scrapedMedia.length) {
        return void (await context.reply(
          "❌ Aucun média trouvé — le post est peut-être privé, le lien invalide, ou Instagram limite le serveur _(réessaie dans quelques minutes)_."
        ));
      }
      console.log(`[IG] media source: ${mediaSource} (${scrapedMedia.length} item(s))`);

      const mediaToDownload = extractUniqueMedia(scrapedMedia).slice(0, 20);
      if (!mediaToDownload.length) {
        return void (await context.reply("❌ Aucun média valide trouvé — post privé ou scraper indisponible."));
      }

      const collectedLinks: Array<{ url: string; cached: boolean }> = [];
      // 9.18s : nom lisible — reel_<shortcode> (au lieu d'instagram_<timestamp>).
      const shortcode = instagramShortcode(text) || `${Date.now()}`;

      // 9.18hhhh — tableau de bord LIVE DIFFÉRÉ du carrousel/reel : le
      // premier message n'apparaît qu'après 4 s (règle « pas de barre
      // éclair »), puis s'édite sur place, média par média.
      const sendIgProgress: ProgressSendFn = async (igText: string, editKey?: unknown) => {
        const target = resolveLiveSocket(sock);
        if (!target) throw new Error("no live socket");
        return await target.sendMessage(
          chatId,
          editKey ? { text: igText, edit: editKey as any } : { text: igText },
          { quoted: msg }
        );
      };
      const igProgress = createProgressReporter({
        send: sendIgProgress,
        title: `📸 Instagram — ${shortcode}${mediaToDownload.length > 1 ? ` (${mediaToDownload.length} médias)` : ""}`,
        initialPhaseLabel: "Téléchargement",
        firstSendDelayMs: 4000
      });
      if (mediaToDownload.length > 1) igProgress.startBatch(mediaToDownload.length);

      for (let i = 0; i < mediaToDownload.length; i++) {
        try {
          const media = mediaToDownload[i];
          const mediaUrl = media.url!;
          const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaUrl) ||
            media.type === "video" ||
            text.includes("/reel/") ||
            text.includes("/tv/");

          // 9.18r : téléchargement local + lien durable (repli : URL distante).
          // 9.18t : cache 5 h par média — un reel redemandé repart du disque,
          // zéro re-téléchargement (même principe que le cache anime 24 h).
          const ext = isVideo ? ".mp4" : ".jpg";
          const base = `${isVideo ? "reel" : "post"}_${shortcode}`;
          const linkName = mediaToDownload.length > 1 ? `${base}_${i + 1}${ext}` : `${base}${ext}`;
          const cacheKey = igReuseKey(shortcode, i);
          let sendPath = mediaUrl;
          let servedFromCache = false;
          const cachedHit = cacheKey ? lookupMediaReuse(cacheKey) : null;
          if (cachedHit) {
            try {
              const rec = registerTempDownload(cachedHit.filePath, linkName, { noCopy: true });
              if (rec?.filePath) {
                sendPath = rec.filePath;
                collectedLinks.push({ url: rec.downloadUrl, cached: true });
                servedFromCache = true;
              }
            } catch {}
          }
          if (!servedFromCache) {
            const mediaIndex = i + 1;
            const local = await fetchMediaToTempFile(mediaUrl, (received, total) => {
              const pct = total > 0 ? Math.min(100, (received / total) * 100) : null;
              if (mediaToDownload.length > 1) {
                igProgress.updateBatchItem(mediaIndex, pct !== null ? pct / 100 : 0, `Média ${mediaIndex}`);
              } else {
                igProgress.update({ percent: pct, bytesDone: received });
              }
            });
            if (local) {
              const rec = registerMediaLink(local, linkName);
              if (rec) {
                sendPath = rec.filePath;
                if (cacheKey) {
                  try { storeMediaReuse(cacheKey, rec.filePath, linkName, { ttlMs: SOCIAL_REUSE_TTL_MS }); } catch {}
                }
                collectedLinks.push({ url: rec.downloadUrl, cached: false });
              } else {
                sendPath = local; // quota du store atteint : fichier local, sans lien
              }
            }
          }

          if (isVideo) {
            await sock.sendMessage(chatId, {
              video: { url: sendPath },
              mimetype: "video/mp4",
              caption: `*DOWNLOADED BY ${getConfig().botName.toUpperCase()}*`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(chatId, {
              image: { url: sendPath },
              caption: `*DOWNLOADED BY ${getConfig().botName.toUpperCase()}*`
            }, { quoted: msg });
          }

          if (i < mediaToDownload.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (mediaError) {
          console.error(`[IG] media ${i + 1} failed:`, mediaError);
        } finally {
          // 9.18hhhh — média TRAITÉ (envoyé, caché ou échoué) : la barre
          // globale du carrousel avance dans tous les cas.
          if (mediaToDownload.length > 1) igProgress.completeBatchItem(i + 1);
        }
      }
      await igProgress.finish();

      // 9.18r : UN SEUL message avec tous les liens — fini les .up manuels
      // (retour terrain 14/10 : sept .up à la main pour sept reels).
      if (collectedLinks.length) {
        const anyCached = collectedLinks.some((l) => l.cached);
        await context.reply(
          `🔗 *Liens de téléchargement* (${collectedLinks.length})\n` +
          `⏳ Valables ${getLinkTtlMinutes()} min après chaque téléchargement (max 2 h)\n` +
          (anyCached ? `⚡ _Marqué déjà en cache (5 h) — aucun re-téléchargement_\n` : "") +
          `\n` +
          collectedLinks.map((l, i) => `${i + 1}. ${l.cached ? "⚡ " : ""}${l.url}`).join("\n")
        );
      }
    } catch (error) {
      console.error("[IG] Error:", error);
      await context.reply("❌ Erreur lors du traitement du lien Instagram.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default instagramCommand;
