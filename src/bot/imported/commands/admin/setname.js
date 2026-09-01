// Nebula Bot by Dark Neon
/**
 * SetName Command - Change the group name
 */

module.exports = {
  name: 'setname',
  aliases: ['groupname', 'rename'],
  category: 'admin',
  description: 'Change the group name',
  usage: '.setname <new name>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply('❌ Please provide a new group name!\n\nExample: .setname My Awesome Group');
      }

      const newName = args.join(' ');

      if (newName.length > 25) {
        return extra.reply('❌ Group name is too long! Maximum 25 characters.');
      }

      await sock.groupUpdateSubject(extra.from, newName);
      await extra.reply(`✅ Group name changed to *${newName}*!`);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
