// Nebula Bot by Dark Neon
/**
 * TagAdmins Command - Tag only group admins
 */

module.exports = {
  name: 'tagadmins',
  aliases: ['admins', 'calladmins'],
  category: 'admin',
  description: 'Tag all admins in the group',
  usage: '.tagadmins [message]',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const groupMetadata = await sock.groupMetadata(extra.from);
      const admins = groupMetadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');

      if (admins.length === 0) {
        return extra.reply('❌ No admins found in this group!');
      }

      const mentions = admins.map(a => a.id);
      const text = args.join(' ') || '📢 Attention admins!';
      const adminList = admins.map(a => `@${a.id.split('@')[0]}`).join('\n');

      await sock.sendMessage(extra.from, {
        text: `👑 *Group Admins*\n\n${adminList}\n\n${text}`,
        mentions
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
