/**
 * AnimeRec Command — Nebula Bot by Dark Neon
 * Recommandations d'animes basées sur un titre donné
 * Utilise les recommandations AniList + algorithme de pertinence par genre
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

// 1. Chercher l'anime de base + ses recommandations officielles
const REC_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
    id
    title { romaji english native }
    genres
    averageScore
    coverImage { extraLarge large }
    siteUrl
    recommendations(sort: RATING_DESC, perPage: 10) {
      nodes {
        mediaRecommendation {
          id
          title { romaji english native }
          format
          status
          episodes
          averageScore
          genres
          coverImage { extraLarge large }
          siteUrl
          description(asHtml: false)
        }
        rating
      }
    }
  }
}`;

// 2. Si pas assez de recs AniList, compléter par genre
const GENRE_QUERY = `
query ($genres: [String], $excludeId: Int, $page: Int) {
  Page(page: $page, perPage: 10) {
    media(
      type: ANIME
      genre_in: $genres
      sort: SCORE_DESC
      format_in: [TV, MOVIE, ONA, OVA]
      id_not: $excludeId
    ) {
      id
      title { romaji english native }
      format
      status
      episodes
      averageScore
      genres
      coverImage { extraLarge large }
      siteUrl
    }
  }
}`;

function cleanDesc(text) {
  if (!text) return 'No description available.';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/~!/g, '').replace(/!~/g, '')
    .substring(0, 220) + '...';
}

function formatStatus(s) {
  return { FINISHED: '✅ Terminé', RELEASING: '📺 En cours', NOT_YET_RELEASED: '🕐 À venir', CANCELLED: '❌ Annulé' }[s] || s;
}

function genreMatch(recGenres, baseGenres) {
  if (!recGenres || !baseGenres) return 0;
  return recGenres.filter(g => baseGenres.includes(g)).length;
}

// Sessions pour la navigation des détails: { userId: results[] }
const recSessions = new Map();

module.exports = {
  name: 'animerec',
  aliases: ['rec', 'recommend', 'similar', 'likeanime', 'anirec'],
  category: 'anime',
  description: 'Recommandations d\'animes similaires à un titre donné',
  usage: '.animerec <nom anime>\n.animerec <numéro> — détails',

  async execute(sock, msg, args, extra) {
    try {
      const userId = extra.sender;
      const first  = args[0];

      if (!first) {
        return extra.reply(
          `🎯 *AnimeRec*\n\n` +
          `Reçois des recommandations basées sur un anime!\n\n` +
          `Usage: *.animerec <nom anime>*\n\n` +
          `Exemples:\n` +
          `  .animerec Attack on Titan\n` +
          `  .animerec Your Name\n` +
          `  .animerec Demon Slayer\n\n` +
          `Puis: *.animerec 3* pour les détails du 3ème résultat`
        );
      }

      // ── Afficher les détails d'une reco ──────────────────────────────────
      const numArg = parseInt(first);
      const session = recSessions.get(userId);
      if (!isNaN(numArg) && session?.recs) {
        const idx = numArg - 1;
        if (idx < 0 || idx >= session.recs.length)
          return extra.reply(`❌ Numéro invalide. Choisis entre 1 et ${session.recs.length}.`);

        const a     = session.recs[idx];
        const title = a.title.english || a.title.romaji;
        const desc  = cleanDesc(a.description || a.desc);
        const score = a.averageScore ? `${a.averageScore}/100 ⭐` : 'N/A';
        const genre = a.genres?.slice(0, 5).join(', ') || 'N/A';
        const eps   = a.episodes || 'N/A';
        const matchCount = genreMatch(a.genres, session.baseGenres);

        const text =
          `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
          `┃ 🎯 *ANIME RECOMMANDÉ*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `📌 *${title}*\n` +
          `🇯🇵 ${a.title.native || 'N/A'}\n\n` +
          `📺 *Format:* ${a.format?.replace(/_/g, ' ') || 'N/A'}\n` +
          `📊 *Statut:* ${formatStatus(a.status)}\n` +
          `🎬 *Épisodes:* ${eps}\n` +
          `⭐ *Score:* ${score}\n` +
          `🎭 *Genres:* ${genre}\n` +
          `🔗 *Genres en commun:* ${matchCount} avec *${session.baseName}*\n\n` +
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

      // ── Nouvelle recherche de recos ───────────────────────────────────────
      const query = args.join(' ').trim();
      await extra.reply(`🎯 Recherche de recommandations pour *"${query}"*...`);

      const { data } = await axios.post(ANILIST_API, {
        query: REC_QUERY,
        variables: { search: query }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000
      });

      const base = data?.data?.Media;
      if (!base) return extra.reply(`❌ Anime *"${query}"* introuvable. Essaie un autre nom.`);

      const baseName   = base.title.english || base.title.romaji;
      const baseGenres = base.genres || [];

      // Récupérer les recos AniList officielles
      let recs = (base.recommendations?.nodes || [])
        .filter(n => n?.mediaRecommendation)
        .map(n => ({
          ...n.mediaRecommendation,
          recRating: n.rating,
          source: 'anilist'
        }));

      // Si moins de 5 recos officielles → compléter par genre
      if (recs.length < 5 && baseGenres.length) {
        try {
          const { data: gData } = await axios.post(ANILIST_API, {
            query: GENRE_QUERY,
            variables: { genres: baseGenres.slice(0, 3), excludeId: base.id, page: 1 }
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          });

          const extraRecs = (gData?.data?.Page?.media || [])
            .filter(a => !recs.find(r => r.id === a.id)) // éviter les doublons
            .map(a => ({ ...a, recRating: 0, source: 'genre' }));

          recs = [...recs, ...extraRecs];
        } catch {}
      }

      if (!recs.length)
        return extra.reply(`😔 Aucune recommandation trouvée pour *"${baseName}"*.\nEssaie avec un titre plus populaire.`);

      // Trier: d'abord par pertinence de genre, puis par score
      recs = recs
        .map(a => ({ ...a, genreScore: genreMatch(a.genres, baseGenres) }))
        .sort((a, b) => {
          if (b.recRating !== a.recRating) return b.recRating - a.recRating;
          if (b.genreScore !== a.genreScore) return b.genreScore - a.genreScore;
          return (b.averageScore || 0) - (a.averageScore || 0);
        })
        .slice(0, 10);

      // Sauvegarder la session
      recSessions.set(userId, { baseName, baseGenres, recs });
      setTimeout(() => recSessions.delete(userId), 5 * 60 * 1000);

      // ── Construire le texte ───────────────────────────────────────────────
      const header =
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 🎯 *ANIME RECOMMANDATIONS*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `✨ Basé sur: *${baseName}*\n` +
        `🎭 Genres: ${baseGenres.slice(0, 4).join(', ')}\n` +
        `📋 ${recs.length} recommandations\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const entries = recs.map((a, i) => {
        const title   = a.title.english || a.title.romaji;
        const score   = a.averageScore ? `⭐ ${a.averageScore}` : 'N/A';
        const eps     = a.episodes ? `${a.episodes} ép.` : '?';
        const genre   = a.genres?.slice(0, 3).join(', ') || 'N/A';
        const match   = a.genreScore > 0 ? `🔗 ${a.genreScore} genre${a.genreScore > 1 ? 's' : ''} en commun` : '';
        const src     = a.source === 'anilist' ? '✅ Recommandé AniList' : '🎭 Similaire par genre';

        return (
          `*${i + 1}.* 🎌 *${title}*\n` +
          `│ 🇯🇵 ${a.title.native || 'N/A'}\n` +
          `│ ${score}  🎬 ${eps}  ${formatStatus(a.status)}\n` +
          `│ 🎭 ${genre}\n` +
          (match ? `│ ${match}\n` : '') +
          `│ ${src}`
        );
      });

      const footer =
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *.animerec <numéro>* pour les détails\n` +
        `Ex: .animerec 1 → détails du premier résultat\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      // Envoyer avec la cover de l'anime de base
      const _baseFb  = base.coverImage?.extraLarge || base.coverImage?.large;
      const coverUrl = await _getRandomAnimeImg(baseName, _baseFb);
      const text     = header + entries.join('\n│\n') + footer;

      await sock.sendMessage(extra.from, {
        image: { url: coverUrl },
        caption: text
      }, { quoted: msg });

    } catch (error) {
      console.error('[ANIMEREC] Error:', error.message);
      await extra.reply('❌ Erreur lors de la récupération des recommandations. Réessaie.');
    }
  }
};
