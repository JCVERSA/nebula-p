/**
 * Seasonal Command — Nebula Bot by Dark Neon
 * Animes de la saison actuelle via AniList GraphQL
 * Tri par popularité, navigation par page, filtre par genre
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

const SEASONAL_QUERY = `
query ($season: MediaSeason, $year: Int, $page: Int, $genre: String) {
  Page(page: $page, perPage: 10) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(
      season: $season
      seasonYear: $year
      type: ANIME
      format_in: [TV, TV_SHORT, ONA, OVA, MOVIE]
      sort: POPULARITY_DESC
      genre: $genre
    ) {
      id
      title { romaji english native }
      format
      status
      episodes
      averageScore
      popularity
      genres
      coverImage { extraLarge large }
      siteUrl
      nextAiringEpisode { episode airingAt }
      studios { nodes { name isAnimationStudio } }
    }
  }
}`;

// Sessions de navigation: { userId: { season, year, page, genre, pageInfo } }
const sessions = new Map();

function getSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 1  && m <= 3)  return 'WINTER';
  if (m >= 4  && m <= 6)  return 'SPRING';
  if (m >= 7  && m <= 9)  return 'SUMMER';
  return 'FALL';
}

function getSeasonEmoji(s) {
  return { WINTER: '❄️', SPRING: '🌸', SUMMER: '☀️', FALL: '🍂' }[s] || '🎌';
}

function timeUntilAiring(airingAt) {
  const diff = airingAt * 1000 - Date.now();
  if (diff <= 0) return 'bientôt';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `dans ${d}j ${h}h`;
  return `dans ${h}h`;
}

function formatStatus(s) {
  return { FINISHED: '✅ Terminé', RELEASING: '📺 En cours', NOT_YET_RELEASED: '🕐 À venir', CANCELLED: '❌ Annulé' }[s] || s;
}

function buildSeasonText(mediaList, pageInfo, season, year, genre) {
  const emoji = getSeasonEmoji(season);
  const genreLine = genre ? `  🎭 Filtre: *${genre}*\n` : '';

  const header =
    `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
    `┃ ${emoji} *SAISON ${season} ${year}*\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `📊 ${pageInfo.total} animes — Page ${pageInfo.currentPage}/${pageInfo.lastPage}\n` +
    genreLine +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const entries = mediaList.map((a, i) => {
    const num    = (pageInfo.currentPage - 1) * 10 + i + 1;
    const title  = a.title.english || a.title.romaji;
    const studio = a.studios?.nodes?.find(s => s.isAnimationStudio)?.name || '?';
    const score  = a.averageScore ? `⭐ ${a.averageScore}` : 'N/A';
    const eps    = a.episodes ? `${a.episodes} ép.` : '?';
    const genre  = a.genres?.slice(0, 3).join(', ') || 'N/A';
    const airing = a.nextAiringEpisode
      ? `📡 Ép. ${a.nextAiringEpisode.episode} ${timeUntilAiring(a.nextAiringEpisode.airingAt)}`
      : formatStatus(a.status);

    return (
      `*${num}.* 🎌 *${title}*\n` +
      `│ 🏢 ${studio}  ${score}  🎬 ${eps}\n` +
      `│ 🎭 ${genre}\n` +
      `│ ${airing}`
    );
  });

  const footer =
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 *Navigation & filtres:*\n` +
    `  .seasonal next — page suivante\n` +
    `  .seasonal prev — page précédente\n` +
    `  .seasonal <saison> <année> — ex: .seasonal winter 2024\n` +
    `  .seasonal genre Action — filtrer par genre\n` +
    `  .seasonal <numéro> — détails d\'un anime\n` +
    `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

  return header + entries.join('\n│\n') + footer;
}

module.exports = {
  name: 'seasonal',
  aliases: ['season', 'saison', 'nowairnig', 'cursaison'],
  category: 'anime',
  description: 'Animes de la saison actuelle ou d\'une saison précise',
  usage: '.seasonal [saison] [année] | .seasonal genre <genre>',

  async execute(sock, msg, args, extra) {
    try {
      const userId = extra.sender;
      let session  = sessions.get(userId);

      const input  = args.join(' ').trim().toLowerCase();
      const first  = args[0]?.toLowerCase();

      // ── Navigation ────────────────────────────────────────────────────────
      if ((first === 'next' || first === 'suivant') && session) {
        if (!session.pageInfo?.hasNextPage)
          return extra.reply('📄 Tu es déjà à la dernière page.');
        return fetchAndSend(sock, msg, extra, session.season, session.year, session.page + 1, session.genre, userId);
      }

      if ((first === 'prev' || first === 'précédent' || first === 'previous') && session) {
        if (session.page <= 1)
          return extra.reply('📄 Tu es déjà à la première page.');
        return fetchAndSend(sock, msg, extra, session.season, session.year, session.page - 1, session.genre, userId);
      }

      // ── Détails d'un résultat ─────────────────────────────────────────────
      const numArg = parseInt(first);
      if (!isNaN(numArg) && session?.results) {
        const pageStart  = (session.page - 1) * 10;
        const localIndex = numArg - 1 - pageStart;
        if (localIndex < 0 || localIndex >= session.results.length)
          return extra.reply(`❌ Numéro invalide. Choisis entre ${pageStart + 1} et ${pageStart + session.results.length}.`);

        const a = session.results[localIndex];
        const title  = a.title.english || a.title.romaji;
        const studio = a.studios?.nodes?.find(s => s.isAnimationStudio)?.name || 'N/A';
        const score  = a.averageScore ? `${a.averageScore}/100 ⭐` : 'N/A';
        const genre  = a.genres?.join(', ') || 'N/A';
        const eps    = a.episodes || 'N/A';
        const airing = a.nextAiringEpisode
          ? `Épisode ${a.nextAiringEpisode.episode} — ${timeUntilAiring(a.nextAiringEpisode.airingAt)}`
          : formatStatus(a.status);

        const text =
          `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
          `┃ 🎌 *ANIME DETAILS*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `📌 *${title}*\n` +
          `🇯🇵 ${a.title.native || 'N/A'}\n\n` +
          `📺 *Format:* ${a.format?.replace(/_/g, ' ') || 'N/A'}\n` +
          `🏢 *Studio:* ${studio}\n` +
          `🎬 *Épisodes:* ${eps}\n` +
          `⭐ *Score:* ${score}\n` +
          `📡 *Diffusion:* ${airing}\n` +
          `🎭 *Genres:* ${genre}\n\n` +
          `🔗 ${a.siteUrl}\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

        await sock.sendMessage(extra.from, {
          image: { url: await _getRandomAnimeImg(a.title.english || a.title.romaji, a.coverImage?.extraLarge || a.coverImage?.large) },
          caption: text
        }, { quoted: msg });
        return;
      }

      // ── Filtre par genre ──────────────────────────────────────────────────
      let genre = null;
      if (first === 'genre' && args[1]) {
        genre = args[1].charAt(0).toUpperCase() + args[1].slice(1).toLowerCase();
        const curSeason = getSeason();
        const curYear   = new Date().getFullYear();
        return fetchAndSend(sock, msg, extra, curSeason, curYear, 1, genre, userId);
      }

      // ── Saison spécifique: .seasonal winter 2024 ─────────────────────────
      const SEASONS = ['winter', 'spring', 'summer', 'fall', 'hiver', 'printemps', 'été', 'automne'];
      const FR_MAP  = { hiver: 'WINTER', printemps: 'SPRING', été: 'SUMMER', automne: 'FALL' };

      if (first && SEASONS.includes(first)) {
        let seasonStr = FR_MAP[first] || first.toUpperCase();
        const yearArg = parseInt(args[1]);
        const year    = yearArg > 2000 && yearArg <= new Date().getFullYear() + 1
          ? yearArg
          : new Date().getFullYear();
        return fetchAndSend(sock, msg, extra, seasonStr, year, 1, null, userId);
      }

      // ── Saison actuelle (défaut) ──────────────────────────────────────────
      const curSeason = getSeason();
      const curYear   = new Date().getFullYear();
      await fetchAndSend(sock, msg, extra, curSeason, curYear, 1, null, userId);

    } catch (error) {
      console.error('[SEASONAL] Error:', error.message);
      await extra.reply('❌ Erreur lors de la récupération des animes. Réessaie.');
    }
  }
};

async function fetchAndSend(sock, msg, extra, season, year, page, genre, userId) {
  const emoji = getSeasonEmoji(season);
  await extra.reply(`${emoji} Chargement *${season} ${year}*${genre ? ` (${genre})` : ''}...`);

  const { data } = await axios.post(ANILIST_API, {
    query: SEASONAL_QUERY,
    variables: { season, year, page, genre: genre || undefined }
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000
  });

  const pageData = data?.data?.Page;
  if (!pageData?.media?.length)
    return extra.reply(`❌ Aucun anime trouvé pour *${season} ${year}*${genre ? ` dans le genre "${genre}"` : ''}.`);

  sessions.set(userId, { season, year, page, genre, results: pageData.media, pageInfo: pageData.pageInfo });
  setTimeout(() => sessions.delete(userId), 5 * 60 * 1000);

  const text = buildSeasonText(pageData.media, pageData.pageInfo, season, year, genre);
  await sock.sendMessage(extra.from, { text }, { quoted: msg });
}
