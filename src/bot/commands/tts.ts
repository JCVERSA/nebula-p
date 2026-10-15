import { BotCommand } from "../types.js";
import { synthesizeVoiceNote, validateTtsText, TTS_MAX_TEXT_CHARS } from "../services/ttsService.js";
import { checkWebQuota, consumeWebQuota } from "../webQuota.js";

/**
 * `.tts` — lire un texte en note vocale (9.18dd, P6 du plan owner).
 *
 *   .tts Bonjour, ceci est une voix de synthèse
 *   .tts  (en répondant à un message) → lit le message cité
 *   « lis-moi ça » (agent, en reply) → route ici
 *
 * Moteur : voix neuronale Microsoft Edge via msedge-tts (sans clé),
 * transcodage ffmpeg → ogg/opus, envoi ptt (note vocale). Quota web
 * (lectures/jour) — ce n'est pas un appel IA. Nettoyage du formatage
 * WhatsApp avant lecture (sanitizeTtsText). Erreurs honnêtes : service
 * voix indisponible, conversion impossible, quota, texte vide/trop long.
 */

function quotedTextOf(msg: any): string {
  try {
    const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    return String(quoted?.conversation || quoted?.extendedTextMessage?.text || "").trim();
  } catch {
    return "";
  }
}

const ttsCommand: BotCommand = {
  name: "tts",
  aliases: ["voix", "dis"],
  category: "AI",
  description: "Lire un texte en note vocale (par reply à un message, ou .tts <texte>).",
  usage: ".tts <texte> — ou réponds à un message avec .tts",
  execute: async (sock, msg, context) => {
    const fromArgs = (context.args || []).join(" ").trim();
    const quoted = quotedTextOf(msg);
    const raw = fromArgs || quoted;

    if (!raw) {
      return void (await context.reply(
        "🔊 *Lecture à voix haute*\n\n" +
        "• `.tts Bonjour, ceci est une voix de synthèse`\n" +
        "• Réponds à un message avec `.tts` — je le lis\n\n" +
        `_Jusqu'à ${TTS_MAX_TEXT_CHARS} caractères · voix française._`
      ));
    }

    const check = validateTtsText(raw);
    if (!check.ok) {
      return void (await context.reply(
        check.reason === "too_long"
          ? `⚠️ Texte trop long pour la lecture (${TTS_MAX_TEXT_CHARS} caractères max — le message cité dépasse).`
          : "❌ Il n'y a rien à lire (le message cité ne contient pas de texte, ou seulement des liens)."
      ));
    }

    const quota = checkWebQuota(context.sender);
    if (!quota.allowed) {
      return void (await context.reply(`📅 *Limite du jour atteinte* (${quota.limit} lectures/recherches par jour).\n_Réessaie demain._`));
    }

    await context.react("🔊");
    try {
      const ogg = await synthesizeVoiceNote(raw);
      consumeWebQuota(context.sender);
      await sock.sendMessage(
        context.sender,
        { audio: ogg, mimetype: "audio/ogg; codecs=opus", ptt: true },
        { quoted: msg }
      );
    } catch (error: any) {
      console.error("[TTS] Error:", error?.message || error);
      const reason = /rien à lire|vide/.test(error?.message || "")
        ? "_Le texte ne contient rien de lisible._"
        : /trop long/.test(error?.message || "")
          ? "_Texte trop long._"
          : /timeout/i.test(error?.message || "")
            ? "_La synthèse a mis trop de temps — réessaie._"
            : "_Le service vocal est momentanément indisponible._";
      await context.reply(`❌ *Lecture impossible.*\n${reason}`);
    }
  },
};

export default ttsCommand;
