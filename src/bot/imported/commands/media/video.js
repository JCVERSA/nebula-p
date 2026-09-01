/**
 * Video Downloader — Nebula Bot by Dark Neon
 * Télécharge une vidéo YouTube via chaîne d'APIs avec fallbacks
 * Supporte désormais la sélection de résolution
 */

const yts = require('yt-search');
const axios = require('axios');
const config = require('../../config');
const eco = require('../../utils/economy');
const { validators, ValidationError } = require('../../utils/validation');

const DOWNLOAD_PRICES = {
  video: 150,
};

// ── APIs vidéo (par ordre de fiabilité) ──────────────────────────────────────
const VIDEO_APIS = [
  {
    name: 'cobalt',
    fetch: async (url, quality = '720') => {
      const res = await axios.post('https://api.cobalt.tools/api/json', {
        url,
        vQuality: quality,
        isAudioOnly: false,
        disableMetadata: false
      }, {
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        timeout: 25000
      });
      if (res.data?.url) return { downloadUrl: res.data.url, title: null };
      throw new Error('cobalt: no url');
    }
  },
  {
    name: 'EliteProTech',
    fetch: async (url) => {
      const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4`, {
        timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.success && res.data?.downloadURL) return { downloadUrl: res.data.downloadURL, title: res.data.title };
      throw new Error('EliteProTech: no url');
    }
  },
  {
    name: 'Yupra',
    fetch: async (url) => {
      const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`, {
        timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.success && res.data?.data?.download_url) return { downloadUrl: res.data.data.download_url, title: res.data.data.title };
      throw new Error('Yupra: no url');
    }
  },
  {
    name: 'Okatsu',
    fetch: async (url) => {
      const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`, {
        timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.result?.mp4) return { downloadUrl: res.data.result.mp4, title: res.data.result.title };
      throw new Error('Okatsu: no url');
    }
  }
];

module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'media',
  description: 'Télécharger une vidéo YouTube avec option de résolution',
  usage: '.video <nom ou lien> [résolution: 360, 480, 720, 1080]',

  async execute(sock, msg, args, extra) {
    let debited = false;
    try {
      const chatId = msg.key.remoteJid;
      const sender = extra.sender;

      if (!args[0]) {
        return await sock.sendMessage(chatId, {
          text: '🎬 *Usage:* .video <nom ou lien YouTube> [résolution]\n\n' +
                'Ex: .video Ronaldo best goals 720\n' +
                'Résolutions supportées: 360, 480, 720, 1080'
        }, { quoted: msg });
      }

      // ── Parse resolution ──────────────────────────────────────────────────
      let quality = '720';
      let searchQuery = args.join(' ');

      const lastArg = args[args.length - 1];
      if (['360', '480', '720', '1080'].includes(lastArg)) {
        quality = lastArg;
        searchQuery = args.slice(0, -1).join(' ');
      }

      // ── Vérification solde ──────────────────────────────────────────────────
      const user = eco.getUser(sender);
      if (user.coins < DOWNLOAD_PRICES.video) {
        return await sock.sendMessage(chatId, {
          text: `❌ Solde insuffisant !\n\n💰 Ton solde : *${user.coins.toLocaleString()} 🪙*\n💵 Prix requis : *${DOWNLOAD_PRICES.video} 🪙*`
        }, { quoted: msg });
      }

      // ── Trouver la vidéo ──────────────────────────────────────────────────
      let videoUrl, videoTitle, videoThumb;

      if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
        videoUrl = searchQuery;
        videoTitle = 'Vidéo';
      } else {
        await sock.sendMessage(chatId, { text: `🔍 Recherche *"${searchQuery}"* en *${quality}p*...` }, { quoted: msg });
        
        const search = await yts(searchQuery);
        if (!search?.videos?.length) {
          return await sock.sendMessage(chatId, {
            text: `❌ Aucune vidéo trouvée pour *"${searchQuery}"*`
          }, { quoted: msg });
        }

        const v = search.videos[0];
        videoUrl = v.url;
        videoTitle = v.title;
        videoThumb = v.thumbnail;
      }

      // ── Débiter l'utilisateur ───────────────────────────────────────────────
      eco.removeCoins(sender, DOWNLOAD_PRICES.video);
      debited = true;

      const remainingBalance = eco.getUser(sender).coins;
      const initialCaption = `*${videoTitle || searchQuery}*\n📺 Résolution: *${quality}p*\n⚡ -${DOWNLOAD_PRICES.video} 🪙 | Solde : ${remainingBalance.toLocaleString()} 🪙\n\n⏳ Téléchargement en cours...`;

      // ── Envoyer miniature ─────────────────────────────────────────────────
      try {
        const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        const thumb = videoThumb || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : null);
        if (thumb) {
          await sock.sendMessage(chatId, {
            image: { url: thumb },
            caption: initialCaption
          }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { text: initialCaption }, { quoted: msg });
        }
      } catch (_) {}

      // ── Essayer les APIs en chaîne ────────────────────────────────────────
      let downloadUrl = null;
      let finalTitle = videoTitle;

      for (const api of VIDEO_APIS) {
        try {
          console.log(`[VIDEO] Trying ${api.name} (${quality}p)...`);
          const result = await api.fetch(videoUrl, quality);
          downloadUrl = result.downloadUrl;
          if (result.title) finalTitle = result.title;
          console.log(`[VIDEO] ✅ Success via ${api.name}`);
          break;
        } catch (err) {
          console.log(`[VIDEO] ❌ ${api.name} failed: ${err.message}`);
        }
      }

      if (!downloadUrl) {
        if (debited) eco.addCoins(sender, DOWNLOAD_PRICES.video);
        return await sock.sendMessage(chatId, {
          text: '❌ Impossible de télécharger cette vidéo. Toutes les sources ont échoué. Tu as été remboursé.'
        }, { quoted: msg });
      }

      const safeName = (finalTitle || 'video').replace(/[^\w\s\-]/g, '').trim().slice(0, 60);

      await sock.sendMessage(chatId, {
        video: { url: downloadUrl },
        mimetype: 'video/mp4',
        fileName: `${safeName}.mp4`,
        caption: `*${finalTitle || searchQuery}*\n📺 Qualité: ${quality}p\n\n> *_Downloaded by ${config.botName}_*`
      }, { quoted: msg });

    } catch (error) {
      console.error('[VIDEO] Fatal error:', error.message);
      if (debited) eco.addCoins(extra.sender, DOWNLOAD_PRICES.video);
      await sock.sendMessage(msg.key.remoteJid, {
        text: `❌ Erreur: ${error.message}. Tu as été remboursé.`
      }, { quoted: msg });
    }
  }
};
