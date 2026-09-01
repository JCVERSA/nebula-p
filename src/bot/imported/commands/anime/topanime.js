/**
 * Top Anime Command — Nebula Bot by Dark Neon
 * Classement des meilleurs animes via AniList
 * Filtres : score, popularité, trending, format, genre
 */

'use strict';

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

const TOP_QUERY = `
query ($sort: [MediaSort], $format: MediaFormat, $genre: String, $page: Int) {
  Page(page: $page, perPage: 10) {
    pageInfo { total currentPage lastPage }
    media(
      type: ANIME
      sort: $sort
      format: $format
      genre: $genre
      isAdult: false
    ) {
      id
      title { romaji english native }
      format
      status
      episodes
      averageScore
      popularity
      genres
      season
      seasonYear
      coverImage { extraLarge large }
      siteUrl
      studios { nodes { name isAnimationStudio } }
    }
  }
}`;

const SORT_MAP = {
  score:      ['SCORE_DESC'],
  popularité: ['POPULARITY_DESC'],
  popular:    ['POPULARITY_DESC'],
  trending:   ['TRENDING_DESC'],
  récent:     ['START_DATE_DESC'],
  recent:     ['START_DATE_DESC'],
  favori:     ['FAVOURITES_DESC'],
};

const FORMAT_MAP = {
  tv: 'TV', film: 'MOVIE', movie: 'MOVIE',
  ova: 'OVA', ona: 'ONA', special: 'SPECIAL',
};

// Sessions par user pour navigation
const sessions = new Map();

function formatStatus(s) {
  return { FINISHED: '✅', RELEASING: '📺', NOT_YET_RELEASED: '🕐', CANCELLED: '❌' }[s] || '';
}

module.exports = {
  name: 'topanime',
  aliases: ['ranking', 'bestanime'],
  category: 'anime',
  description: 'Classement des meilleurs animes',
  usage: '.topanime [score|popularité|trending] [genre] [tv|film|ova]',

  async execute(sock, msg, args, extra) {
    const userId = extra.sender;

    if (!args.length) {
      return extra.reply(
        `🏆 *Top Anime*\n\n` +
        `Usage : *.topanime [critère] [genre] [format]*\n\n` +
        `*Critères :*\n` +
        `  score — meilleure note\n` +
        `  popularité — plus populaires\n` +
        `  trending — tendance actuelle\n` +
        `  récent — les plus récents\n\n` +
        `*Exemples :*\n` +
        `  .topanime score\n` +
        `  .topanime popularité Action\n` +
        `  .topanime trending film\n\n` +
        `  .topanime next — page suivante`
      );
    }

    try {
      const session = sessions.get(userId);
      const first   = args[0].toLowerCase();

      // Navigation
      if (first === 'next' || first === 'suivant') {
        if (!session) return extra.reply('❌ Lance d\'abord une recherche.');
        if (session.page >= session.lastPage) return extra.reply('📄 Déjà à la dernière page.');
        return doFetch(sock, msg, extra, { ...session, page: session.page + 1 }, userId);
      }
      if (first === 'prev' || first === 'précédent') {
        if (!session || session.page <= 1) return extra.reply('📄 Déjà à la première page.');
        return doFetch(sock, msg, extra, { ...session, page: session.page - 1 }, userId);
      }

      // Numéro → détails
      const num = parseInt(first);
      if (!isNaN(num) && session?.results) {
        const a = session.results[num - 1 - (session.page - 1) * 10];
        if (!a) return extra.reply(`❌ Numéro invalide.`);
        const title  = a.title.english || a.title.romaji;
        const studio = a.studios?.nodes?.find(s => s.isAnimationStudio)?.name || 'N/A';
        const text   =
          `🏆 *${title}*\n🇯🇵 ${a.title.native || ''}\n\n` +
          `📺 Format : ${a.format?.replace(/_/g, ' ')}\n` +
          `🎬 Épisodes : ${a.episodes || 'N/A'}\n` +
          `⭐ Score : ${a.averageScore}/100\n` +
          `👥 Popularité : ${a.popularity?.toLocaleString('fr-FR')}\n` +
          `🏢 Studio : ${studio}\n` +
          `🎭 Genres : ${a.genres?.slice(0, 5).join(', ')}\n\n` +
          `🔗 ${a.siteUrl}\n> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`;
        const _fbTop = a.coverImage?.extraLarge || a.coverImage?.large;
        const _imgTop = await _getRandomAnimeImg(a.title.english || a.title.romaji, _fbTop);
        await sock.sendMessage(extra.from, { image: { url: _imgTop }, caption: text }, { quoted: msg });
        return;
      }

      // Parse arguments
      let sort  = SORT_MAP[first] || ['SCORE_DESC'];
      let genre = null;
      let fmt   = null;

      for (const arg of args.slice(1)) {
        const a = arg.toLowerCase();
        if (FORMAT_MAP[a]) fmt = FORMAT_MAP[a];
        else if (SORT_MAP[a]) sort = SORT_MAP[a];
        else genre = arg.charAt(0).toUpperCase() + arg.slice(1);
      }

      await doFetch(sock, msg, extra, { sort, genre, format: fmt, page: 1 }, userId);

    } catch (err) {
      console.error('[TOPANIME]', err.message);
      await extra.reply('❌ Erreur lors du chargement. Réessaie.');
    }
  }
};

async function doFetch(sock, msg, extra, params, userId) {
  const { sort, genre, format, page } = params;
  const sortLabel = Object.entries({ score: 'Score', popularité: 'Popularité', trending: 'Trending', récent: 'Récent' })
    .find(([, v]) => JSON.stringify(SORT_MAP[v.toLowerCase()]) === JSON.stringify(sort))?.[0] || 'Score';

  await extra.reply(`🏆 Chargement top anime (${sortLabel})…`);

  const { data } = await axios.post(ANILIST_API, {
    query: TOP_QUERY,
    variables: { sort, format: format || undefined, genre: genre || undefined, page }
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 12000 });

  const pageData = data?.data?.Page;
  if (!pageData?.media?.length) return extra.reply('❌ Aucun résultat.');

  sessions.set(userId, { ...params, results: pageData.media, lastPage: pageData.pageInfo.lastPage });
  setTimeout(() => sessions.delete(userId), 5 * 60 * 1000);

  const header =
    `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
    `┃ 🏆 *TOP ANIME*${genre ? ` — ${genre}` : ''}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `📊 Page ${page}/${pageData.pageInfo.lastPage}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const medals = ['🥇','🥈','🥉'];
  const entries = pageData.media.map((a, i) => {
    const rank  = (page - 1) * 10 + i + 1;
    const icon  = rank <= 3 ? medals[rank - 1] : `*${rank}.*`;
    const title = a.title.english || a.title.romaji;
    const score = a.averageScore ? `⭐ ${a.averageScore}` : 'N/A';
    const pop   = `👥 ${(a.popularity / 1000).toFixed(0)}k`;
    const eps   = a.episodes ? `${a.episodes} ép.` : '?';
    return `${icon} *${title}*\n│ ${score}  ${pop}  🎬 ${eps}\n│ 🎭 ${a.genres?.slice(0,3).join(', ')}`;
  });

  const text = header + entries.join('\n│\n') +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 *.topanime <numéro>* — détails  |  *.topanime next* — suite\n` +
    `> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`;

  await sock.sendMessage(extra.from, { text }, { quoted: msg });
}
