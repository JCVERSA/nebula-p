// Nebula Bot by Dark Neon
/**
 * Schedule Command - Program automatic messages in a group
 * Admin only
 *
 * Usage:
 *   .schedule every 30m Good morning everyone!
 *   .schedule daily 09:00 Good morning! 🌅
 *   .schedule weekly mon 09:00 Weekly reminder!
 *   .schedule monthly 1 10:00 New month! 🎉
 */

const { addSchedule, parseToCron, getGroupSchedules } = require('../../utils/scheduler');

module.exports = {
  name: 'schedule',
  aliases: ['addschedule', 'sched'],
  category: 'admin',
  description: 'Schedule automatic messages in the group',
  usage: '.schedule <frequency> <message>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          `⏰ *Schedule — Auto Messages*\n\n` +
          `*Usage:* .schedule <frequency> <message>\n\n` +
          `*Frequency formats:*\n` +
          `  \`every 30m\` → every 30 minutes\n` +
          `  \`every 2h\` → every 2 hours\n` +
          `  \`daily 09:00\` → every day at 9 AM\n` +
          `  \`weekly mon 09:00\` → every Monday at 9 AM\n` +
          `  \`monthly 1 09:00\` → 1st of each month at 9 AM\n\n` +
          `*Days:* sun mon tue wed thu fri sat\n\n` +
          `*Examples:*\n` +
          `  .schedule daily 09:00 Good morning everyone! 🌅\n` +
          `  .schedule weekly fri 18:00 Happy Friday! 🎉\n` +
          `  .schedule every 2h Stay hydrated! 💧\n\n` +
          `📋 View tasks: *.schedulelist*\n` +
          `❌ Remove task: *.unschedule <id>*`
        );
      }

      const first = args[0].toLowerCase();
      let frequencyParts = [];
      let messageStart = 0;

      if (first === 'every') {
        frequencyParts = args.slice(0, 2);
        messageStart = 2;
      } else if (first === 'daily') {
        frequencyParts = args.slice(0, 2);
        messageStart = 2;
      } else if (first === 'weekly') {
        frequencyParts = args.slice(0, 3);
        messageStart = 3;
      } else if (first === 'monthly') {
        frequencyParts = args.slice(0, 3);
        messageStart = 3;
      } else {
        return extra.reply('❌ Invalid format! Use: every Xm/Xh, daily HH:MM, weekly day HH:MM, monthly day HH:MM');
      }

      const expression = frequencyParts.join(' ');
      const message = args.slice(messageStart).join(' ').trim();

      if (!message) {
        return extra.reply('❌ Please provide a message!\n\nExample: .schedule daily 09:00 Good morning! 🌅');
      }

      if (message.length > 1000) {
        return extra.reply('❌ Message too long! Maximum 1000 characters.');
      }

      // Validate frequency
      try {
        parseToCron(expression);
      } catch (e) {
        return extra.reply(`❌ ${e.message}`);
      }

      // Max 10 tasks per group
      const existing = getGroupSchedules(extra.from);
      if (existing.length >= 10) {
        return extra.reply('❌ Maximum 10 tasks per group! Remove one with .unschedule <id>');
      }

      const schedule = addSchedule({
        groupId: extra.from,
        groupName: extra.groupMetadata?.subject || 'Unknown',
        createdBy: extra.sender,
        expression,
        message
      });

      await extra.reply(
        `✅ *Scheduled message created!*\n\n` +
        `🆔 ID: \`${schedule.id}\`\n` +
        `⏰ Frequency: *${expression}*\n` +
        `💬 Message: _${message}_\n\n` +
        `To remove: *.unschedule ${schedule.id}*`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
