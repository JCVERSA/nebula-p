/**
 * Anime GIF Reactions — Nebula Bot by Dark Neon
 * Uses nekos.best API (free, no key needed)
 * 35 réactions disponibles
 */

'use strict';

const axios = require('axios');

const REACTIONS = [
  // Affection
  'hug', 'kiss', 'pat', 'cuddle', 'handhold', 'handshake',
  // Émotions
  'cry', 'blush', 'smile', 'laugh', 'wink', 'happy',
  // Actions
  'wave', 'poke', 'slap', 'punch', 'bite', 'kick',
  'highfive', 'throw',
  // Humeur
  'dance', 'nod', 'nope', 'sleep', 'bored', 'think',
  'facepalm', 'thumbsup', 'shrug',
  // Autres
  'nom', 'yeet', 'lurk', 'stare', 'smug',
];

const EMOJI = {
  hug: '🤗', kiss: '😘', pat: '🫶', cuddle: '🥰', handhold: '🤝', handshake: '🤝',
  cry: '😢', blush: '😊', smile: '😄', laugh: '😂', wink: '😉', happy: '😁',
  wave: '👋', poke: '👉', slap: '👋', punch: '👊', bite: '😤', kick: '🦵',
  highfive: '🙌', throw: '🤾',
  dance: '💃', nod: '🙂', nope: '🙅', sleep: '😴', bored: '😑', think: '🤔',
  facepalm: '🤦', thumbsup: '👍', shrug: '🤷',
  nom: '😋', yeet: '🚀', lurk: '👀', stare: '👁️', smug: '😏',
};

// Texte de la réaction selon le contexte
const ACTION_TEXT = {
  hug:       (s, t) => `${s} fait un câlin à ${t}`,
  kiss:      (s, t) => `${s} embrasse ${t}`,
  pat:       (s, t) => `${s} fait des papouilles à ${t}`,
  cuddle:    (s, t) => `${s} se blottit contre ${t}`,
  handhold:  (s, t) => `${s} prend la main de ${t}`,
  handshake: (s, t) => `${s} serre la main de ${t}`,
  slap:      (s, t) => `${s} gifle ${t}`,
  punch:     (s, t) => `${s} frappe ${t}`,
  bite:      (s, t) => `${s} mord ${t}`,
  kick:      (s, t) => `${s} donne un coup de pied à ${t}`,
  poke:      (s, t) => `${s} poke ${t}`,
  highfive:  (s, t) => `${s} tape dans la main de ${t}`,
  wave:      (s, t) => `${s} salue ${t}`,
  throw:     (s, t) => `${s} lance quelque chose à ${t}`,
  yeet:      (s, t) => `${s} yeete ${t}`,
  cry:       (s)    => `${s} pleure...`,
  blush:     (s)    => `${s} rougit`,
  smile:     (s)    => `${s} sourit`,
  laugh:     (s)    => `${s} éclate de rire`,
  wink:      (s)    => `${s} fait un clin d'œil`,
  happy:     (s)    => `${s} est content(e)`,
  dance:     (s)    => `${s} danse`,
  nod:       (s)    => `${s} hoche la tête`,
  nope:      (s)    => `${s} refuse`,
  sleep:     (s)    => `${s} s'endort`,
  bored:     (s)    => `${s} s'ennuie`,
  think:     (s)    => `${s} réfléchit`,
  facepalm:  (s)    => `${s} fait un facepalm`,
  thumbsup:  (s)    => `${s} approuve`,
  shrug:     (s)    => `${s} hausse les épaules`,
  nom:       (s)    => `${s} mange`,
  lurk:      (s)    => `${s} observe en silence`,
  stare:     (s)    => `${s} fixe le vide`,
  smug:      (s)    => `${s} est satisfait(e)`,
};

// Réactions qui ont besoin d'une cible
const NEEDS_TARGET = ['hug','kiss','pat','cuddle','slap','punch','bite','kick','poke','highfive','wave','throw','yeet','handhold','handshake'];

module.exports = {
  name: 'gif',
  aliases: [...REACTIONS, 'reactions', 'react'],
  category: 'anime',
  description: 'GIF réactions anime (hug, kiss, slap, dance...)',
  usage: '.gif <réaction> [@mention] — ou directement .hug @user',

  async execute(sock, msg, args, extra) {
    try {
      // Détecter la commande utilisée
      const rawCmd = msg.message?.extendedTextMessage?.text
        || msg.message?.conversation || '';
      const cmdUsed = rawCmd.split(/\s+/)[0].replace(/^\./, '').toLowerCase();

      let reaction = REACTIONS.includes(cmdUsed) ? cmdUsed : null;

      if (cmdUsed === 'gif' || cmdUsed === 'react') {
        reaction = args[0]?.toLowerCase();
        args = args.slice(1);
      } else if (!reaction) {
        reaction = args[0]?.toLowerCase();
        args = args.slice(1);
      }

      // Afficher la liste si pas de réaction
      if (!reaction || !REACTIONS.includes(reaction)) {
        const groups = {
          '💕 Affection': ['hug','kiss','pat','cuddle','handhold'],
          '😄 Émotions':  ['cry','blush','smile','laugh','wink','happy'],
          '👊 Actions':   ['wave','poke','slap','punch','bite','kick','highfive','yeet'],
          '💃 Humeur':    ['dance','nod','nope','sleep','bored','think','facepalm','shrug','smug'],
          '✨ Autres':    ['nom','lurk','stare','thumbsup','throw','handshake'],
        };
        const lines = Object.entries(groups)
          .map(([cat, rcs]) => `*${cat}*\n${rcs.map(r => `.${r}`).join('  ')}`);
        return extra.reply(
          `🎌 *Réactions Anime disponibles (${REACTIONS.length})*\n\n` +
          lines.join('\n\n') + '\n\n' +
          `Usage : *.hug @user* ou *.gif hug @user*`
        );
      }

      // Résoudre la cible (@mention ou nom)
      const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const senderName   = extra.pushName || msg.pushName || 'Quelqu\'un';
      let targetName     = 'tout le monde';

      if (mentionedJid) {
        // Essayer de résoudre le nom depuis le groupe
        try {
          const meta   = await sock.groupMetadata(extra.from).catch(() => null);
          const member = meta?.participants?.find(p => p.id === mentionedJid);
          targetName   = member?.notify || member?.name || mentionedJid.split('@')[0];
        } catch {
          targetName = mentionedJid.split('@')[0];
        }
      } else if (args.length > 0) {
        targetName = args.join(' ');
      }

      // Construire le texte de la réaction
      const actionFn  = ACTION_TEXT[reaction];
      const needsT    = NEEDS_TARGET.includes(reaction);
      const actionTxt = actionFn
        ? (needsT ? actionFn(senderName, targetName) : actionFn(senderName))
        : `${senderName} ${reaction}s`;
      const emoji = EMOJI[reaction] || '🎌';

      // Fetch GIF depuis nekos.best
      const { data } = await axios.get(`https://nekos.best/api/v2/${reaction}`, { timeout: 10000 });
      const gifUrl   = data?.results?.[0]?.url;
      if (!gifUrl) return extra.reply('❌ GIF introuvable. Réessaie !');

      const caption = `${emoji} *${actionTxt}*\n> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`;

      await sock.sendMessage(extra.from, {
        video: { url: gifUrl },
        gifPlayback: true,
        caption,
        mentions: mentionedJid ? [mentionedJid] : [],
      }, { quoted: msg });

    } catch (error) {
      console.error('[GIF] Error:', error.message);
      await extra.reply('❌ Impossible de récupérer le GIF. Réessaie !');
    }
  }
};
