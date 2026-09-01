// Nebula Bot by Dark Neon
/**
 * Whois Command — Profil complet d'un membre
 * Stats d'activité, rang, streak, warns, statut admin, photo de profil
 */

const { getStats, getWeekTopMembers, getMemberStreak } = require('../../utils/groupstats');
const database = require('../../database');
const { findParticipant } = require('../../utils/jidHelper');
const config   = require('../../config');

function formatNum(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0);
}

function timeAgo(ts) {
  if (!ts) return 'Inconnu';
  const diff = Date.now() - ts;
  const s    = Math.floor(diff / 1000);
  const m    = Math.floor(s / 60);
  const h    = Math.floor(m / 60);
  const d    = Math.floor(h / 24);
  if (d > 0)  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
  if (h > 0)  return `il y a ${h}h`;
  if (m > 0)  return `il y a ${m} min`;
  return 'à l\'instant';
}

function activityLabel(msgs) {
  if (msgs >= 200) return '🔥 Très actif';
  if (msgs >= 100) return '💬 Actif';
  if (msgs >= 30)  return '🌱 Modéré';
  if (msgs >= 5)   return '💤 Peu actif';
  return '👻 Fantôme';
}

module.exports = {
  name: 'whois',
  aliases: ['profile', 'profil', 'wi', 'userinfo', 'ui'],
  category: 'general',
  description: 'Profil complet d\'un membre (stats, rang, warns, streak...)',
  usage: '.whois @user',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const from = extra.from;
      const ctx  = msg.message?.extendedTextMessage?.contextInfo;

      // ── Résoudre la cible ────────────────────────────────────────────────
      let target = ctx?.mentionedJid?.[0] || null;

      // Si reply à un message
      if (!target && ctx?.quotedMessage) {
        target = ctx.participant || null;
      }

      // Si numéro brut dans les args
      if (!target && args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num.length >= 6) target = `${num}@s.whatsapp.net`;
      }

      // Si pas de cible → profil de l'expéditeur
      if (!target) target = extra.sender;

      // ── Métadonnées du groupe ────────────────────────────────────────────
      const metadata = await sock.groupMetadata(from);
      const participant = findParticipant(metadata.participants, target);

      if (!participant) {
        return extra.reply('❌ Cet utilisateur n\'est pas dans le groupe.');
      }

      // Utiliser l'ID réel (LID-aware)
      target = participant.id;
      const number  = target.split('@')[0];
      const isAdmin = participant.admin === 'admin' || participant.admin === 'superadmin';
      const isOwnerGroup = participant.admin === 'superadmin';
      const isBotOwner = (config.ownerNumber || []).includes(number);

      // ── Stats d'activité ─────────────────────────────────────────────────
      const todayStats = getStats(from);
      const weekTop    = getWeekTopMembers(from, 999); // tous les membres
      const streak     = getMemberStreak(from, target);

      // Stats aujourd'hui
      const todayUser  = todayStats?.users?.[target];
      const todayMsgs  = typeof todayUser === 'number' ? todayUser : (todayUser?.msgs || 0);
      const todayMedia = typeof todayUser === 'object' ? (todayUser?.media || 0) : 0;

      // Stats semaine
      const weekEntry = weekTop.find(m => m.uid === target);
      const weekMsgs  = weekEntry?.msgs || 0;
      const weekMedia = weekEntry?.media || 0;

      // Rang dans le groupe aujourd'hui
      let rankToday = '-';
      if (todayStats?.users) {
        const sorted = Object.entries(todayStats.users)
          .map(([uid, s]) => ({ uid, msgs: typeof s === 'number' ? s : (s.msgs || 0) }))
          .sort((a, b) => b.msgs - a.msgs);
        const idx = sorted.findIndex(m => m.uid === target);
        rankToday = idx >= 0 ? `#${idx + 1}` : '-';
      }

      // Rang semaine
      let rankWeek = '-';
      if (weekTop.length) {
        const idx = weekTop.findIndex(m => m.uid === target);
        rankWeek = idx >= 0 ? `#${idx + 1}` : '-';
      }

      // ── Warns ────────────────────────────────────────────────────────────
      const warnData = database.getWarnings(from, target);
      const warnCount = warnData.count || 0;
      const maxWarns  = config.maxWarnings || 3;
      const warnBar   = '⚠️'.repeat(warnCount) + '▫️'.repeat(Math.max(0, maxWarns - warnCount));

      // ── Profil WhatsApp ──────────────────────────────────────────────────
      let ppUrl = null;
      try {
        ppUrl = await sock.profilePictureUrl(target, 'image');
      } catch {}

      let statusText = null;
      try {
        const statusRes = await sock.fetchStatus(target);
        statusText = statusRes?.status || null;
      } catch {}

      // ── Badges ──────────────────────────────────────────────────────────
      const badges = [];
      if (isBotOwner)    badges.push('👑 Owner du bot');
      if (isOwnerGroup)  badges.push('👑 Owner du groupe');
      else if (isAdmin)  badges.push('🛡️ Admin');
      if (streak >= 7)   badges.push('🔥 Streak 7j+');
      if (streak >= 30)  badges.push('💎 Streak 30j+');
      if (weekMsgs >= 200) badges.push('⚡ Top membre');

      const badgeLine = badges.length ? badges.join('  ') : '👤 Membre';
      const activity  = activityLabel(weekMsgs);

      // ── Construire le texte ──────────────────────────────────────────────
      const text =
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 👤 *PROFIL MEMBRE*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +

        `${badgeLine}\n\n` +

        `📱 *Numéro:* +${number}\n` +
        (statusText ? `💬 *Statut:* ${statusText.slice(0, 60)}\n` : '') +
        `\n` +

        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *ACTIVITÉ*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📅 *Aujourd\'hui:* ${formatNum(todayMsgs)} msgs  📎 ${formatNum(todayMedia)} médias\n` +
        `🏆 *Rang aujourd\'hui:* ${rankToday}\n\n` +
        `📆 *Cette semaine:* ${formatNum(weekMsgs)} msgs  📎 ${formatNum(weekMedia)} médias\n` +
        `🏅 *Rang semaine:* ${rankWeek}\n\n` +
        `🔥 *Streak:* ${streak} jour${streak !== 1 ? 's' : ''} consécutif${streak !== 1 ? 's' : ''}\n` +
        `🌡️ *Activité:* ${activity}\n\n` +

        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ *AVERTISSEMENTS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${warnBar}  ${warnCount}/${maxWarns}\n` +
        (warnCount > 0 && warnData.warnings?.length
          ? `📝 Dernier: ${warnData.warnings.at(-1).reason || 'N/A'}\n`
          : '') +
        `\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      // Envoyer avec photo de profil si disponible
      if (ppUrl) {
        await sock.sendMessage(from, {
          image: { url: ppUrl },
          caption: text,
          mentions: [target]
        }, { quoted: msg });
      } else {
        await sock.sendMessage(from, {
          text,
          mentions: [target]
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('[whois] error:', err);
      extra.reply('❌ Erreur lors du chargement du profil.');
    }
  }
};
