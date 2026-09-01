/**
 * Anime Schedule — Nebula Bot by Dark Neon
 * Planning de diffusion du jour / de la semaine via AniList
 * Countdown prochain épisode
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

// Planning des 7 prochains jours
const SCHEDULE_QUERY = `
query ($from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(
      airingAt_greater: $from
      airingAt_lesser: $to
      sort: TIME
    ) {
      airingAt
      episode
      media {
        id
        title { romaji english native }
        format
        episodes
        averageScore
        popularity
        coverImage { extraLarge large }
        siteUrl
        genres
      }
    }
  }
}`;

const COUNTDOWN_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME, status: RELEASING) {
    title { romaji english native }
    episodes
    averageScore
    status
    coverImage { extraLarge large }
    siteUrl
    genres
    nextAiringEpisode {
      airingAt
      episode
      timeUntilAiring
    }
  }
}`;

const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function formatCountdown(seconds) {
  if (seconds <= 0) return 'maintenant';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(timestamp) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
}

function formatDate(timestamp) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Douala' });
}

module.exports = {
  name: 'schedule',
  aliases: ['planning', 'airing', 'today', 'diffusion', 'countdown'],
  category: 'anime',
  description: 'Planning de diffusion du jour / countdown prochain épisode',
  usage: '.schedule [today|week|<anime>]',

  async execute(sock, msg, args, extra) {
    try {
      const input = args.join(' ').trim().toLowerCase();
      const first = args[0]?.toLowerCase();

      // ── Countdown d'un anime précis ────────────────────────────────────────
      if (args.length > 0 && !['today', 'week', 'semaine', 'demain'].includes(first)) {
        const query = args.join(' ').trim();
        await extra.reply(`⏱️ Recherche du countdown pour *"${query}"*…`);

        const { data } = await axios.post(ANILIST_API, {
          query: COUNTDOWN_QUERY,
          variables: { search: query }
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });

        const a = data?.data?.Media;
        if (!a) return extra.reply(`❌ Anime *"${query}"* introuvable ou pas en cours de diffusion.`);

        const title = a.title.english || a.title.romaji;
        const next  = a.nextAiringEpisode;

        if (!next) {
          return extra.reply(
            `📺 *${title}*\n\n` +
            `❌ Pas de prochain épisode programmé.\n` +
            `📊 Statut : ${a.status?.replace(/_/g, ' ')}\n` +
            `🎬 Épisodes total : ${a.episodes || '?'}`
          );
        }

        const countdown = formatCountdown(next.timeUntilAiring);
        const airDate   = formatDate(next.airingAt);
        const airTime   = formatTime(next.airingAt);
        const progress  = a.episodes ? `${next.episode - 1}/${a.episodes}` : `${next.episode - 1}/?`;

        const text =
          `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
          `┃ ⏱️ *COUNTDOWN ANIME*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `📌 *${title}*\n` +
          `🇯🇵 ${a.title.native || ''}\n\n` +
          `📡 *Prochain épisode :* ${next.episode}\n` +
          `⏳ *Dans :* ${countdown}\n` +
          `📅 *Le :* ${airDate} à ${airTime}\n` +
          `📊 *Progression :* ${progress} épisodes\n` +
          `⭐ *Score :* ${a.averageScore || 'N/A'}/100\n` +
          `🎭 *Genres :* ${a.genres?.slice(0, 4).join(', ')}\n\n` +
          `🔗 ${a.siteUrl}\n> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`;

        await sock.sendMessage(extra.from, {
          image: { url: await _getRandomAnimeImg(a.title.english || a.title.romaji, a.coverImage?.extraLarge || a.coverImage?.large) },
          caption: text
        }, { quoted: msg });
        return;
      }

      // ── Planning du jour ou de la semaine ─────────────────────────────────
      const isWeek   = first === 'week' || first === 'semaine';
      const isTomorrow = first === 'demain';
      const now      = Math.floor(Date.now() / 1000);
      const tzOffset = 1 * 3600; // WAT (Africa/Douala = UTC+1)

      let fromTs, toTs, label;

      if (isWeek) {
        fromTs = now;
        toTs   = now + 7 * 86400;
        label  = 'les 7 prochains jours';
      } else if (isTomorrow) {
        const startOfTomorrow = Math.floor((Date.now() + 86400000) / 86400000) * 86400 - tzOffset;
        fromTs = startOfTomorrow;
        toTs   = startOfTomorrow + 86400;
        label  = 'demain';
      } else {
        // Aujourd'hui
        const startOfDay = Math.floor(Date.now() / 86400000) * 86400 - tzOffset;
        fromTs = startOfDay;
        toTs   = startOfDay + 86400;
        label  = 'aujourd\'hui';
      }

      await extra.reply(`📅 Chargement du planning *${label}*…`);

      // Récupérer toutes les pages si nécessaire
      let allSchedules = [];
      let page = 1;
      let hasNext = true;

      while (hasNext && page <= 3) {
        const { data } = await axios.post(ANILIST_API, {
          query: SCHEDULE_QUERY,
          variables: { from: fromTs, to: toTs, page }
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 12000 });

        const pageData = data?.data?.Page;
        if (!pageData?.airingSchedules?.length) break;

        allSchedules = [...allSchedules, ...pageData.airingSchedules];
        hasNext = pageData.pageInfo.hasNextPage;
        page++;
      }

      if (!allSchedules.length) {
        return extra.reply(`📅 Aucun anime programmé ${label}.`);
      }

      // Grouper par jour (pour la semaine)
      if (isWeek) {
        const byDay = {};
        for (const entry of allSchedules) {
          const d   = new Date(entry.airingAt * 1000);
          const day = DAYS_FR[d.getDay()];
          if (!byDay[day]) byDay[day] = [];
          byDay[day].push(entry);
        }

        const header =
          `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
          `┃ 📅 *PLANNING SEMAINE*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `${allSchedules.length} épisodes programmés\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        const lines = Object.entries(byDay).map(([day, entries]) => {
          const eps = entries.slice(0, 5).map(e => {
            return `  • ${formatTime(e.airingAt)} — ${e.media.title.english || e.media.title.romaji} (ép. ${e.episode})`;
          });
          const more = entries.length > 5 ? `  … +${entries.length - 5} autres` : '';
          return `*${day}* (${entries.length} ép.)\n${eps.join('\n')}${more}`;
        });

        const text = header + lines.join('\n\n') + '\n\n> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_';
        await sock.sendMessage(extra.from, { text }, { quoted: msg });
        return;
      }

      // Aujourd'hui / demain — liste détaillée
      const now2  = Math.floor(Date.now() / 1000);
      const upcomingFirst = allSchedules.find(e => e.airingAt > now2);

      const header =
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 📅 *PLANNING — ${label.toUpperCase()}*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `📺 ${allSchedules.length} épisodes programmés\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const entries = allSchedules.slice(0, 20).map(e => {
        const title    = e.media.title.english || e.media.title.romaji;
        const time     = formatTime(e.airingAt);
        const isPast   = e.airingAt < now2;
        const isNext   = e === upcomingFirst;
        const countdown = !isPast ? ` ⏳ ${formatCountdown(e.airingAt - now2)}` : ' ✅ Diffusé';
        const arrow    = isNext ? ' ← prochain' : '';
        return `${isPast ? '✅' : '📡'} *${time}* — ${title} (ép. ${e.episode})${countdown}${arrow}`;
      });

      const more = allSchedules.length > 20 ? `\n… +${allSchedules.length - 20} autres` : '';
      const text = header + entries.join('\n') + more +
        `\n\n💡 *.schedule <anime>* — countdown précis\n` +
        `💡 *.schedule week* — planning de la semaine\n` +
        `> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`;

      await sock.sendMessage(extra.from, { text }, { quoted: msg });

    } catch (error) {
      console.error('[SCHEDULE] Error:', error.message);
      await extra.reply('❌ Erreur lors du chargement du planning. Réessaie.');
    }
  }
};
