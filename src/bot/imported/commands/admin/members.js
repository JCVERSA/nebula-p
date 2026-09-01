// Nebula Bot by Dark Neon
/**
 * Members Command - Display all group members
 */

module.exports = {
  name: 'members',
  aliases: ['memberlist', 'listmembers'],
  category: 'admin',
  description: 'Display the full list of group members',
  usage: '.members',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const groupMetadata = await sock.groupMetadata(extra.from);
      const participants = groupMetadata.participants;

      const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
      const members = participants.filter(p => !p.admin);

      let text = `👥 *Members of ${groupMetadata.subject}*\n`;
      text += `📊 Total: *${participants.length}* members\n\n`;

      if (admins.length > 0) {
        text += `👑 *Admins (${admins.length})*\n`;
        text += admins.map(a => `• @${a.id.split('@')[0]}`).join('\n');
        text += '\n\n';
      }

      text += `👤 *Members (${members.length})*\n`;

      // Split into chunks if too many members (WhatsApp limit)
      const chunkSize = 50;
      const memberChunks = [];
      for (let i = 0; i < members.length; i += chunkSize) {
        memberChunks.push(members.slice(i, i + chunkSize));
      }

      text += memberChunks[0].map(m => `• @${m.id.split('@')[0]}`).join('\n');
      if (memberChunks.length > 1) {
        text += `\n_...and ${members.length - chunkSize} more_`;
      }

      const mentions = participants.map(p => p.id);

      await sock.sendMessage(extra.from, {
        text,
        mentions
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
