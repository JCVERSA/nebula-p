// Nebula Bot by Dark Neon
/**
 * Shorten Command — Raccourcisseur de liens
 * Utilise tinyurl.com (gratuit, sans clé API)
 * Fallback : is.gd
 */

const axios = require('axios');

function isValidUrl(str) {
  try {
    const url = new URL(str.startsWith('http') ? str : `https://${str}`);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeUrl(str) {
  return str.startsWith('http') ? str : `https://${str}`;
}

async function shortenTinyUrl(url) {
  const { data } = await axios.get(
    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
    { timeout: 8000 }
  );
  if (typeof data === 'string' && data.startsWith('http')) return data.trim();
  throw new Error('TinyURL failed');
}

async function shortenIsGd(url) {
  const { data } = await axios.get(
    `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
    { timeout: 8000 }
  );
  if (typeof data === 'string' && data.startsWith('http')) return data.trim();
  throw new Error('is.gd failed');
}

module.exports = {
  name: 'shorten',
  aliases: ['short', 'shorturl', 'shrink', 'urlshort', 'tinyurl'],
  category: 'utility',
  description: 'Raccourcit un lien',
  usage: '.shorten <url>',

  async execute(sock, msg, args, extra) {
    try {
      let url = args[0];

      // Vérifier si c'est une réponse à un message contenant un lien
      if (!url) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        const urlMatch = quotedText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) url = urlMatch[0];
      }

      if (!url) {
        return extra.reply(
          `🔗 *URL Shortener*\n\n` +
          `Usage: *.shorten <url>*\n\n` +
          `Exemples:\n` +
          `  .shorten https://www.google.com/very/long/url\n` +
          `  .shorten youtube.com/watch?v=...\n\n` +
          `💡 Tu peux aussi répondre à un message contenant un lien.`
        );
      }

      if (!isValidUrl(url)) {
        return extra.reply('❌ URL invalide. Assure-toi qu\'elle commence par *http://* ou *https://*');
      }

      const fullUrl = normalizeUrl(url);

      await extra.reply('⏳ Raccourcissement en cours...');

      let shortened = null;
      let service   = '';

      // Essai TinyURL d'abord
      try {
        shortened = await shortenTinyUrl(fullUrl);
        service   = 'TinyURL';
      } catch {
        // Fallback is.gd
        try {
          shortened = await shortenIsGd(fullUrl);
          service   = 'is.gd';
        } catch {
          return extra.reply('❌ Impossible de raccourcir ce lien. Les deux services sont indisponibles, réessaie plus tard.');
        }
      }

      const originalLen  = fullUrl.length;
      const shortenedLen = shortened.length;
      const saved        = originalLen - shortenedLen;
      const pct          = Math.round((saved / originalLen) * 100);

      await extra.reply(
        `🔗 *Lien raccourci !*\n\n` +
        `📎 *Original:*\n${fullUrl}\n\n` +
        `✅ *Raccourci:*\n${shortened}\n\n` +
        `📊 *${originalLen} → ${shortenedLen} caractères* (-${Math.max(0, saved)} chars, ${Math.max(0, pct)}% plus court)\n` +
        `🛠️ *Service:* ${service}`
      );

    } catch (error) {
      console.error('[SHORTEN] Error:', error.message);
      await extra.reply('❌ Erreur lors du raccourcissement. Réessaie.');
    }
  }
};
