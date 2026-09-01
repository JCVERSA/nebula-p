// Nebula Bot by Dark Neon
/**
 * Unmute Command - Unlock the group
 */

module.exports = {
  name: 'unmute',
  aliases: ['unlock', 'unlockgroup'],
  category: 'admin',
  description: 'Unlock the group so everyone can send messages',
  usage: '.unmute',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      await sock.groupSettingUpdate(extra.from, 'not_announcement');
      await extra.reply('🔊 *Group has been unmuted!*\n\nAll members can now send messages.');
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
