import { BotCommand } from "../types.js";
import { generateTextWithFallback, isAIConfigured } from "../geminiClient.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "../aiQuota.js";

/**
 * `.trad` — traduction one-shot (9.18u, décision owner 14/10 après analyse
 * de google-gemma/gemma-translator : leur code ne nous servait à rien —
 * web app autour de l'API Gemma — mais l'idée révélait un trou : aucune
 * commande de traduction, utile pour des utilisateurs bilingues FR/EN
 * (annales GCE en anglais).
 *
 * Usage :
 *   .trad en Bonjour tout le monde     → traduit vers l'anglais
 *   .trad The mitochondrion is...      → cible par défaut : FRANÇAIS
 *   .trad en  (en répondant à un msg)  → traduit le message cité
 *
 * Note : l'alias court `.tr` était déjà pris par `.upload` (inventaire
 * 8.59) — nom primaire `trad`, aliases translate/traduis/tl.
 *
 * Implémentation : un SEUL appel IA via le moteur primaire + repli
 * (generateTextWithFallback — NIM puis Gemini, comme l'agent), quota IA
 * identique au chat (40/j), zéro nouvelle dépendance, zéro clé.
 */

/** Langues cibles supportées (code saisi → nom pour le prompt). */
const LANGS: Record<string, string> = {
  fr: "français",
  en: "anglais",
  es: "espagnol",
  de: "allemand",
  it: "italien",
  pt: "portugais",
  ar: "arabe",
  ja: "japonais",
  ko: "coréen",
  zh: "chinois",
  ru: "russe",
  hi: "hindi"
};

/** Cap du texte à traduire — même ordre de grandeur que les tours IA. */
const MAX_TEXT_CHARS = 1500;

export interface TranslateRequest {
  targetLang: string;
  langName: string;
  text: string;
  fromReply: boolean;
}

/**
 * Pur : args + présence d'un message cité → demande de traduction.
 * Sans langue explicite → cible FRANÇAIS (public principal francophone ;
 * « .trad some english text » traduit donc vers le français).
 */
export function parseTranslateArgs(args: string[], hasQuotedText: boolean): TranslateRequest | null {
  const a = (args || []).filter(Boolean);
  if (a.length === 0 && !hasQuotedText) return null;

  const first = (a[0] || "").toLowerCase().replace(/[^a-z]/g, "");
  if (first && LANGS[first]) {
    const text = a.slice(1).join(" ").trim();
    if (!text && !hasQuotedText) return null; // langue seule sans texte ni citation
    return { targetLang: first, langName: LANGS[first], text, fromReply: !text && hasQuotedText };
  }
  const text = a.join(" ").trim();
  if (!text && !hasQuotedText) return null;
  return { targetLang: "fr", langName: LANGS["fr"], text, fromReply: !text && hasQuotedText };
}

/** Extrait le TEXTE du message cité (reply) — conversation ou texte long. */
export function quotedTextOf(msg: any): string {
  try {
    const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return "";
    const direct = quoted.conversation || quoted.extendedTextMessage?.text || "";
    return String(direct).trim().slice(0, MAX_TEXT_CHARS);
  } catch {
    return "";
  }
}

const tradCommand: BotCommand = {
  name: "trad",
  aliases: ["traduis", "tl"], // "translate" est un alias banni 8.59 (ancienne commande supprimée)
  category: "Utilities",
  description: "Traduire du texte (ex: .trad en Bonjour — défaut : vers le français ; marche par reply).",
  usage: ".trad <langue?> <texte>",
  execute: async (sock, msg, context) => {
    const quoted = quotedTextOf(msg);
    const req = parseTranslateArgs(context.args || [], !!quoted);
    if (!req || (!req.text && !req.fromReply)) {
      return void (await context.reply(
        "🌐 *Traduction*\n\n" +
        "• `.trad en Bonjour` — vers l'anglais\n" +
        "• `.trad The text…` — vers le français (défaut)\n" +
        "• Réponds à un message avec `.trad es` — traduit le message cité\n\n" +
        `_Langues : ${Object.keys(LANGS).join(", ")}_`
      ));
    }

    const text = (req.fromReply ? quoted : req.text).slice(0, MAX_TEXT_CHARS);
    if (!text) {
      return void (await context.reply("❌ Le message cité ne contient pas de texte à traduire."));
    }

    if (!isAIConfigured()) {
      return void (await context.reply("❌ La traduction nécessite l'IA, qui n'est pas configurée sur ce serveur."));
    }

    const quota = checkAIQuota(context.sender);
    if (!quota.allowed) {
      return void (await context.reply(`⚠️ ${quota.error}`));
    }

    try {
      consumeAIQuota(context.sender);
      const system =
        `Tu es un traducteur professionnel. Traduis le texte de l'utilisateur en ${req.langName}. ` +
        `Réponds UNIQUEMENT avec la traduction — pas de guillemets, pas de commentaire, pas de note. ` +
        `Conserve le ton et le formatage (emojis, sauts de ligne). ` +
        `Si le texte est déjà en ${req.langName}, renvoie-le tel quel.`;
      const answer = await withAIConcurrency(() =>
        generateTextWithFallback(text, system, "gemini-3.7-flash")
      );
      const cleaned = String(answer || "").trim();
      if (!cleaned) {
        return void (await context.reply("❌ Traduction indisponible — réessaie dans un instant."));
      }
      await context.reply(
        `🌐 *${req.langName.toUpperCase()}*\n\n${cleaned}` +
        (req.fromReply ? "\n\n_(message cité)_" : "")
      );
    } catch (error: any) {
      console.error("[TRAD] Error:", error?.message || error);
      await context.reply("❌ L'IA est momentanément indisponible.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default tradCommand;
