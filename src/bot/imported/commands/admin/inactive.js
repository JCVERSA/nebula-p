// Nebula Bot by Dark Neon
/**
 * Inactive Command - Liste les membres inactifs aujourd'hui
 * Utilise utils/groupstats.js pour une détection fiable
 */

const { getStats } = require('../../utils/groupstats');

module.exports = {
  name: 'inactive',
  aliases: ['silent'],
  category: 'admin',
  description: 'List members who have not sent any message today',
  usage: '.inactive',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      await extra.reply('⏳ Checking activity...');

      const groupMetadata = await sock.groupMetadata(extra.from);
      const allMembers = groupMetadata.participants;

      // Récupérer les stats du jour depuis groupstats.js (persistant, fiable)
      const stats = getStats(extra.from);
      const activeSenders = new Set(stats ? Object.keys(stats.users) : []);

      // Filtrer : membres non-admin qui n'ont pas envoyé de message aujourd'hui
      const inactive = allMembers.filter(p => {
        const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
        return !isAdmin && !activeSenders.has(p.id);
      });

      if (inactive.length === 0) {
        return extra.reply('✅ Everyone has been active today!');
      }

      const mentions = inactive.map(p => p.id);
      const list = inactive.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}`).join('\n');
      const activeCount = allMembers.length - inactive.length;

      await sock.sendMessage(extra.from, {
        text: `😴 *Inactive Members Today*\n\n${list}\n\n` +
              `📊 Stats:\n` +
              `• Active: *${activeCount}*\n` +
              `• Inactive: *${inactive.length}*\n` +
              `• Total: *${allMembers.length}*`,
        mentions
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
