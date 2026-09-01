// Nebula Bot by Dark Neon
/**
 * Upload Command — Génère un lien de téléchargement via catbox.moe
 * Supporte : images, vidéos, audio, documents, stickers
 * Limite : 195 Mo | Suppression auto après 5h (ou manuelle via compte owner)
 *
 * Compte catbox owner : userhash 15833e8579c053b5001f39aa0
 * → Les fichiers uploadés sont liés au compte et supprimables manuellement
 */

const axios              = require('axios');
const FormData           = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// ── Config ────────────────────────────────────────────────────────────────────
const CATBOX_URL    = 'https://catbox.moe/user/api.php';
const CATBOX_HASH   = '15833e8579c053b5001f39aa0'; // userhash du compte Dark Neon
const MAX_SIZE_MB   = 195;
const MAX_SIZE_B    = MAX_SIZE_MB * 1024 * 1024;

// ── Types de médias supportés ─────────────────────────────────────────────────
const MEDIA_TYPES = {
  imageMessage:    { ext: 'jpg',  mime: 'image/jpeg',       label: '🖼️ Image'    },
  videoMessage:    { ext: 'mp4',  mime: 'video/mp4',        label: '🎬 Vidéo'    },
  audioMessage:    { ext: 'mp3',  mime: 'audio/mpeg',       label: '🎵 Audio'    },
  stickerMessage:  { ext: 'webp', mime: 'image/webp',       label: '🎭 Sticker'  },
  documentMessage: { ext: null,   mime: 'application/octet-stream', label: '📄 Document' },
  pttMessage:      { ext: 'ogg',  mime: 'audio/ogg',        label: '🎤 Vocal'    },
};

// ── Résoudre le message média (direct ou reply) ───────────────────────────────
function resolveMedia(msg) {
  const m = msg.message;
  if (!m) return null;

  // Wrappers WhatsApp
  const unwrapped =
    m.ephemeralMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessage?.message ||
    m.documentWithCaptionMessage?.message ||
    m;

  for (const type of Object.keys(MEDIA_TYPES)) {
    if (unwrapped[type]) return { type, info: unwrapped[type], msgToDownload: { ...msg, message: unwrapped } };
  }
  return null;
}

function resolveQuotedMedia(msg, extra) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  const quotedMsg = {
    key: {
      remoteJid: extra.from,
      id: ctx.stanzaId,
      participant: ctx.participant || extra.sender,
      fromMe: false
    },
    message: ctx.quotedMessage
  };
  return resolveMedia(quotedMsg);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${bytes} octets`;
}

function getFilename(type, info) {
  // Pour les documents, récupérer le vrai nom de fichier si disponible
  if (type === 'documentMessage' && info.fileName) return info.fileName;
  const ext = MEDIA_TYPES[type]?.ext || 'bin';
  return `nebula_${Date.now()}.${ext}`;
}

function getMime(type, info) {
  if (type === 'documentMessage' && info.mimetype) return info.mimetype;
  return MEDIA_TYPES[type]?.mime || 'application/octet-stream';
}

// ── Upload vers catbox.moe ────────────────────────────────────────────────────
async function uploadToCatbox(buffer, filename, mimetype) {
  const form = new FormData();
  form.append('reqtype',  'fileupload');
  form.append('userhash', CATBOX_HASH);
  form.append('fileToUpload', buffer, {
    filename,
    contentType: mimetype,
    knownLength: buffer.length
  });

  const headers = form.getHeaders();

  let response;
  try {
    response = await axios.post(CATBOX_URL, form, {
      headers: {
        ...headers,
        'User-Agent': 'Mozilla/5.0 (compatible; NebulaBot/1.0)'
      },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      responseType: 'text',
      transformResponse: [d => d],
    });
  } catch (reqErr) {
    const errData = reqErr.response?.data || '';
    console.error('[UPLOAD] catbox HTTP error:', reqErr.message, '| Response:', errData);
    throw new Error(`Erreur réseau catbox: ${reqErr.message}`);
  }

  const raw = typeof response.data === 'string'
    ? response.data.trim()
    : String(response.data || '').trim();

  console.log('[UPLOAD] catbox raw response:', JSON.stringify(raw));

  // Réponse valide
  if (raw.startsWith('https://')) return raw;

  // Erreur explicite catbox
  if (!raw) {
    throw new Error('catbox a retourné une réponse vide. Le userhash est peut-être invalide ou le service est indisponible.');
  }
  if (raw.toLowerCase().includes('error') || raw.toLowerCase().includes('invalid')) {
    throw new Error('catbox: ' + raw.substring(0, 200));
  }

  throw new Error('Réponse inattendue de catbox: ' + raw.substring(0, 100));
}

// ── Module ────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'upload',
  aliases: ['ul', 'fileup', 'getlink', 'dllink', 'catbox', 'link'],
  category: 'utility',
  description: `Génère un lien de téléchargement pour un fichier via catbox.moe (max ${MAX_SIZE_MB} Mo)`,
  usage: '.upload — envoie ou réponds à un fichier/image/vidéo/audio',

  async execute(sock, msg, args, extra) {
    try {
      // ── Trouver le média ────────────────────────────────────────────────
      let resolved = resolveMedia(msg) || resolveQuotedMedia(msg, extra);

      if (!resolved) {
        return extra.reply(
          `📤 *Upload → Lien de téléchargement*\n\n` +
          `Envoie un fichier avec *.upload* comme légende,\nou réponds à un fichier existant avec *.upload*\n\n` +
          `*Types supportés:*\n` +
          `  🖼️ Images (jpg, png, gif...)\n` +
          `  🎬 Vidéos (mp4, mkv...)\n` +
          `  🎵 Audio (mp3, ogg, m4a...)\n` +
          `  📄 Documents (pdf, zip, apk...)\n` +
          `  🎭 Stickers (webp)\n` +
          `  🎤 Messages vocaux\n\n` +
          `📦 *Limite:* ${MAX_SIZE_MB} Mo\n` +
          `⏱️ *Durée:* Fichiers liés au compte — suppression manuelle ou auto\n` +
          `🌐 *Hébergeur:* catbox.moe`
        );
      }

      const { type, info, msgToDownload } = resolved;
      const label    = MEDIA_TYPES[type]?.label || '📎 Fichier';
      const filename = getFilename(type, info);
      const mimetype = getMime(type, info);

      // Taille estimée depuis les métadonnées WhatsApp si disponible
      const estimatedSize = info.fileLength || info.fileSize || null;
      if (estimatedSize && estimatedSize > MAX_SIZE_B) {
        return extra.reply(
          `❌ Fichier trop lourd !\n\n` +
          `📦 Taille: *${formatSize(estimatedSize)}*\n` +
          `📏 Limite: *${MAX_SIZE_MB} Mo*\n\n` +
          `Compresse le fichier avant de réessayer.`
        );
      }

      await extra.reply(`⬆️ Upload en cours... ${label} *${filename}*\n_Cela peut prendre quelques secondes._`);

      // ── Télécharger depuis WhatsApp ─────────────────────────────────────
      let buffer;
      try {
        buffer = await downloadMediaMessage(
          msgToDownload,
          'buffer',
          {},
          { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );
      } catch (dlErr) {
        console.error('[UPLOAD] Download error:', dlErr.message);
        return extra.reply('❌ Impossible de télécharger le fichier depuis WhatsApp.\nRéessaie ou renvoie le fichier.');
      }

      if (!buffer || buffer.length < 10) {
        return extra.reply('❌ Fichier vide ou illisible.');
      }

      // Vérification taille réelle
      if (buffer.length > MAX_SIZE_B) {
        return extra.reply(
          `❌ Fichier trop lourd !\n\n` +
          `📦 Taille réelle: *${formatSize(buffer.length)}*\n` +
          `📏 Limite: *${MAX_SIZE_MB} Mo*`
        );
      }

      // ── Upload vers catbox.moe ──────────────────────────────────────────
      let url;
      try {
        url = await uploadToCatbox(buffer, filename, mimetype);
      } catch (upErr) {
        console.error('[UPLOAD] Catbox error:', upErr.message);
        let hint = 'Réessaie dans quelques instants.';
        if (upErr.message?.includes('vide') || upErr.message?.includes('userhash')) {
          hint = 'catbox.moe est peut-être temporairement indisponible.';
        } else if (upErr.message?.includes('timeout') || upErr.message?.includes('réseau')) {
          hint = 'Connexion trop lente. Réessaie avec un fichier plus petit.';
        }
        return extra.reply(
          `❌ *Échec de l'upload*\n\n` +
          `📋 _${upErr.message || 'Erreur inconnue'}_\n\n` +
          `💡 ${hint}`
        );
      }

      // ── Succès ─────────────────────────────────────────────────────────
      const sizeLine = `📦 *Taille:* ${formatSize(buffer.length)}`;

      await sock.sendMessage(extra.from, {
        text:
          `✅ *Upload réussi !*\n\n` +
          `${label} — *${filename}*\n` +
          `${sizeLine}\n\n` +
          `🔗 *Lien de téléchargement:*\n${url}\n\n` +
          `💡 Ouvre ce lien dans Chrome, Firefox ou tout autre navigateur pour télécharger.\n\n` +
          `🗑️ _Suppression manuelle via le compte owner ou automatique._\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
      }, { quoted: msg });

    } catch (error) {
      console.error('[UPLOAD] Unexpected error:', error.message);
      await extra.reply(`❌ Erreur inattendue: ${error.message}`);
    }
  }
};
