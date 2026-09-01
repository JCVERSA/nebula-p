// Nebula Bot by Dark Neon
/**
 * Base64 Command — Encodage / décodage Base64, Hex, Binary, URL
 * Aucune dépendance externe — tout est en natif Node.js
 */

module.exports = {
  name: 'base64',
  aliases: ['b64', 'encode', 'decode', 'hex', 'binary', 'codec'],
  category: 'utility',
  description: 'Encode/décode en Base64, Hex, Binary ou URL',
  usage: '.base64 encode <texte>\n.base64 decode <texte>\n.base64 hex <texte>\n.base64 fromhex <hex>',

  async execute(sock, msg, args, extra) {
    try {
      const action = args[0]?.toLowerCase();
      const text   = args.slice(1).join(' ');

      // ── Aide ──────────────────────────────────────────────────────────────
      if (!action || !text) {
        return extra.reply(
          `🔐 *Base64 & Encodage*\n\n` +
          `*Commandes disponibles:*\n\n` +
          `▸ *.base64 encode <texte>*\n` +
          `  → Encode en Base64\n\n` +
          `▸ *.base64 decode <base64>*\n` +
          `  → Décode depuis Base64\n\n` +
          `▸ *.base64 hex <texte>*\n` +
          `  → Convertit en hexadécimal\n\n` +
          `▸ *.base64 fromhex <hex>*\n` +
          `  → Décode depuis hexadécimal\n\n` +
          `▸ *.base64 binary <texte>*\n` +
          `  → Convertit en binaire\n\n` +
          `▸ *.base64 frombinary <binaire>*\n` +
          `  → Décode depuis binaire\n\n` +
          `▸ *.base64 url <url>*\n` +
          `  → Encode une URL (percent-encoding)\n\n` +
          `▸ *.base64 fromurl <url encodée>*\n` +
          `  → Décode une URL encodée\n\n` +
          `▸ *.base64 reverse <texte>*\n` +
          `  → Inverse le texte\n\n` +
          `▸ *.base64 rot13 <texte>*\n` +
          `  → Chiffrement ROT13`
        );
      }

      if (text.length > 5000) {
        return extra.reply('❌ Texte trop long (max 5000 caractères).');
      }

      let result = '';
      let label  = '';
      let emoji  = '🔐';

      switch (action) {

        // ── Base64 encode ──────────────────────────────────────────────────
        case 'encode':
        case 'enc':
        case 'b64':
          result = Buffer.from(text, 'utf8').toString('base64');
          label  = 'Base64 encodé';
          emoji  = '🔒';
          break;

        // ── Base64 decode ──────────────────────────────────────────────────
        case 'decode':
        case 'dec':
        case 'from64': {
          // Vérifier si le texte est un Base64 valide
          const b64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
          const cleaned  = text.replace(/\s/g, '');
          if (!b64Regex.test(cleaned) || cleaned.length % 4 !== 0) {
            return extra.reply('❌ Ce texte n\'est pas du Base64 valide.\nUn Base64 valide ne contient que : A-Z, a-z, 0-9, +, /, =');
          }
          try {
            result = Buffer.from(cleaned, 'base64').toString('utf8');
          } catch {
            return extra.reply('❌ Impossible de décoder. Vérifie que le texte est bien du Base64.');
          }
          label = 'Base64 décodé';
          emoji = '🔓';
          break;
        }

        // ── Hex encode ────────────────────────────────────────────────────
        case 'hex':
        case 'tohex':
          result = Buffer.from(text, 'utf8').toString('hex').match(/.{1,2}/g).join(' ');
          label  = 'Hexadécimal';
          emoji  = '🟦';
          break;

        // ── Hex decode ────────────────────────────────────────────────────
        case 'fromhex':
        case 'unhex': {
          const hexClean = text.replace(/\s/g, '');
          if (!/^[0-9a-fA-F]+$/.test(hexClean) || hexClean.length % 2 !== 0) {
            return extra.reply('❌ Hex invalide. Un hex valide contient uniquement 0-9 et A-F, en nombre pair de caractères.');
          }
          result = Buffer.from(hexClean, 'hex').toString('utf8');
          label  = 'Hex décodé';
          emoji  = '🟦';
          break;
        }

        // ── Binary encode ─────────────────────────────────────────────────
        case 'binary':
        case 'bin':
        case 'tobin':
          result = text.split('').map(c =>
            c.charCodeAt(0).toString(2).padStart(8, '0')
          ).join(' ');
          label  = 'Binaire';
          emoji  = '🔢';
          break;

        // ── Binary decode ─────────────────────────────────────────────────
        case 'frombinary':
        case 'frombin':
        case 'unbin': {
          const binParts = text.trim().split(/\s+/);
          if (binParts.some(p => !/^[01]{8}$/.test(p))) {
            return extra.reply('❌ Binaire invalide. Chaque groupe doit être 8 bits (ex: 01001000 01101001).');
          }
          result = binParts.map(b => String.fromCharCode(parseInt(b, 2))).join('');
          label  = 'Binaire décodé';
          emoji  = '🔢';
          break;
        }

        // ── URL encode ────────────────────────────────────────────────────
        case 'url':
        case 'urlencode':
        case 'encodeurl':
          result = encodeURIComponent(text);
          label  = 'URL encodée';
          emoji  = '🌐';
          break;

        // ── URL decode ────────────────────────────────────────────────────
        case 'fromurl':
        case 'urldecode':
        case 'decodeurl':
          try {
            result = decodeURIComponent(text);
          } catch {
            return extra.reply('❌ URL encodée invalide.');
          }
          label = 'URL décodée';
          emoji = '🌐';
          break;

        // ── Reverse ───────────────────────────────────────────────────────
        case 'reverse':
        case 'rev':
        case 'flip':
          result = [...text].reverse().join('');
          label  = 'Texte inversé';
          emoji  = '🔄';
          break;

        // ── ROT13 ─────────────────────────────────────────────────────────
        case 'rot13':
        case 'rot':
          result = text.replace(/[a-zA-Z]/g, c => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
          });
          label  = 'ROT13';
          emoji  = '🔁';
          break;

        default:
          return extra.reply(
            `❌ Action inconnue: *${action}*\n\n` +
            `Actions disponibles:\n` +
            `encode, decode, hex, fromhex, binary, frombinary, url, fromurl, reverse, rot13\n\n` +
            `Tapez *.base64* pour voir l\'aide complète.`
          );
      }

      // Limiter l'affichage si résultat très long
      const maxDisplay = 2000;
      const display    = result.length > maxDisplay
        ? result.substring(0, maxDisplay) + `\n\n_(${result.length - maxDisplay} caractères supplémentaires tronqués)_`
        : result;

      await extra.reply(
        `${emoji} *${label}*\n\n` +
        `📥 *Entrée:*\n${text.length > 200 ? text.substring(0, 200) + '...' : text}\n\n` +
        `📤 *Résultat:*\n${display}\n\n` +
        `📊 ${text.length} → ${result.length} caractères\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
      );

    } catch (error) {
      console.error('[BASE64] Error:', error.message);
      await extra.reply('❌ Erreur lors de l\'opération. Réessaie.');
    }
  }
};
