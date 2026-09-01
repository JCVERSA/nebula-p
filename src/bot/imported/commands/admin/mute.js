// Nebula Bot by Dark Neon
/**
 * Mute Command - Lock/unlock the group (read-only mode)
 */

module.exports = {
  name: 'mute',
  aliases: ['lock', 'lockgroup'],
  category: 'admin',
  description: 'Lock the group so only admins can send messages',
  usage: '.mute',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      await sock.groupSettingUpdate(extra.from, 'announcement');
      await extra.reply('🔇 *Group has been muted!*\n\nOnly admins can send messages now.');
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
