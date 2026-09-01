/**
 * AniSearch Command — Nebula Bot by Dark Neon
 * Recherche paginée d'animes avec plusieurs résultats
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

const SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      title { romaji english native }
      format
      status
      episodes
      averageScore
      genres
      season
      seasonYear
      coverImage { extraLarge large }
      siteUrl
      description(asHtml: false)
    }
  }
}`;

// Sessions de navigation en mémoire: { userId: { results, page, query } }
const searchSessions = new Map();
const SESSION_TTL = 3 * 60 * 1000; // 3 minutes

function cleanDesc(text) {
  if (!text) return 'No description available.';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/~!/g, '').replace(/!~/g, '')
    .substring(0, 200) + '...';
}

function formatStatus(s) {
  const map = { FINISHED: '✅ Terminé', RELEASING: '📺 En cours', NOT_YET_RELEASED: '🕐 À venir', CANCELLED: '❌ Annulé', HIATUS: '⏸️ En pause' };
  return map[s] || s || 'N/A';
}

function formatFormat(f) {
  const map = { TV: 'TV', TV_SHORT: 'TV Court', MOVIE: '🎬 Film', SPECIAL: '⭐ Spécial', OVA: 'OVA', ONA: 'ONA', MUSIC: '🎵 Musique' };
  return map[f] || f || 'N/A';
}

function buildResultText(mediaList, page, pageInfo, query) {
  const header =
    `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
    `┃ 🔍 *ANIME SEARCH*\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `🔎 *"${query}"*\n` +
    `📊 ${pageInfo.total} résultats — Page ${pageInfo.currentPage}/${pageInfo.lastPage}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const entries = mediaList.map((a, i) => {
    const num   = (page - 1) * 5 + i + 1;
    const title = a.title.english || a.title.romaji;
    const score = a.averageScore ? `⭐ ${a.averageScore}/100` : 'N/A';
    const genre = a.genres?.slice(0, 3).join(', ') || 'N/A';
    const eps   = a.episodes ? `${a.episodes} ép.` : '?';
    const season = a.season && a.seasonYear ? `${a.season} ${a.seasonYear}` : 'N/A';
    return (
      `*${num}.* 🎌 *${title}*\n` +
      `│ 🇯🇵 ${a.title.native || 'N/A'}\n` +
      `│ 📺 ${formatFormat(a.format)}  ${formatStatus(a.status)}\n` +
      `│ 🎬 ${eps}  ${score}\n` +
      `│ 🌸 ${season}\n` +
      `│ 🎭 ${genre}`
    );
  });

  const footer =
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 *Navigation:*\n` +
    `  *.anisearch next* — page suivante\n` +
    `  *.anisearch prev* — page précédente\n` +
    `  *.anisearch <numéro>* — détails (ex: .anisearch 3)\n` +
    `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

  return header + entries.join('\n│\n') + footer;
}

module.exports = {
  name: 'anisearch',
  aliases: ['asearch', 'searchanime', 'findanime'],
  category: 'anime',
  description: 'Recherche paginée d\'animes avec navigation',
  usage: '.anisearch <nom anime>\n.anisearch next/prev\n.anisearch <numéro>',

  async execute(sock, msg, args, extra) {
    try {
      const input = args.join(' ').trim().toLowerCase();
      const userId = extra.sender;

      if (!input) {
        return extra.reply(
          `🔍 *AniSearch*\n\n` +
          `Usage: *.anisearch <nom anime>*\n\n` +
          `Exemples:\n` +
          `  .anisearch Attack on Titan\n` +
          `  .anisearch demon slayer\n\n` +
          `Navigation:\n` +
          `  .anisearch next → page suivante\n` +
          `  .anisearch 3 → détails du résultat 3`
        );
      }

      // ── Navigation ────────────────────────────────────────────────────────
      const session = searchSessions.get(userId);

      if ((input === 'next' || input === 'suivant') && session) {
        if (!session.pageInfo.hasNextPage) return extra.reply('📄 Déjà à la dernière page.');
        return fetchAndSend(sock, msg, extra, session.query, session.pageInfo.currentPage + 1, userId);
      }

      if ((input === 'prev' || input === 'précédent' || input === 'previous') && session) {
        if (session.pageInfo.currentPage <= 1) return extra.reply('📄 Déjà à la première page.');
        return fetchAndSend(sock, msg, extra, session.query, session.pageInfo.currentPage - 1, userId);
      }

      // ── Afficher les détails d'un résultat ───────────────────────────────
      const numArg = parseInt(input);
      if (!isNaN(numArg) && session?.results) {
        const globalIndex = numArg - 1;
        const pageStart   = (session.pageInfo.currentPage - 1) * 5;
        const localIndex  = globalIndex - pageStart;

        if (localIndex < 0 || localIndex >= session.results.length) {
          return extra.reply(`❌ Numéro invalide. Choisis entre ${pageStart + 1} et ${pageStart + session.results.length}.`);
        }

        const a = session.results[localIndex];
        const title = a.title.english || a.title.romaji;
        const desc  = cleanDesc(a.description);
        const score = a.averageScore ? `${a.averageScore}/100 ⭐` : 'N/A';
        const genre = a.genres?.slice(0, 5).join(', ') || 'N/A';
        const eps   = a.episodes || 'N/A';
        const season = a.season && a.seasonYear ? `${a.season} ${a.seasonYear}` : 'N/A';

        const text =
          `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
          `┃ 🎌 *ANIME DETAILS*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `📌 *${title}*\n` +
          `🇯🇵 ${a.title.native || 'N/A'}\n\n` +
          `📺 *Format:* ${formatFormat(a.format)}\n` +
          `📊 *Statut:* ${formatStatus(a.status)}\n` +
          `🎬 *Épisodes:* ${eps}\n` +
          `⭐ *Score:* ${score}\n` +
          `🌸 *Saison:* ${season}\n` +
          `🎭 *Genres:* ${genre}\n\n` +
          `📖 *Synopsis:*\n${desc}\n\n` +
          `🔗 ${a.siteUrl}\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

        const _fb1 = a.coverImage?.extraLarge || a.coverImage?.large;
        const _img1 = await _getRandomAnimeImg(a.title.english || a.title.romaji, _fb1);
        await sock.sendMessage(extra.from, {
          image: { url: _img1 },
          caption: text
        }, { quoted: msg });

        return;
      }

      // ── Nouvelle recherche ────────────────────────────────────────────────
      await fetchAndSend(sock, msg, extra, args.join(' ').trim(), 1, userId);

    } catch (error) {
      console.error('[ANISEARCH] Error:', error.message);
      await extra.reply('❌ Erreur lors de la recherche. Réessaie.');
    }
  }
};

async function fetchAndSend(sock, msg, extra, query, page, userId) {
  await extra.reply(`🔍 Recherche: *"${query}"* (page ${page})...`);

  const { data } = await axios.post(ANILIST_API, {
    query: SEARCH_QUERY,
    variables: { search: query, page, perPage: 5 }
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  const pageData = data?.data?.Page;
  if (!pageData?.media?.length) {
    return extra.reply(`❌ Aucun résultat pour *"${query}"*.`);
  }

  // Sauvegarder la session
  searchSessions.set(userId, {
    query,
    results: pageData.media,
    pageInfo: pageData.pageInfo
  });

  // Expiration automatique
  setTimeout(() => searchSessions.delete(userId), 3 * 60 * 1000);

  const text = buildResultText(pageData.media, page, pageData.pageInfo, query);
  await sock.sendMessage(extra.from, { text }, { quoted: msg });
}
