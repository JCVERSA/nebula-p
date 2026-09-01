// Nebula Bot by Dark Neon
/**
 * TikTok Downloader - Utilise l'API publique tikwm.com
 */

const axios = require('axios');

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl'],
  category: 'media',
  description: 'Download TikTok videos without watermark',
  usage: '.tiktok <lien TikTok>',

  async execute(sock, msg, args, extra) {
    try {
      const url = args.join(' ').trim();

      if (!url) {
        return extra.reply(
          '📥 *TikTok Downloader*\n\n' +
          'Usage: .tiktok <lien TikTok>\n\n' +
          'Exemple:\n  .tiktok https://vm.tiktok.com/xxx'
        );
      }

      if (!url.includes('tiktok.com')) {
        return extra.reply('❌ Lien TikTok invalide ! Envoie un lien valide.');
      }

      await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

      // API tikwm.com — fiable et gratuite
      const apiRes = await axios.post(
        'https://www.tikwm.com/api/',
        new URLSearchParams({ url, hd: '1' }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000
        }
      );

      const data = apiRes.data?.data;

      if (!data || !data.play) {
        return extra.reply('❌ Impossible de télécharger cette vidéo TikTok. Essaie un autre lien.');
      }

      const videoUrl  = data.hdplay || data.play;
      const title     = data.title || '';
      const author    = data.author?.nickname || '';
      const duration  = data.duration ? `${data.duration}s` : '';

      let caption = `🎵 *TikTok*\n`;
      if (author)   caption += `👤 ${author}\n`;
      if (duration) caption += `⏱️ ${duration}\n`;
      if (title)    caption += `📝 ${title}\n`;
      caption += `\n> _Downloaded by Nebula Bot_`;

      await sock.sendMessage(extra.from, {
        video: { url: videoUrl },
        mimetype: 'video/mp4',
        caption
      }, { quoted: msg });

      await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

    } catch (error) {
      console.error('[TikTok Error]:', error.message);
      await extra.reply('❌ Erreur lors du téléchargement TikTok. Réessaie avec un autre lien.');
    }
  }
};
