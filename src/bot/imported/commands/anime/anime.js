/**
 * Anime Info Command — Nebula Bot by Dark Neon
 * Uses AniList GraphQL API (free, no key needed)
 */

const axios = require('axios');
// ── Image aléatoire via Jikan (intégré) ──────────────────────────────────────
const _jikanCache = new Map();
async function _getRandomAnimeImg(title, fallback) {
  if (!title) return fallback;
  const key = 'anime:' + title.toLowerCase();
  let pool = _jikanCache.get(key);
  if (!pool) {
    try {
      const s = await axios.get('https://api.jikan.moe/v4/anime', {
        params: { q: title, limit: 1, sfw: true }, timeout: 6000,
      });
      const id = s.data?.data?.[0]?.mal_id;
      if (id) {
        const p = await axios.get(`https://api.jikan.moe/v4/anime/${id}/pictures`, { timeout: 6000 });
        pool = (p.data?.data || []).flatMap(x => [x.webp?.large_image_url, x.jpg?.large_image_url, x.webp?.image_url, x.jpg?.image_url]).filter(Boolean);
        if (pool.length) { _jikanCache.set(key, pool); setTimeout(() => _jikanCache.delete(key), 300000); }
      }
    } catch {}
  }
  if (!pool?.length) return fallback;
  return pool[Math.floor(Math.random() * pool.length)];
}
// ─────────────────────────────────────────────────────────────────────────────


const ANILIST_API = 'https://graphql.anilist.co';



const QUERY = `
query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type, sort: POPULARITY_DESC) {
    title { romaji english native }
    description(asHtml: false)
    episodes
    chapters
    status
    averageScore
    genres
    startDate { year month day }
    endDate { year month day }
    coverImage { extraLarge large }
    bannerImage
    siteUrl
    studios { nodes { name isAnimationStudio } }
    format
    season
    seasonYear
  }
}`;

function cleanDesc(text) {
  if (!text) return 'Aucune description disponible.';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .substring(0, 300) + '...';
}

module.exports = {
  name: 'anime',
  aliases: ['aniinfo', 'anisearch'],
  category: 'anime',
  description: 'Search info about an anime using AniList',
  usage: '.anime <anime name>',

  async execute(sock, msg, args, extra) {
    try {
      const query = args.join(' ').trim();
      if (!query) return extra.reply('🎌 Usage : .anime <titre>\nExemple : .anime Naruto');

      await extra.reply('🔍 Recherche en cours…');

      const { data } = await axios.post(ANILIST_API, {
        query: QUERY,
        variables: { search: query, type: 'ANIME' }
      }, { headers: { 'Content-Type': 'application/json' } });

      const a = data?.data?.Media;
      if (!a) return extra.reply('❌ Anime introuvable. Essaie un autre titre.');

      const title = a.title.english || a.title.romaji || a.title.native;
      const studio = a.studios?.nodes?.find(s => s.isAnimationStudio)?.name || 'Unknown';
      const genres = a.genres?.slice(0, 5).join(', ') || 'N/A';
      const score = a.averageScore ? `${a.averageScore}/100 ⭐` : 'N/A';
      const status = a.status?.replace(/_/g, ' ') || 'N/A';
      const format = a.format?.replace(/_/g, ' ') || 'N/A';
      const episodes = a.episodes || 'N/A';
      const season = a.season && a.seasonYear ? `${a.season} ${a.seasonYear}` : 'N/A';
      const desc = cleanDesc(a.description);

      const text =
        `╭━━━━━━━━━━━━━━━━╮\n` +
        `┃ 🎌 *ANIME INFO*\n` +
        `╰━━━━━━━━━━━━━━━━╯\n\n` +
        `📌 *Title:* ${title}\n` +
        `🇯🇵 *Native:* ${a.title.native || 'N/A'}\n` +
        `📺 *Format:* ${format}\n` +
        `📊 *Status:* ${status}\n` +
        `🎬 *Episodes:* ${episodes}\n` +
        `🌸 *Season:* ${season}\n` +
        `⭐ *Score:* ${score}\n` +
        `🎭 *Genres:* ${genres}\n` +
        `🏢 *Studio:* ${studio}\n\n` +
        `📖 *Synopsis:*\n${desc}\n\n` +
        `🔗 ${a.siteUrl}\n\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      const animeTitle2 = a.title.english || a.title.romaji;
      const fallbackImg = a.bannerImage || a.coverImage?.extraLarge || a.coverImage?.large;
      const imageUrl    = await _getRandomAnimeImg(animeTitle2, fallbackImg);
      await sock.sendMessage(extra.from, {
        image: { url: imageUrl },
        caption: text
      }, { quoted: msg });

    } catch (error) {
      console.error('[ANIME] Error:', error.message);
      await extra.reply('❌ Erreur lors de la récupération. Réessaie !');
    }
  }
};
