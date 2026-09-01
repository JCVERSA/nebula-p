/**
 * Song Downloader — Nebula Bot by Dark Neon
 * Télécharge l'audio depuis YouTube via chaîne d'APIs avec fallbacks robustes
 */

const yts = require('yt-search');
const axios = require('axios');
const eco = require('../../utils/economy');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const DOWNLOAD_PRICES = {
  song: 50,
};

// ── APIs de téléchargement audio (par ordre de fiabilité) ────────────────────
const AUDIO_APIS = [
  {
    name: 'cobalt',
    fetch: async (url) => {
      const res = await axios.post('https://api.cobalt.tools/api/json', {
        url,
        aFormat: 'mp3',
        isAudioOnly: true,
        disableMetadata: false
      }, {
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        timeout: 20000
      });
      if (res.data?.url) return { downloadUrl: res.data.url, title: null };
      throw new Error('cobalt: no url');
    }
  },
  {
    name: 'yt-api.p.rapidapi (no-key fallback)',
    fetch: async (url) => {
      const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (!videoId) throw new Error('No video ID');
      const res = await axios.get(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
          'X-RapidAPI-Key': 'SIGN-UP-FOR-KEY'
        },
        timeout: 20000
      });
      if (res.data?.link) return { downloadUrl: res.data.link, title: res.data.title };
      throw new Error('rapidapi: no link');
    }
  },
  {
    name: 'y2mate',
    fetch: async (url) => {
      const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (!videoId) throw new Error('No video ID');
      // Step 1: analyze
      const analyze = await axios.post('https://www.y2mate.com/mates/analyzeV2/ajax', new URLSearchParams({
        k_query: `https://www.youtube.com/watch?v=${videoId}`,
        k_page: 'home', hl: 'en', q_auto: '0'
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
      const k = analyze.data?.links?.mp3?.mp3128?.k;
      if (!k) throw new Error('y2mate: no key');
      // Step 2: convert
      const convert = await axios.post('https://www.y2mate.com/mates/convertV2/index', new URLSearchParams({
        vid: videoId, k
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
      if (convert.data?.dlink) return { downloadUrl: convert.data.dlink, title: convert.data.title };
      throw new Error('y2mate: no dlink');
    }
  },
  {
    name: 'EliteProTech',
    fetch: async (url) => {
      const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.success && res.data?.downloadURL) return { downloadUrl: res.data.downloadURL, title: res.data.title };
      throw new Error('EliteProTech: no url');
    }
  },
  {
    name: 'Okatsu',
    fetch: async (url) => {
      const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.dl) return { downloadUrl: res.data.dl, title: res.data.title };
      throw new Error('Okatsu: no url');
    }
  },
  {
    name: 'Yupra',
    fetch: async (url) => {
      const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.success && res.data?.data?.download_url) return { downloadUrl: res.data.data.download_url, title: res.data.data.title };
      throw new Error('Yupra: no url');
    }
  },
  {
    name: 'Izumi',
    fetch: async (url) => {
      const res = await axios.get(`https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(url)}&format=mp3`, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.result?.download) return { downloadUrl: res.data.result.download, title: res.data.result.title };
      throw new Error('Izumi: no url');
    }
  }
];

// ── Télécharger le buffer depuis une URL ──────────────────────────────────────
async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*'
    }
  });
  const buf = Buffer.from(res.data);
  if (!buf || buf.length < 1000) throw new Error('Buffer trop petit ou vide');
  return buf;
}

module.exports = {
  name: 'song',
  aliases: ['play', 'music', 'yta', 'mp3'],
  category: 'media',
  description: 'Télécharger l\'audio depuis YouTube',
  usage: '.song <nom ou lien YouTube>',

  async execute(sock, msg, args, extra) {
    let debited = false;
    try {
      const text = args.join(' ').trim();
      const chatId = msg.key.remoteJid;
      const sender = extra.sender;

      if (!text) {
        return await sock.sendMessage(chatId, {
          text: '🎵 Usage: .song <nom de la chanson ou lien YouTube>\n\nEx: .song Burna Boy Last Last'
        }, { quoted: msg });
      }

      // ── Vérification solde ──────────────────────────────────────────────────
      const user = eco.getUser(sender);
      if (user.coins < DOWNLOAD_PRICES.song) {
        return await sock.sendMessage(chatId, {
          text: `❌ Solde insuffisant !\n\n💰 Ton solde : *${user.coins.toLocaleString()} 🪙*\n💵 Prix requis : *${DOWNLOAD_PRICES.song} 🪙*`
        }, { quoted: msg });
      }

      // ── Trouver la vidéo ────────────────────────────────────────────────────
      let videoUrl, videoTitle, videoThumb, videoDuration;

      if (text.includes('youtube.com') || text.includes('youtu.be')) {
        videoUrl = text;
        videoTitle = 'Audio';
      } else {
        await sock.sendMessage(chatId, { text: `🔍 Recherche *"${text}"*...` }, { quoted: msg });
        const search = await yts(text);
        if (!search?.videos?.length) {
          return await sock.sendMessage(chatId, { text: `❌ Aucun résultat pour *"${text}"*` }, { quoted: msg });
        }
        const v = search.videos[0];
        videoUrl = v.url;
        videoTitle = v.title;
        videoThumb = v.thumbnail;
        videoDuration = v.timestamp;
      }

      // ── Débiter l'utilisateur ───────────────────────────────────────────────
      eco.removeCoins(sender, DOWNLOAD_PRICES.song);
      debited = true;

      // ── Envoyer la miniature ────────────────────────────────────────────────
      const remainingBalance = eco.getUser(sender).coins;
      const initialCaption = `🎵 *${videoTitle}*\n⏱ ${videoDuration || ''}\n⚡ -${DOWNLOAD_PRICES.song} 🪙 | Solde : ${remainingBalance.toLocaleString()} 🪙\n\n⏳ Téléchargement en cours...`;

      try {
        if (videoThumb) {
          await sock.sendMessage(chatId, {
            image: { url: videoThumb },
            caption: initialCaption
          }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { text: initialCaption }, { quoted: msg });
        }
      } catch (_) {}

      // ── Essayer les APIs en chaîne ──────────────────────────────────────────
      let audioBuffer = null;

      for (const api of AUDIO_APIS) {
        try {
          console.log(`[SONG] Trying ${api.name}...`);
          const { downloadUrl, title } = await api.fetch(videoUrl);
          if (title && title !== 'null') videoTitle = title;
          audioBuffer = await downloadBuffer(downloadUrl);
          console.log(`[SONG] ✅ Success via ${api.name} (${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
          break;
        } catch (err) {
          console.log(`[SONG] ❌ ${api.name} failed: ${err.message}`);
        }
      }

      if (!audioBuffer) {
        // Remboursement si échec
        if (debited) eco.addCoins(sender, DOWNLOAD_PRICES.song);
        return await sock.sendMessage(chatId, {
          text: '❌ Impossible de télécharger cette chanson. Toutes les sources ont échoué. Tu as été remboursé.'
        }, { quoted: msg });
      }

      // ── Fix Feature 3 : Conversion AAC pour WhatsApp ────────────────────────
      const safeName = (videoTitle || 'audio').replace(/[^\w\s\-]/g, '').trim().slice(0, 60);
      const tmpIn  = path.join(os.tmpdir(), `nebula_in_${Date.now()}.mp3`);
      const tmpOut = path.join(os.tmpdir(), `nebula_out_${Date.now()}.m4a`);

      try {
        fs.writeFileSync(tmpIn, audioBuffer);
        execSync(`ffmpeg -y -i "${tmpIn}" -c:a aac -b:a 128k -movflags +faststart "${tmpOut}"`, { timeout: 60000 });
        const aacBuffer = fs.readFileSync(tmpOut);

        await sock.sendMessage(chatId, {
          audio: aacBuffer,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName: `${safeName}.m4a`
        }, { quoted: msg });

      } catch (ffmpegErr) {
        // Fallback sans conversion si ffmpeg absent
        console.warn('[SONG] ffmpeg convert failed, sending raw:', ffmpegErr.message);
        await sock.sendMessage(chatId, {
          audio: audioBuffer,
          mimetype: 'audio/mp4', // forcer mp4 même sur le raw
          ptt: false,
          fileName: `${safeName}.m4a`
        }, { quoted: msg });
      } finally {
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(tmpOut); } catch {}
      }

    } catch (err) {
      console.error('[SONG] Fatal error:', err.message);
      if (debited) eco.addCoins(extra.sender, DOWNLOAD_PRICES.song);
      await sock.sendMessage(msg.key.remoteJid, {
        text: `❌ Erreur: ${err.message}. Tu as été remboursé.`
      }, { quoted: msg });
    }
  }
};
