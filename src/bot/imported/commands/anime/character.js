/**
 * Character Command — Nebula Bot by Dark Neon (v3)
 * - Recherche par nom OU aléatoire
 * - Images aléatoires via Jikan avec fallback AniList
 * - Gestion d'erreurs complète à chaque étape
 */

'use strict';

const axios = require('axios');

const ANILIST_API = 'https://graphql.anilist.co';
const JIKAN_API   = 'https://api.jikan.moe/v4';

// ── Requête AniList recherche par nom ─────────────────────────────────────────
const SEARCH_QUERY = `
query ($search: String) {
  Character(search: $search) {
    name { full native userPreferred }
    description(asHtml: false)
    image { extraLarge large }
    gender
    age
    dateOfBirth { month day }
    favourites
    siteUrl
    media(perPage: 5, sort: POPULARITY_DESC) {
      nodes {
        title { romaji english }
        format
        averageScore
      }
    }
  }
}`;

// ── Requête AniList aléatoire ─────────────────────────────────────────────────
const POPULAR_ANIME_IDS = [
  1, 5, 6, 15, 16, 20, 21, 30, 31, 32, 97940,
  11061, 9253, 1535, 10087, 820, 2904, 6547,
  11757, 14719, 101922, 113415, 108465, 154587,
  98478, 101281, 100240, 131681, 145064, 163132,
];

const RANDOM_QUERY = `
query ($id: Int, $page: Int) {
  Media(id: $id, type: ANIME) {
    title { romaji english }
    characters(sort: FAVOURITES_DESC, page: $page, perPage: 1) {
      nodes {
        name { full native userPreferred }
        description(asHtml: false)
        image { extraLarge large }
        gender
        age
        dateOfBirth { month day }
        favourites
        siteUrl
      }
    }
  }
}`;

// ── Image aléatoire Jikan ─────────────────────────────────────────────────────
// Cache simple pour éviter de re-fetcher le même perso
const _charCache = new Map();

async function getRandomCharImage(charName, fallback) {
  if (!charName) return fallback;

  // Vérifier le cache (5 min)
  const key = charName.toLowerCase();
  const cached = _charCache.get(key);
  if (cached && Date.now() - cached.ts < 300000) {
    const pool = cached.pool;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : fallback;
  }

  try {
    // Étape 1 : chercher l'ID MAL du personnage
    const searchRes = await axios.get(`${JIKAN_API}/characters`, {
      params: { q: charName, limit: 3 },
      timeout: 6000,
    });
    const malId = searchRes.data?.data?.[0]?.mal_id;
    if (!malId) return fallback;

    // Étape 2 : récupérer toutes les images
    const picsRes = await axios.get(`${JIKAN_API}/characters/${malId}/pictures`, {
      timeout: 6000,
    });
    const pool = (picsRes.data?.data || [])
      .flatMap(p => [p.webp?.large_image_url, p.jpg?.large_image_url, p.webp?.image_url, p.jpg?.image_url])
      .filter(Boolean);

    // Mettre en cache
    _charCache.set(key, { pool, ts: Date.now() });

    if (pool.length === 0) return fallback;
    return pool[Math.floor(Math.random() * pool.length)];

  } catch (err) {
    // Jikan down ou rate-limit → fallback silencieux
    console.warn('[CHARACTER] Jikan fallback:', err.message);
    return fallback;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanDesc(text) {
  if (!text) return 'Aucune description disponible.';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/~!/g, '').replace(/!~/g, '')
    .substring(0, 280) + '…';
}

function birthdayStr(dob) {
  if (!dob || (!dob.month && !dob.day)) return null;
  const months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  return `${dob.day || '?'} ${months[(dob.month || 1) - 1]}`;
}

function buildCharCard(char, animeTitle) {
  const name   = char.name?.full || char.name?.userPreferred || 'Inconnu';
  const native = char.name?.native || '';
  const gender = char.gender === 'Female' ? '♀️ Féminin'
               : char.gender === 'Male'   ? '♂️ Masculin'
               : char.gender || '❓';
  const label  = char.gender === 'Female' ? '🌸 Waifu'
               : char.gender === 'Male'   ? '⚔️ Husbando'
               : '✨ Personnage';
  const age    = char.age || '?';
  const bday   = birthdayStr(char.dateOfBirth);
  const favs   = char.favourites?.toLocaleString('fr-FR') || '0';
  const desc   = cleanDesc(char.description);

  const appearances = char.media?.nodes
    ?.map(m => m.title?.english || m.title?.romaji)
    .filter(Boolean).slice(0, 3).join(', ') || animeTitle || 'N/A';

  return (
    `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
    `┃ ${label}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `👤 *${name}*${native ? `  |  ${native}` : ''}\n\n` +
    `⚧ *Genre :* ${gender}\n` +
    `🎂 *Âge :* ${age}${bday ? `  •  🗓️ ${bday}` : ''}\n` +
    `❤️ *Favoris :* ${favs}\n` +
    `📺 *Apparaît dans :* ${appearances}\n\n` +
    `📖 *Description :*\n${desc}\n\n` +
    `🔗 ${char.siteUrl || 'N/A'}\n\n` +
    `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
  );
}

// ── Envoi avec image ou texte seul si pas d'image ────────────────────────────
async function sendCharResult(sock, msg, extra, char, animeTitle, charName) {
  const text        = buildCharCard(char, animeTitle);
  const fallbackImg = char.image?.extraLarge || char.image?.large || null;
  const imageUrl    = await getRandomCharImage(charName, fallbackImg);

  if (imageUrl) {
    try {
      await sock.sendMessage(extra.from, {
        image: { url: imageUrl },
        caption: text,
      }, { quoted: msg });
      return;
    } catch (imgErr) {
      console.warn('[CHARACTER] Image send failed, trying fallback:', imgErr.message);
      // Si l'image Jikan échoue à l'envoi, retenter avec AniList
      if (fallbackImg && fallbackImg !== imageUrl) {
        try {
          await sock.sendMessage(extra.from, {
            image: { url: fallbackImg },
            caption: text,
          }, { quoted: msg });
          return;
        } catch {}
      }
    }
  }

  // Dernier recours : texte seul
  await sock.sendMessage(extra.from, { text }, { quoted: msg });
}

// ── Commande ──────────────────────────────────────────────────────────────────
module.exports = {
  name: 'character',
  aliases: ['char', 'waifu', 'husbando', 'perso', 'randomchar'],
  category: 'anime',
  description: 'Infos sur un personnage anime (image aléatoire à chaque fois)',
  usage: '.character [nom du personnage]',

  async execute(sock, msg, args, extra) {
    const query = args.join(' ').trim();

    // ── Recherche par nom ──────────────────────────────────────────────────
    if (query) {
      try {
        await extra.reply(`🔍 Recherche de *"${query}"*…`);

        const res = await axios.post(ANILIST_API, {
          query: SEARCH_QUERY,
          variables: { search: query },
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 12000,
        });

        // Vérifier les erreurs GraphQL
        if (res.data?.errors) {
          console.error('[CHARACTER] AniList errors:', JSON.stringify(res.data.errors));
          return extra.reply(`❌ Personnage *"${query}"* introuvable. Essaie un autre nom.`);
        }

        const char = res.data?.data?.Character;
        if (!char) return extra.reply(`❌ Personnage *"${query}"* introuvable. Essaie un autre nom.`);

        const charName = char.name?.full || char.name?.userPreferred || query;
        await sendCharResult(sock, msg, extra, char, null, charName);

      } catch (err) {
        console.error('[CHARACTER] Search error:', err.message);
        if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
          await extra.reply('⏱️ Timeout — AniList est lent en ce moment. Réessaie !');
        } else {
          await extra.reply('❌ Erreur lors de la recherche. Réessaie dans quelques secondes !');
        }
      }
      return;
    }

    // ── Personnage aléatoire ───────────────────────────────────────────────
    try {
      await extra.reply('🎲 Tirage d\'un personnage aléatoire…');

      const animeId = POPULAR_ANIME_IDS[Math.floor(Math.random() * POPULAR_ANIME_IDS.length)];
      const page    = Math.floor(Math.random() * 6) + 1;

      const res = await axios.post(ANILIST_API, {
        query: RANDOM_QUERY,
        variables: { id: animeId, page },
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      const media = res.data?.data?.Media;
      const char  = media?.characters?.nodes?.[0];

      if (!char) return extra.reply('❌ Impossible de trouver un personnage. Réessaie !');

      const animeTitle = media.title?.english || media.title?.romaji || '';
      const charName   = char.name?.full || char.name?.userPreferred || '';

      await sendCharResult(sock, msg, extra, char, animeTitle, charName);

    } catch (err) {
      console.error('[CHARACTER] Random error:', err.message);
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        await extra.reply('⏱️ Timeout — réessaie dans quelques secondes !');
      } else {
        await extra.reply('❌ Erreur lors du tirage. Réessaie !');
      }
    }
  },
};
