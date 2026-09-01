/**
 * API Integration Utilities — Nebula Bot by Dark Neon
 */

const axios = require('axios');

// ─── Constantes partagées ─────────────────────────────────────────────────────

const AXIOS_DEFAULTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
};

const api = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// ─── Helper : retry automatique ──────────────────────────────────────────────

const tryRequest = async (getter, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getter();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
};

// ─── API Endpoints ────────────────────────────────────────────────────────────

const APIs = {

  // Image Generation - Pollinations AI (gratuit, sans clé)
  generateImage: async (prompt) => {
    try {
      const encoded = encodeURIComponent(prompt);
      const seed = Math.floor(Math.random() * 99999);
      // Retourne directement l'URL de l'image (flux direct)
      const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?seed=${seed}&width=768&height=768&nologo=true`;
      // Vérifier que l'image est accessible
      const response = await axios.get(imageUrl, { timeout: 30000, responseType: 'arraybuffer' });
      return { url: imageUrl, buffer: Buffer.from(response.data) };
    } catch (error) {
      throw new Error('Image generation failed: ' + error.message);
    }
  },

  // ── chatAI supprimé — sera reintégré lors de la prochaine phase IA ──

  // YouTube Download (audio)
  ytDownload: async (url) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/d/ytmp3', { params: { url } });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download YouTube audio');
    }
  },

  // Instagram Download
  igDownload: async (url) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/d/igdl', { params: { url } });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download Instagram content');
    }
  },

  // TikTok Download
  tiktokDownload: async (url) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/d/tiktok', { params: { url } });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download TikTok video');
    }
  },

  // Translate
  translate: async (text, to = 'en') => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/tools/translate', { params: { text, to } });
      return response.data;
    } catch (error) {
      throw new Error('Translation failed');
    }
  },

  // Random Meme
  getMeme: async () => {
    try {
      const response = await api.get('https://meme-api.com/gimme');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch meme');
    }
  },

  // Random Quote
  getQuote: async () => {
    try {
      const response = await api.get('https://api.quotable.io/random');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch quote');
    }
  },

  // Random Joke
  getJoke: async () => {
    try {
      const response = await api.get('https://official-joke-api.appspot.com/random_joke');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch joke');
    }
  },

  // Weather
  getWeather: async (city) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/tools/weather', { params: { city } });
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch weather');
    }
  },

  // Shorten URL
  shortenUrl: async (url) => {
    try {
      const response = await api.get('https://tinyurl.com/api-create.php', { params: { url } });
      return response.data;
    } catch (error) {
      throw new Error('Failed to shorten URL');
    }
  },

  // Wikipedia Search
  wikiSearch: async (query) => {
    try {
      const response = await api.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      return response.data;
    } catch (error) {
      throw new Error('Wikipedia search failed');
    }
  },

  // Screenshot Website - multi-API avec fallback
  screenshotWebsite: async (url) => {
    const apis = [
      `https://api.screenshotone.com/take?url=${encodeURIComponent(url)}&format=jpg`,
      `https://image.thum.io/get/width/1280/${encodeURIComponent(url)}`,
      `https://eliteprotech-apis.zone.id/ssweb?url=${encodeURIComponent(url)}`,
    ];
    for (const apiUrl of apis) {
      try {
        const response = await axios.get(apiUrl, {
          timeout: 20000,
          responseType: 'arraybuffer',
          headers: { 'accept': '*/*', 'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'] }
        });
        if (response.headers['content-type']?.includes('image')) {
          return Buffer.from(response.data);
        }
      } catch (e) {
        continue;
      }
    }
    throw new Error('Failed to take screenshot — all APIs failed');
  },

  // Text to Speech - StreamElements (stable, gratuit)
  textToSpeech: async (text, voice = 'fr-FR-DeniseNeural') => {
    // StreamElements TTS — direct MP3 buffer
    const apis = [
      `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text.slice(0, 200))}`,
      `https://tts.ahmdxr.workers.dev/?text=${encodeURIComponent(text.slice(0, 200))}&lang=fr`,
    ];
    for (const apiUrl of apis) {
      try {
        const response = await axios.get(apiUrl, {
          timeout: 20000,
          responseType: 'arraybuffer',
          headers: { 'accept': '*/*', 'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'] }
        });
        if (response.headers['content-type']?.includes('audio') || response.data?.byteLength > 1000) {
          return Buffer.from(response.data);
        }
      } catch(e) { continue; }
    }
    throw new Error('TTS failed — all APIs unavailable');
  },

  // TikTok Download API (avec parsing)
  getTikTokDownload: async (url) => {
    const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
    try {
      const response = await axios.get(apiUrl, {
        timeout: 15000,
        headers: { 'accept': '*/*', 'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'] }
      });
      if (response.data?.status && response.data?.data) {
        const d = response.data.data;
        const videoUrl = d.urls?.[0] || d.video_url || d.url || d.download_url || null;
        const title = d.metadata?.title || 'TikTok Video';
        return { videoUrl, title };
      }
      throw new Error('Invalid API response');
    } catch (error) {
      throw new Error('TikTok download failed');
    }
  },

  // ─── Song Download APIs ────────────────────────────────────────────────────

  getIzumiDownloadByUrl: async (youtubeUrl) => {
    const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi returned no download');
  },

  getIzumiDownloadByQuery: async (query) => {
    const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(query)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi query returned no download');
  },

  getYupraDownloadByUrl: async (youtubeUrl) => {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
      return { download: res.data.data.download_url, title: res.data.data.title, thumbnail: res.data.data.thumbnail };
    }
    throw new Error('Yupra returned no download');
  },

  getOkatsuDownloadByUrl: async (youtubeUrl) => {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.dl) {
      return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb };
    }
    throw new Error('Okatsu returned no download');
  },

  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
      return { download: res.data.downloadURL, title: res.data.title };
    }
    throw new Error('EliteProTech returned no download');
  },

  // ─── Video Download APIs ───────────────────────────────────────────────────

  getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
      return { download: res.data.downloadURL, title: res.data.title };
    }
    throw new Error('EliteProTech video returned no download');
  },

  getYupraVideoByUrl: async (youtubeUrl) => {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
      return { download: res.data.data.download_url, title: res.data.data.title, thumbnail: res.data.data.thumbnail };
    }
    throw new Error('Yupra video returned no download');
  },

  getOkatsuVideoByUrl: async (youtubeUrl) => {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.mp4) {
      return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu video returned no download');
  }

};

module.exports = APIs;
