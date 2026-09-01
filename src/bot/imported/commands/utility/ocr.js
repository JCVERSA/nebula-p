// Nebula Bot by Dark Neon
/**
 * OCR Command — Extrait le texte d'une image
 * Utilise ocr.space API (gratuit, 25k requêtes/mois, sans inscription)
 * Fallback: api.ocr.space avec clé publique connue
 */

const axios  = require('axios');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const FormData = require('form-data');

// Clé publique OCR.space (K88888888888888 = clé de test, limitée mais fonctionnelle)
// Pour plus de requêtes, l'owner peut créer un compte gratuit sur ocr.space
const OCR_API_KEY = 'K88888888888888';
const OCR_URL     = 'https://api.ocr.space/parse/image';

// Langues supportées par OCR.space
const LANG_MAP = {
  fr: 'fre', en: 'eng', ar: 'ara', es: 'spa', de: 'deu',
  it: 'ita', pt: 'por', ru: 'rus', zh: 'chs', ja: 'jpn',
  ko: 'kor', hi: 'hin', tr: 'tur', nl: 'dut', pl: 'pol',
  fre: 'fre', eng: 'eng', ara: 'ara'
};

function resolveImageMessage(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.imageMessage) return { msg, type: 'imageMessage' };
  if (m.ephemeralMessage?.message?.imageMessage) return { msg, type: 'imageMessage' };
  if (m.viewOnceMessage?.message?.imageMessage) return { msg: { ...msg, message: m.viewOnceMessage.message }, type: 'imageMessage' };
  if (m.viewOnceMessageV2?.message?.imageMessage) return { msg: { ...msg, message: m.viewOnceMessageV2.message }, type: 'imageMessage' };
  return null;
}

module.exports = {
  name: 'ocr',
  aliases: ['readimage', 'extracttext', 'imgtext', 'textfromimage', 'scantext'],
  category: 'utility',
  description: 'Extrait le texte d\'une image (OCR)',
  usage: '.ocr [langue] — répondre à une image\nLangues: fr, en, ar, es, de, it, pt, ru...',

  async execute(sock, msg, args, extra) {
    try {
      // ── Détecter la langue (optionnelle) ──────────────────────────────────
      const langArg  = args[0]?.toLowerCase();
      const langCode = LANG_MAP[langArg] || 'eng'; // défaut: anglais (meilleur pour les caractères mixtes)
      const langName = langArg && LANG_MAP[langArg] ? langArg.toUpperCase() : 'AUTO';

      // ── Trouver l'image (message direct ou reply) ─────────────────────────
      let imageSource = resolveImageMessage(msg);
      let targetMsg   = msg;

      if (!imageSource) {
        // Chercher dans le message cité (reply)
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        if (ctx?.quotedMessage) {
          const quotedMsg = {
            key: {
              remoteJid: extra.from,
              id: ctx.stanzaId,
              participant: ctx.participant || extra.sender,
              fromMe: false
            },
            message: ctx.quotedMessage
          };
          imageSource = resolveImageMessage(quotedMsg);
          if (imageSource) targetMsg = quotedMsg;
        }
      }

      if (!imageSource) {
        return extra.reply(
          `👁️ *OCR — Extraction de texte*\n\n` +
          `Envoie ou réponds à une image avec *.ocr*\n\n` +
          `*Options de langue:*\n` +
          `  .ocr fr — Français\n` +
          `  .ocr en — Anglais (défaut)\n` +
          `  .ocr ar — Arabe\n` +
          `  .ocr es — Espagnol\n` +
          `  .ocr de — Allemand\n` +
          `  .ocr ru — Russe\n` +
          `  .ocr zh — Chinois\n` +
          `  .ocr ja — Japonais\n\n` +
          `💡 Fonctionne avec les captures d\'écran, photos de docs, images avec texte.`
        );
      }

      await extra.reply(`🔍 Analyse de l\'image en cours (langue: *${langName}*)...`);

      // ── Télécharger l'image ────────────────────────────────────────────────
      let buffer;
      try {
        buffer = await downloadMediaMessage(
          targetMsg,
          'buffer',
          {},
          { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );
      } catch (dlErr) {
        return extra.reply('❌ Impossible de télécharger l\'image. Réessaie.');
      }

      if (!buffer || buffer.length < 100) {
        return extra.reply('❌ Image trop petite ou corrompue.');
      }

      if (buffer.length > 5 * 1024 * 1024) {
        return extra.reply('❌ Image trop lourde (max 5 MB). Compresse l\'image avant de réessayer.');
      }

      // ── Envoyer à l'API OCR ────────────────────────────────────────────────
      const form = new FormData();
      form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      form.append('language', langCode);
      form.append('isOverlayRequired', 'false');
      form.append('detectOrientation', 'true');
      form.append('scale', 'true');
      form.append('OCREngine', '2'); // Engine 2 = plus précis pour texte complexe
      form.append('apikey', OCR_API_KEY);

      const { data } = await axios.post(OCR_URL, form, {
        headers: form.getHeaders(),
        timeout: 30000
      });

      if (data.IsErroredOnProcessing) {
        const errMsg = data.ErrorMessage?.[0] || 'Erreur inconnue';
        console.error('[OCR] API error:', errMsg);
        return extra.reply(`❌ Erreur OCR: ${errMsg}`);
      }

      const parsedText = data.ParsedResults?.[0]?.ParsedText || '';
      const confidence = data.ParsedResults?.[0]?.TextOverlay?.Lines?.[0]?.Words?.[0]?.WordText ? '✅' : '⚠️';

      if (!parsedText.trim()) {
        return extra.reply(
          `🔍 *OCR terminé*\n\n` +
          `Aucun texte détecté dans cette image.\n\n` +
          `*Conseils pour de meilleurs résultats:*\n` +
          `  • Image avec bon contraste\n` +
          `  • Texte net et lisible\n` +
          `  • Pas de texte manuscrit (moins précis)\n` +
          `  • Essaie *.ocr fr* si le texte est en français`
        );
      }

      // Nettoyer le texte OCR
      const cleaned = parsedText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const charCount = cleaned.length;
      const lineCount = cleaned.split('\n').length;

      // Si texte très long, tronquer pour WhatsApp (limite ~65k chars)
      const maxLength = 3000;
      const display   = cleaned.length > maxLength
        ? cleaned.substring(0, maxLength) + `\n\n_...et ${cleaned.length - maxLength} caractères supplémentaires_`
        : cleaned;

      await sock.sendMessage(extra.from, {
        text:
          `👁️ *OCR — Texte extrait*\n\n` +
          `🌐 Langue: *${langName}*  ${confidence}\n` +
          `📊 ${charCount} caractères — ${lineCount} lignes\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          display + '\n\n' +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
      }, { quoted: msg });

    } catch (error) {
      console.error('[OCR] Error:', error.message);
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        await extra.reply('⏳ L\'OCR a pris trop de temps. Essaie avec une image plus petite ou plus nette.');
      } else {
        await extra.reply('❌ Erreur lors de l\'OCR. Réessaie dans un moment.');
      }
    }
  }
};
