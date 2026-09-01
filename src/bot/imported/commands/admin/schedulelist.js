// Nebula Bot by Dark Neon
/**
 * ScheduleList Command - View all scheduled tasks in a group
 */

const { getGroupSchedules, getAllSchedules } = require('../../utils/scheduler');

module.exports = {
  name: 'schedulelist',
  aliases: ['schedules', 'listschedule', 'tasklist'],
  category: 'admin',
  description: 'View all scheduled automatic messages in this group',
  usage: '.schedulelist',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      // Owner can see all groups with .schedulelist all
      if (args[0] === 'all' && extra.isOwner) {
        const all = getAllSchedules();
        if (all.length === 0) {
          return extra.reply('📋 No scheduled tasks anywhere.');
        }

        let text = `📋 *All Scheduled Tasks (${all.length})*\n\n`;
        for (const t of all) {
          text += `🆔 \`${t.id}\`\n`;
          text += `📌 Group: ${t.groupName}\n`;
          text += `⏰ ${t.expression}\n`;
          text += `💬 _${t.message.slice(0, 50)}${t.message.length > 50 ? '...' : ''}_\n\n`;
        }
        return extra.reply(text.trim());
      }

      const tasks = getGroupSchedules(extra.from);

      if (tasks.length === 0) {
        return extra.reply(
          `📋 *No scheduled tasks in this group.*\n\n` +
          `Create one with *.schedule*\n\n` +
          `Example:\n` +
          `  .schedule daily 09:00 Good morning! 🌅\n` +
          `  .schedule weekly mon 08:00 New week, new goals! 💪`
        );
      }

      let text = `⏰ *Scheduled Tasks — ${extra.groupMetadata?.subject || 'This Group'}*\n`;
      text += `📊 Total: *${tasks.length}/10*\n\n`;

      tasks.forEach((t, i) => {
        const date = new Date(t.createdAt).toLocaleDateString('en-GB');
        text += `*${i + 1}.* 🆔 \`${t.id}\`\n`;
        text += `   ⏰ Frequency: *${t.expression}*\n`;
        text += `   💬 Message: _${t.message.slice(0, 60)}${t.message.length > 60 ? '...' : ''}_\n`;
        text += `   📅 Created: ${date}\n\n`;
      });

      text += `❌ To remove: *.unschedule <id>*`;

      await extra.reply(text);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
