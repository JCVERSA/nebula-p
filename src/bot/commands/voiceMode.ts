import { BotCommand } from "../types.js";
import { setVoiceMode, isVoiceModeEnabled } from "../services/voiceModeStore.js";

/**
 * `.on` / `.off` — mode vocal de l'agent (9.18ii, P6b, décisions owner
 * 15/10 : conversationnel uniquement, ≤ 500 chars, voix Henri).
 *
 *   .on  → les réponses conversationnelles de l'agent (réponses, questions,
 *          explications, rattrapage) arrivent en note vocale dans CE chat
 *   .off → retour au texte
 *
 * Les livraisons (liens de téléchargement), écrans de sélection et messages
 * système restent TOUJOURS en texte (recherche UX : un lien ne se lit pas à
 * voix, une liste non plus). Réglage par chat, aucune dépendance nouvelle
 * (chaîne .tts existante), repli texte automatique si la voix échoue.
 */

const onCommand: BotCommand = {
  name: "on",
  category: "AI",
  description: "Active les réponses vocales de l'agent dans ce chat (voix Henri).",
  usage: ".on",
  execute: async (_sock, _msg, context) => {
    setVoiceMode(context.sender, true);
    const already = isVoiceModeEnabled(context.sender);
    await context.reply(
      already
        ? "🎙️ *Mode vocal activé* — mes réponses arrivent en note vocale, avec la *voix naturelle Gemini* (dans la limite du jour, repli : Henri).\n\n_Les liens et listes restent en texte — un lien ne s'écoute pas. Désactiver : `.off`._"
        : "❌ Impossible d'activer le mode vocal — réessaie dans un instant."
    );
  },
};

const offCommand: BotCommand = {
  name: "off",
  category: "AI",
  description: "Désactive les réponses vocales de l'agent (retour au texte).",
  usage: ".off",
  execute: async (_sock, _msg, context) => {
    setVoiceMode(context.sender, false);
    await context.reply("💬 *Mode vocal désactivé* — je réponds en texte.");
  },
};

export { onCommand, offCommand };
export default onCommand;
