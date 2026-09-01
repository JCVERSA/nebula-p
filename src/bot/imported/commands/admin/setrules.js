// Nebula Bot by Dark Neon
/**
 * SetRules Command - Set group rules
 */

const database = require('../../database');

module.exports = {
  name: 'setrules',
  aliases: [],
  category: 'admin',
  description: 'Set the group rules',
  usage: '.setrules <rules>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          '📋 Usage: .setrules <rules>\n\n' +
          'Example:\n.setrules 1. Be respectful\n2. No spam\n3. No links\n\n' +
          'To delete rules: .setrules clear'
        );
      }

      if (args[0].toLowerCase() === 'clear') {
        database.updateGroupSettings(extra.from, { rules: null });
        return extra.reply('✅ Group rules have been cleared!');
      }

      const rules = args.join(' ');
      database.updateGroupSettings(extra.from, { rules });
      await extra.reply(`✅ *Group rules updated!*\n\n${rules}`);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
