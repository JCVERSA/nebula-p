import axios from "axios";
import { BotCommand } from "../types.js";

/**
 * `.trace` — anime scene reverse-search via trace.moe (owner approval 8.65→8.66).
 *
 * Viability probed from the production VPS (npm run api:probe): keyless,
 * HTTP 200, monthly quota displayed by the probe. The quota is small
 * (~100/month observed for this IP), so the command is deliberately
 * protective: per-user cooldown, one search per invocation, quota-aware
 * error handling, and the remaining quota is logged after each call.
 *
 * UX: reply to an anime screenshot with `.trace` (quoted-media fallback is
 * provided by the engine's downloadMedia, audit 8.48). Messages follow the
 * 8.58 policy (simple French; technical detail goes to the logs).
 */

interface TraceMoeMatch {
  anime?: { title?: string; title_english?: string; anilist_id?: number; mal_id?: number; isAdult?: boolean };
  episode?: number | number[];
  from?: number;
  to?: number;
  similarity?: number;
}

function fmtTimestamp(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !isFinite(seconds) || seconds < 0) return "?";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Formats a trace.moe /search payload into the WhatsApp reply. Null = nothing reliable. */
export function formatTraceResult(data: any): string | null {
  const results: TraceMoeMatch[] = Array.isArray(data?.result) ? data.result : [];
  if (results.length === 0) return null;
  const best = results[0];
  const similarity = typeof best.similarity === "number" ? best.similarity : 0;
  if (similarity < 0.4) return null; // below 40% the match is noise, not an answer

  const title = best.anime?.title_english && best.anime.title_english !== best.anime?.title
    ? `${best.anime?.title ?? "?"} (${best.anime.title_english})`
    : best.anime?.title ?? "Titre inconnu";
  const episode = Array.isArray(best.episode) ? best.episode.join(", ") : best.episode;

  let text = `🔍 *Origine de l'image trouvée !*\n\n`;
  text += `🎬 *${title}*\n`;
  if (episode) text += `📺 Épisode : *${episode}*\n`;
  text += `⏱️ Moment : *${fmtTimestamp(best.from)}* (extrait jusqu'à ${fmtTimestamp(best.to)})\n`;
  text += `🎯 Similarité : *${Math.round(similarity * 100)}%*\n`;
  if (best.anime?.anilist_id) text += `🔗 Fiche : https://anilist.co/anime/${best.anime.anilist_id}\n`;

  if (results.length > 1) {
    const others = results
      .slice(1, 3)
      .filter(r => (r.similarity || 0) >= 0.4)
      .map(r => `• ${r.anime?.title ?? "?"} (${Math.round((r.similarity || 0) * 100)}%)`);
    if (others.length) text += `\n_Autres possibilités :_\n${others.join("\n")}\n`;
  }
  return text;
}

/** True when trace.moe tells us the monthly quota is exhausted (429/402). */
export function isQuotaExhausted(err: any): boolean {
  const status = err?.response?.status;
  return status === 429 || status === 402;
}

// Per-user cooldown (protects the small shared monthly quota).
const lastCallByUser = new Map<string, number>();
const COOLDOWN_MS = 20_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const traceCommand: BotCommand = {
  name: "trace",
  aliases: ["tracemoe"],
  category: "Anime",
  description: "Identifier l'anime d'une image (réponds à l'image).",
  usage: ".trace (en répondant à une image)",
  execute: async (_sock, _msg, context) => {
    try {
      const image = context.downloadMedia ? await context.downloadMedia() : null;
      if (!image || image.length < 1000) {
        return void (await context.reply("🖼️ Réponds à une *image* d'anime avec `.trace` et je te dirai de quel anime/épisode elle vient."));
      }
      if (image.length > MAX_IMAGE_BYTES) {
        return void (await context.reply("⚠️ Image trop lourde — envoie une capture plus légère."));
      }

      const last = lastCallByUser.get(context.sender) || 0;
      if (Date.now() - last < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
        return void (await context.reply(`⏳ Patiente ${wait} s entre deux recherches.`));
      }
      lastCallByUser.set(context.sender, Date.now());
      if (lastCallByUser.size > 500) lastCallByUser.clear(); // bound the map
      await context.react("🔍");

      const res = await axios.post("https://api.trace.moe/search", image, {
        headers: { "Content-Type": "image/jpeg" },
        timeout: 30000,
        validateStatus: () => true,
      });

      if (res.status !== 200) {
        const err: any = { response: { status: res.status } };
        if (isQuotaExhausted(err)) {
          console.warn(`[TRACE] Quota mensuel trace.moe épuisé (HTTP ${res.status}).`);
          return void (await context.reply("🚫 La limite mensuelle de recherches est atteinte — reviens le mois prochain."));
        }
        console.warn(`[TRACE] HTTP ${res.status} from trace.moe`);
        return void (await context.reply("❌ La recherche a échoué.\n🔄 Réessaie dans un instant."));
      }

      const text = formatTraceResult(res.data);
      if (!text) {
        return void (await context.reply("😕 Aucune correspondance fiable pour cette image — essaie une capture plus nette (visage ou plan large)."));
      }
      await context.reply(text);

      // Remaining quota → logs only (admin visibility, no user noise).
      try {
        const me = await axios.get("https://api.trace.moe/me", { timeout: 8000, validateStatus: () => true });
        const quota = (me.data as any)?.user?.quota ?? (me.data as any)?.quota;
        if (typeof quota === "number") console.log(`[TRACE] Quota trace.moe restant ce mois : ${quota}`);
      } catch {}
    } catch (error: any) {
      console.error("[TRACE] Error:", error?.message || error);
      await context.reply("❌ La recherche a échoué.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default traceCommand;
