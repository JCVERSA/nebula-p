/**
 * Manga Info Command — Nebula Bot by Dark Neon
 * Uses AniList GraphQL API (free, no key needed)
 */

const axios = require('axios');
// ── Image aléatoire via Jikan (intégré) ──────────────────────────────────────
const _jikanCache = new Map();
async function _getRandomMangaImg(title, fallback) {
  if (!title) return fallback;
  const key = 'manga:' + title.toLowerCase();
  let pool = _jikanCache.get(key);
  if (!pool) {
    try {
      const s = await axios.get('https://api.jikan.moe/v4/manga', {
        params: { q: title, limit: 1 }, timeout: 6000,
      });
      const id = s.data?.data?.[0]?.mal_id;
      if (id) {
        const p = await axios.get(`https://api.jikan.moe/v4/manga/${id}/pictures`, { timeout: 6000 });
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
    chapters
    volumes
    status
    averageScore
    genres
    startDate { year month day }
    endDate { year month day }
    coverImage { extraLarge large }
    bannerImage
    siteUrl
    staff { nodes { name { full } primaryOccupations } }
    format
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
  name: 'manga',
  aliases: ['mangainfo', 'mangasearch'],
  category: 'anime',
  description: 'Search info about a manga using AniList',
  usage: '.manga <manga name>',

  async execute(sock, msg, args, extra) {
    try {
      const query = args.join(' ').trim();
      if (!query) return extra.reply('📚 Usage : .manga <titre>\nExemple : .manga One Piece');

      await extra.reply('🔍 Recherche en cours…');

      const { data } = await axios.post(ANILIST_API, {
        query: QUERY,
        variables: { search: query, type: 'MANGA' }
      }, { headers: { 'Content-Type': 'application/json' } });

      const m = data?.data?.Media;
      if (!m) return extra.reply('❌ Manga introuvable. Essaie un autre titre.');

      const title = m.title.english || m.title.romaji || m.title.native;
      const author = m.staff?.nodes?.find(s => s.primaryOccupations?.includes('Manga Artist') || s.primaryOccupations?.includes('Story'))?.name?.full || 'Unknown';
      const genres = m.genres?.slice(0, 5).join(', ') || 'N/A';
      const score = m.averageScore ? `${m.averageScore}/100 ⭐` : 'N/A';
      const status = m.status?.replace(/_/g, ' ') || 'N/A';
      const format = m.format?.replace(/_/g, ' ') || 'N/A';
      const chapters = m.chapters || 'Ongoing';
      const volumes = m.volumes || 'N/A';
      const desc = cleanDesc(m.description);

      const text =
        `╭━━━━━━━━━━━━━━━━╮\n` +
        `┃ 📚 *MANGA INFO*\n` +
        `╰━━━━━━━━━━━━━━━━╯\n\n` +
        `📌 *Title:* ${title}\n` +
        `🇯🇵 *Native:* ${m.title.native || 'N/A'}\n` +
        `📖 *Format:* ${format}\n` +
        `📊 *Status:* ${status}\n` +
        `📄 *Chapters:* ${chapters}\n` +
        `📦 *Volumes:* ${volumes}\n` +
        `⭐ *Score:* ${score}\n` +
        `🎭 *Genres:* ${genres}\n` +
        `✍️ *Author:* ${author}\n\n` +
        `📖 *Synopsis:*\n${desc}\n\n` +
        `🔗 ${m.siteUrl}\n\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      const mangaTitle2 = m.title.english || m.title.romaji;
      const fallbackImg = m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large;
      const imageUrl    = await _getRandomMangaImg(mangaTitle2, fallbackImg);
      await sock.sendMessage(extra.from, {
        image: { url: imageUrl },
        caption: text
      }, { quoted: msg });

    } catch (error) {
      console.error('[MANGA] Error:', error.message);
      await extra.reply('❌ Erreur lors de la récupération. Réessaie !');
    }
  }
};
