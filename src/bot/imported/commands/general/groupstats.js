// Nebula Bot by Dark Neon
/**
 * GroupStats Command — Stats du groupe aujourd'hui
 * Envoie une image style nébuleuse avec graphe horaire
 */

const { getStats, getPeakHour } = require('../../utils/groupstats');
const { generateGroupStats }    = require('../../utils/nebulaImage');

function formatNum(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0);
}

async function resolveName(sock, uid, groupMetadata) {
  try {
    const number = uid.split('@')[0];
    const p = groupMetadata?.participants?.find(p =>
      p.id === uid || p.id?.split('@')[0] === number ||
      p.phoneNumber?.split('@')[0] === number
    );
    if (p?.notify) return p.notify;
    const info = await sock.getContactInfo?.(uid).catch(() => null);
    if (info?.notify || info?.name) return info.notify || info.name;
    return number;
  } catch {
    return uid.split('@')[0];
  }
}

module.exports = {
  name: 'groupstats',
  aliases: ['stats', 'gstats', 'topmembers', 'msgs', 'messagestats'],
  category: 'general',
  description: 'Stats du groupe aujourd\'hui avec image nébuleuse',
  usage: '.groupstats',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const from = extra.from;

      const stats = getStats(from);
      if (!stats) return extra.reply('📊 Pas encore d\'activité enregistrée aujourd\'hui.');

      const { total, users, media = 0, commands = 0, hours = {} } = stats;

      if (!total) return extra.reply('📊 Aucune activité enregistrée aujourd\'hui.');

      await extra.reply('🌌 _Génération des stats..._');

      // Métadonnées du groupe
      let groupMetadata = null;
      try { groupMetadata = await sock.groupMetadata(from); } catch {}
      const groupName = groupMetadata?.subject || 'Groupe';

      // Top membres
      const sortedUsers = Object.entries(users)
        .map(([uid, s]) => ({
          uid,
          msgs: typeof s === 'number' ? s : (s.msgs || 0)
        }))
        .sort((a, b) => b.msgs - a.msgs)
        .slice(0, 5);

      // Résoudre les noms du top 5
      const topMembers = await Promise.all(sortedUsers.map(async (m) => {
        const name = await resolveName(sock, m.uid, groupMetadata);
        const pct  = total > 0 ? ((m.msgs / total) * 100).toFixed(1) : '0.0';
        return { name, msgs: m.msgs, pct };
      }));

      // Heure de pointe
      const peakHour = getPeakHour(from);
      const peakTxt  = peakHour ? `${peakHour.hour}h00 (${peakHour.count} msgs)` : null;

      // Données horaires pour le graphe (24 heures)
      const hourlyData = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: hours[String(h)] || 0
      }));

      // Générer l'image
      let imageBuffer = null;
      try {
        imageBuffer = await generateGroupStats({
          groupName,
          total,
          media,
          commands,
          peakHour: peakTxt,
          topMembers,
          hourlyData
        });
      } catch (imgErr) {
        console.error('[GROUPSTATS] Image error:', imgErr.message);
      }

      const caption =
        `🌌 *GROUP STATS — AUJOURD'HUI*\n\n` +
        `📨 *Messages:* ${formatNum(total)}\n` +
        `📎 *Médias:* ${formatNum(media)}\n` +
        `⚡ *Commandes:* ${formatNum(commands)}\n` +
        (peakTxt ? `🕐 *Heure de pointe:* ${peakTxt}\n` : '') +
        `\n🏆 *Top membres:*\n` +
        topMembers.map((m, i) => {
          const icons = ['👑','🥈','🥉','4️⃣','5️⃣'];
          return `${icons[i]} @${m.name} — ${m.msgs} msgs (${m.pct}%)`;
        }).join('\n') +
        `\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      if (imageBuffer) {
        await sock.sendMessage(from, {
          image: imageBuffer,
          caption,
          mentions: sortedUsers.map(m => m.uid)
        }, { quoted: msg });
      } else {
        await sock.sendMessage(from, {
          text: caption,
          mentions: sortedUsers.map(m => m.uid)
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('[groupstats] error:', err);
      extra.reply('❌ Erreur lors du chargement des stats.');
    }
  }
};
