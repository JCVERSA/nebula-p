/**
 * Lyrics Finder — Nebula Bot by Dark Neon
 * Cherche les paroles d'une chanson via plusieurs APIs
 * Fix: logique conditionnelle corrigée (bug response null)
 */

const axios = require('axios');
const config = require('../../config');

module.exports = {
  name: 'lyrics',
  aliases: ['lyric', 'lirik', 'paroles'],
  category: 'media',
  description: 'Obtenir les paroles d\'une chanson',
  usage: '.lyrics <artiste> <titre>  ou  .lyrics <titre>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length) {
        return await sock.sendMessage(msg.key.remoteJid, {
          text: `❌ Usage: .lyrics <nom de la chanson>\n\nEx: .lyrics Burna Boy Last Last`
        }, { quoted: msg });
      }

      const query = args.join(' ');
      await extra.reply(`🔍 Recherche des paroles pour *"${query}"*...`);

      let lyricsData = null;

      // ── API 1 : lyrics.ovh ────────────────────────────────────────────────
      if (!lyricsData) {
        try {
          const parts = query.trim().split(' ');
          const artist = parts[0];
          const title = parts.slice(1).join(' ') || parts[0];
          const res = await axios.get(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
            { timeout: 10000 }
          );
          if (res.data?.lyrics) {
            lyricsData = { lyrics: res.data.lyrics, title: query, artist };
          }
        } catch (_) {}
      }

      // ── API 2 : vreden ────────────────────────────────────────────────────
      if (!lyricsData) {
        try {
          const res = await axios.get(
            `https://api.vreden.my.id/api/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 10000 }
          );
          if (res.data?.result?.lyrics) {
            lyricsData = {
              title: res.data.result.title || query,
              artist: res.data.result.artist || '',
              lyrics: res.data.result.lyrics,
              thumbnail: res.data.result.thumbnail || null
            };
          }
        } catch (_) {}
      }

      // ── API 3 : siputzx ───────────────────────────────────────────────────
      if (!lyricsData) {
        try {
          const res = await axios.get(
            `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 10000 }
          );
          if (res.data?.status && res.data?.data?.lyrics) {
            lyricsData = {
              title: res.data.data.title || query,
              artist: res.data.data.artist || '',
              lyrics: res.data.data.lyrics,
              thumbnail: res.data.data.image || null
            };
          }
        } catch (_) {}
      }

      if (!lyricsData) {
        return await sock.sendMessage(msg.key.remoteJid, {
          text: `❌ Paroles introuvables pour *"${query}"*.\n\n💡 Essaie avec : *artiste titre* (ex: .lyrics Adele Hello)`
        }, { quoted: msg });
      }

      // ── Formater ──────────────────────────────────────────────────────────
      let lyrics = lyricsData.lyrics || '';
      if (lyrics.length > 4000) {
        lyrics = lyrics.substring(0, 4000) + '\n\n_[Paroles tronquées — trop longues]_';
      }

      const caption =
        `🎵 *${lyricsData.title}*\n` +
        (lyricsData.artist ? `👤 *Artiste:* ${lyricsData.artist}\n` : '') +
        `\n📝 *Paroles:*\n${lyrics}\n\n` +
        `_Fetched by ${config.botName}_`;

      if (lyricsData.thumbnail) {
        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: lyricsData.thumbnail },
          caption
        }, { quoted: msg });
      } else {
        await sock.sendMessage(msg.key.remoteJid, { text: caption }, { quoted: msg });
      }

    } catch (error) {
      console.error('[LYRICS] Error:', error.message);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Erreur lors de la recherche des paroles.'
      }, { quoted: msg });
    }
  }
};
