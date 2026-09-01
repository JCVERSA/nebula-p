// Nebula Bot by Dark Neon
/**
 * Leaderboard Command — Top membres actifs du groupe
 * Envoie une image style nébuleuse spatiale générée avec sharp
 */

const { getStats, getWeekTopMembers, getWeekStats, getPeakHour } = require('../../utils/groupstats');
const { generateLeaderboard } = require('../../utils/nebulaImage');

function formatNum(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0);
}

// Résoudre le nom d'affichage d'un membre
async function resolveName(sock, uid, groupMetadata) {
  try {
    const number = uid.split('@')[0];
    // Chercher dans les participants du groupe
    const p = groupMetadata?.participants?.find(p =>
      p.id === uid || p.id?.split('@')[0] === number ||
      p.phoneNumber?.split('@')[0] === number
    );
    if (p?.notify) return p.notify;

    // Essayer getContactInfo
    const info = await sock.getContactInfo?.(uid).catch(() => null);
    if (info?.notify || info?.name) return info.notify || info.name;

    return number;
  } catch {
    return uid.split('@')[0];
  }
}

module.exports = {
  name: 'leaderboard',
  aliases: ['lb', 'top', 'topactive'],
  category: 'general',
  description: 'Top membres les plus actifs du groupe (image style nébuleuse)',
  usage: '.leaderboard [week]',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const isWeek = args[0]?.toLowerCase() === 'week' || args[0]?.toLowerCase() === 'semaine';
      const from   = extra.from;

      // Récupérer les métadonnées du groupe
      let groupMetadata = null;
      try { groupMetadata = await sock.groupMetadata(from); } catch {}
      const groupName = groupMetadata?.subject || 'Groupe';

      await extra.reply('🌌 _Génération du leaderboard..._');

      // ── Mode SEMAINE ──────────────────────────────────────────────────────
      if (isWeek) {
        const top  = getWeekTopMembers(from, 10);
        if (!top.length) return extra.reply('📊 Pas encore assez d\'activité cette semaine.');

        const week      = getWeekStats(from);
        const totalWeek = week.reduce((acc, { data }) => acc + (data?.total || 0), 0);

        // Résoudre les noms
        const members = await Promise.all(top.map(async (m) => {
          const name = await resolveName(sock, m.uid, groupMetadata);
          const pct  = totalWeek > 0 ? ((m.msgs / totalWeek) * 100).toFixed(1) : '0.0';
          return { ...m, name, pct };
        }));

        // Graphe 7 jours pour la légende texte
        const dayLines = week.map(({ date, data }) => {
          const count = data?.total || 0;
          const bar   = count > 0 ? '█'.repeat(Math.min(Math.ceil(count / 5), 8)) : '░';
          return `${date.slice(5)} ${bar} ${formatNum(count)}`;
        }).join('\n');

        // Générer l'image
        let imageBuffer = null;
        try {
          imageBuffer = await generateLeaderboard({
            groupName,
            period: '7 Derniers Jours',
            total: totalWeek,
            peakHour: null,
            members: members.slice(0, 8)
          });
        } catch (imgErr) {
          console.error('[LB] Image error:', imgErr.message);
        }

        const caption =
          `🌌 *LEADERBOARD — 7 JOURS*\n\n` +
          `📨 *Total:* ${formatNum(totalWeek)} messages\n\n` +
          `📅 *Activité journalière:*\n${dayLines}\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

        if (imageBuffer) {
          await sock.sendMessage(from, {
            image: imageBuffer,
            caption,
            mentions: top.map(m => m.uid)
          }, { quoted: msg });
        } else {
          await sock.sendMessage(from, {
            text: caption,
            mentions: top.map(m => m.uid)
          }, { quoted: msg });
        }
        return;
      }

      // ── Mode AUJOURD'HUI ──────────────────────────────────────────────────
      const stats = getStats(from);
      if (!stats) return extra.reply('📊 Pas encore d\'activité enregistrée aujourd\'hui.');

      const { total, users, media = 0, commands = 0 } = stats;
      const sortedUsers = Object.entries(users)
        .map(([uid, s]) => ({
          uid,
          msgs:  typeof s === 'number' ? s : (s.msgs || 0),
          media: typeof s === 'object' ? (s.media || 0) : 0,
          cmds:  typeof s === 'object' ? (s.commands || 0) : 0
        }))
        .sort((a, b) => b.msgs - a.msgs)
        .slice(0, 10);

      if (!sortedUsers.length) return extra.reply('📊 Aucune activité enregistrée aujourd\'hui.');

      const peakHour = getPeakHour(from);
      const peakTxt  = peakHour ? `${peakHour.hour}h00 (${peakHour.count} msgs)` : null;

      // Résoudre les noms
      const members = await Promise.all(sortedUsers.map(async (m) => {
        const name = await resolveName(sock, m.uid, groupMetadata);
        const pct  = total > 0 ? ((m.msgs / total) * 100).toFixed(1) : '0.0';
        return { ...m, name, pct };
      }));

      // Générer l'image
      let imageBuffer = null;
      try {
        imageBuffer = await generateLeaderboard({
          groupName,
          period: 'Aujourd\'hui',
          total,
          peakHour: peakTxt,
          members: members.slice(0, 8)
        });
      } catch (imgErr) {
        console.error('[LB] Image error:', imgErr.message);
      }

      const caption =
        `🌌 *LEADERBOARD — AUJOURD'HUI*\n\n` +
        `📨 ${formatNum(total)} msgs  📎 ${formatNum(media)} médias  ⚡ ${formatNum(commands)} cmds\n` +
        (peakTxt ? `🕐 Pic: ${peakTxt}\n` : '') +
        `\n💡 *.leaderboard week* pour les 7 jours\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      if (imageBuffer) {
        await sock.sendMessage(from, {
          image: imageBuffer,
          caption,
          mentions: sortedUsers.map(m => m.uid)
        }, { quoted: msg });
      } else {
        // Fallback texte si sharp échoue
        await sock.sendMessage(from, {
          text: caption,
          mentions: sortedUsers.map(m => m.uid)
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('[leaderboard] error:', err);
      extra.reply('❌ Erreur lors du chargement du leaderboard.');
    }
  }
};
