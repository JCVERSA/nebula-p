// Nebula Bot by Dark Neon
/**
 * Rules Command - Display group rules
 */

const database = require('../../database');

module.exports = {
  name: 'rules',
  aliases: ['rule'],
  category: 'admin',
  description: 'Display the group rules',
  usage: '.rules',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);
      const rules = settings.rules;

      if (!rules) {
        return extra.reply('📋 No rules have been set for this group yet.\n\nAdmins can set rules with: .setrules <rules>');
      }

      const groupName = extra.groupMetadata?.subject || 'This Group';
      await extra.reply(`📋 *Rules of ${groupName}*\n\n${rules}`);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
