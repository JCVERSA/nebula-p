// Nebula Bot by Dark Neon
/**
 * Welcome Command - Enable/disable welcome messages
 */

const database = require('../../database');

module.exports = {
  name: 'welcome',
  aliases: ['welcomeon', 'welcomeoff'],
  category: 'admin',
  description: 'Enable or disable welcome messages for new members',
  usage: '.welcome on/off',
  groupOnly: true,
  featureKey: "welcome",
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const groupId = extra.from;
      const action = args[0]?.toLowerCase();

      if (!action || !['on', 'off'].includes(action)) {
        const settings = database.getGroupSettings(groupId);
        const status = settings.welcome ? '✅ Enabled' : '❌ Disabled';
        const current = settings.welcomeMessage || 'Welcome to {group}, @{name}! 👋';
        return extra.reply(
          `👋 *Welcome Messages*\n\n` +
          `Status: ${status}\n` +
          `Message: _${current}_\n\n` +
          `Usage: .welcome on/off\n` +
          `Customize: .setwelcome <message>\n\n` +
          `Variables: {name} {group} {count}`
        );
      }

      const enable = action === 'on';
      database.updateGroupSettings(groupId, { welcome: enable });

      await extra.reply(`${enable ? '✅' : '❌'} Welcome messages have been *${enable ? 'enabled' : 'disabled'}*!${enable ? '\n\nNew members will now receive a welcome message.' : ''}`);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
