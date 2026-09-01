// Nebula Bot by Dark Neon
/**
 * Broadcast Command - Send a message to all groups
 * Utilise safeBroadcast pour espacer les envois et éviter le ban
 */

const { safeBroadcast } = require('../../utils/antiban');

module.exports = {
  name: 'broadcast',
  aliases: ['bc'],
  category: 'owner',
  description: 'Send a message to all groups (with anti-ban delays)',
  usage: '.broadcast <message>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          '📢 *Broadcast*\n\n' +
          'Usage: .broadcast <message>\n\n' +
          'Example: .broadcast Hello everyone! 👋\n\n' +
          '⚠️ A delay of 3-7 seconds is applied between each group to avoid ban.'
        );
      }

      const text = args.join(' ');
      const groups = await sock.groupFetchAllParticipating();
      const groupIds = Object.keys(groups);

      if (groupIds.length === 0) {
        return extra.reply('❌ The bot is not in any group!');
      }

      await extra.reply(
        `📢 Starting broadcast to *${groupIds.length}* groups...\n\n` +
        `⏱️ Estimated time: ~${Math.round(groupIds.length * 5 / 60)} min\n` +
        `🛡️ Anti-ban delays active (3-7s between each)`
      );

      // safeBroadcast espacé de 3 à 7 secondes entre chaque groupe
      const { success, failed } = await safeBroadcast(
        sock,
        groupIds,
        { text: `📢 *Broadcast — Nebula Bot*\n\n${text}` },
        3000,  // min 3 secondes
        7000   // max 7 secondes
      );

      await extra.reply(
        `✅ *Broadcast complete!*\n\n` +
        `✔️ Sent: *${success}*\n` +
        `❌ Failed: *${failed}*`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
