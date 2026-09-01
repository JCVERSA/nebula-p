// Nebula Bot by Dark Neon
/**
 * Facebook Downloader - Utilise l'API publique getvideoapi.com
 */

const axios = require('axios');

module.exports = {
  name: 'facebook',
  aliases: ['fb', 'fbdl', 'facebookdl'],
  category: 'media',
  description: 'Download Facebook videos',
  usage: '.facebook <lien Facebook>',

  async execute(sock, msg, args, extra) {
    try {
      const url = args.join(' ').trim();

      if (!url) {
        return extra.reply(
          '📥 *Facebook Downloader*\n\n' +
          'Usage: .facebook <lien Facebook>\n\n' +
          'Exemple:\n  .facebook https://www.facebook.com/watch?v=xxx\n  .facebook https://fb.watch/xxx'
        );
      }

      const fbPatterns = [
        /facebook\.com/,
        /fb\.com/,
        /fb\.watch/
      ];

      if (!fbPatterns.some(p => p.test(url))) {
        return extra.reply('❌ Lien Facebook invalide ! Envoie un lien valide.');
      }

      await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

      // API getvideoapi.com — gratuite et fiable
      const apiRes = await axios.get('https://getvideoapi.com/api/video', {
        params: { url },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 20000
      });

      const data = apiRes.data;

      // Chercher la meilleure qualité disponible
      let videoUrl = null;

      if (data?.hd_url)  videoUrl = data.hd_url;
      else if (data?.sd_url)  videoUrl = data.sd_url;
      else if (data?.links?.hd) videoUrl = data.links.hd;
      else if (data?.links?.sd) videoUrl = data.links.sd;
      else if (Array.isArray(data?.links) && data.links[0]?.url) videoUrl = data.links[0].url;

      if (!videoUrl) {
        // Fallback : essayer savefrom API
        try {
          const sfRes = await axios.get(`https://sfrom.net/api/info?url=${encodeURIComponent(url)}`, {
            timeout: 15000
          });
          const sfData = sfRes.data;
          if (sfData?.url?.[0]?.url) videoUrl = sfData.url[0].url;
        } catch (e) { /* silencieux */ }
      }

      if (!videoUrl) {
        return extra.reply(
          '❌ Impossible de télécharger cette vidéo Facebook.\n\n' +
          '⚠️ Les vidéos privées ou certains formats ne sont pas supportés.\n' +
          'Essaie avec un autre lien ou une vidéo publique.'
        );
      }

      const caption =
        `📘 *Facebook Video*\n\n` +
        `> _Downloaded by Nebula Bot_`;

      await sock.sendMessage(extra.from, {
        video: { url: videoUrl },
        mimetype: 'video/mp4',
        caption
      }, { quoted: msg });

      await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

    } catch (error) {
      console.error('[Facebook Error]:', error.message);
      await extra.reply(
        '❌ Erreur lors du téléchargement Facebook.\n\n' +
        'Assure-toi que la vidéo est publique et réessaie.'
      );
    }
  }
};
