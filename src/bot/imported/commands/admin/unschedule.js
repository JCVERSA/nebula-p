// Nebula Bot by Dark Neon
/**
 * Unschedule Command - Remove a scheduled task
 */

const { removeSchedule, getGroupSchedules } = require('../../utils/scheduler');

module.exports = {
  name: 'unschedule',
  aliases: ['removeschedule', 'delschedule'],
  category: 'admin',
  description: 'Remove a scheduled automatic message',
  usage: '.unschedule <id>',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        const tasks = getGroupSchedules(extra.from);
        if (tasks.length === 0) {
          return extra.reply('📋 No scheduled tasks in this group.\n\nCreate one with *.schedule*');
        }
        return extra.reply(
          `❌ Please provide a task ID!\n\n` +
          `Usage: .unschedule <id>\n\n` +
          `View tasks: *.schedulelist*`
        );
      }

      const id = args[0].trim();

      // Check that the task belongs to this group
      const groupTasks = getGroupSchedules(extra.from);
      const task = groupTasks.find(t => t.id === id);

      if (!task) {
        return extra.reply(
          `❌ Task \`${id}\` not found in this group!\n\n` +
          `View your tasks: *.schedulelist*`
        );
      }

      removeSchedule(id);

      await extra.reply(
        `✅ Scheduled task removed!\n\n` +
        `🆔 ID: \`${id}\`\n` +
        `⏰ Was: *${task.expression}*\n` +
        `💬 Message: _${task.message}_`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
