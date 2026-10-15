import { synthesizeVoiceNote, sanitizeTtsText } from "./ttsService.js";
import { isVoiceModeEnabled } from "./voiceModeStore.js";

/**
 * 9.18ii (P6b) — livraison vocale des réponses conversationnelles de
 * l'agent. Deux briques :
 *
 *  - isVoiceEligibleText (pur) : le texte mérite-t-il la voix ? Activé pour
 *    le chat + assez court (≤ 500 chars ≈ 40-50 s, recherche UX : au-delà
 *    on perd l'auditoire) + PAS d'URL (un lien ne se lit pas à voix) + de
 *    la matière après nettoyage ;
 *  - sendAgentTextOrVoice : envoie en note vocale (ptt) si éligible, avec
 *    présence « recording » pendant la synthèse (l'utilisateur voit
 *    « enregistrement audio… » comme un humain), et REPLI TEXTE intégral
 *    au moindre échec (service vocal indisponible, timeout…) — jamais de
 *    silence, jamais de réponse perdue.
 *
 * Les messages système (quota, budget), livraisons (liens) et écrans de
 * sélection n'appellent jamais cette fonction avec voice:true.
 *
 * 9.18jj (B) : « la voix appelle la voix » — force:true bypass le réglage
 * .on/.off : quand l'utilisateur a parlé en NOTE VOCALE, la réponse
 * conversationnelle part en voix par défaut (l'IA n'a rien à décider).
 */

/** Cap d'une réponse vocale (~40-50 s d'audio). Au-delà : texte. */
export const VOICE_REPLY_MAX_CHARS = 500;

/** Le texte peut-il partir en voix ? Pur. */
export function isVoiceEligibleText(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  if (t.length > VOICE_REPLY_MAX_CHARS) return false;
  if (/https?:\/\//i.test(t)) return false; // un lien ne se lit pas à voix
  return sanitizeTtsText(t).length >= 2; // assez de matière après nettoyage
}

/**
 * Envoie `text` en note vocale si le mode vocal est actif pour `chatJid` ET
 * que le texte est éligible ; sinon (ou en cas d'échec TTS) en texte.
 * `quoted` : message à citer (même comportement que sendText).
 */
export async function sendAgentTextOrVoice(
  sock: any,
  chatJid: string,
  quoted: any,
  text: string,
  opts: { voice?: boolean; force?: boolean; sender?: string } = {}
): Promise<"voice" | "text"> {
  const t = String(text || "");
  const wantsVoice = !!opts.voice && (opts.force === true || isVoiceModeEnabled(chatJid)) && isVoiceEligibleText(t);
  if (wantsVoice) {
    try {
      // Présence « recording » pendant la synthèse (best-effort).
      try {
        if (sock && typeof sock.sendPresenceUpdate === "function") {
          await sock.sendPresenceUpdate("recording", chatJid);
        }
      } catch {}
      const ogg = await synthesizeVoiceNote(t, { sender: opts.sender });
      await sock.sendMessage(
        chatJid,
        { audio: ogg, mimetype: "audio/ogg; codecs=opus", ptt: true },
        { quoted }
      );
      return "voice";
    } catch (e: any) {
      console.warn("[VOICE] synthèse échouée, repli texte :", String(e?.message || e).slice(0, 120));
    } finally {
      try {
        if (sock && typeof sock.sendPresenceUpdate === "function") {
          await sock.sendPresenceUpdate("paused", chatJid);
        }
      } catch {}
    }
  }
  await sock.sendMessage(chatJid, { text: t }, { quoted });
  return "text";
}
