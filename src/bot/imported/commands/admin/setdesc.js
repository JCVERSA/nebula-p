// Nebula Bot by Dark Neon
/**
 * SetDesc Command - Change the group description
 */

module.exports = {
  name: 'setdesc',
  aliases: ['setdescription', 'groupdesc'],
  category: 'admin',
  description: 'Change the group description',
  usage: '.setdesc <description>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply('❌ Please provide a description!\n\nExample: .setdesc Welcome to our group! 🎉\n\nTo clear: .setdesc clear');
      }

      const desc = args[0].toLowerCase() === 'clear' ? '' : args.join(' ');
      await sock.groupUpdateDescription(extra.from, desc);

      if (desc === '') {
        await extra.reply('✅ Group description has been cleared!');
      } else {
        await extra.reply(`✅ Group description updated!`);
      }

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
