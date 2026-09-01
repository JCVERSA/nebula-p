// Nebula Bot by Dark Neon
/**
 * AutoTasks Command - Enable/disable automatic system tasks per group
 *
 * Tasks disponibles :
 *   dailygreeting  → Message de bonjour quotidien à 9h
 *   weeklyrules    → Rappel des règles chaque lundi à 10h
 *   dailyreport    → Rapport d'activité quotidien à 23h
 */

const database = require('../../database');

const TASKS = {
  dailygreeting: {
    label: 'Daily Good Morning',
    desc: 'Sends a good morning message every day at 9:00 AM',
    icon: '🌅'
  },
  weeklyrules: {
    label: 'Weekly Rules Reminder',
    desc: 'Sends group rules every Monday at 10:00 AM (requires .setrules)',
    icon: '📋'
  },
  dailyreport: {
    label: 'Daily Activity Report',
    desc: 'Sends top 5 most active members every day at 11:00 PM',
    icon: '📊'
  }
};

module.exports = {
  name: 'autotasks',
  aliases: ['cronjobs', 'automessages', 'autotask'],
  category: 'admin',
  description: 'Enable or disable automatic system tasks in this group',
  usage: '.autotasks | .autotasks <task> on/off',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);

      // No args — show current status of all tasks
      if (!args[0]) {
        let text = `🤖 *Auto Tasks — ${extra.groupMetadata?.subject || 'This Group'}*\n\n`;

        for (const [key, info] of Object.entries(TASKS)) {
          const enabled = settings[key] ? '✅ ON' : '❌ OFF';
          text += `${info.icon} *${info.label}*\n`;
          text += `   Status: ${enabled}\n`;
          text += `   _${info.desc}_\n\n`;
        }

        text += `*To toggle:*\n`;
        text += `  .autotasks dailygreeting on/off\n`;
        text += `  .autotasks weeklyrules on/off\n`;
        text += `  .autotasks dailyreport on/off`;

        return extra.reply(text);
      }

      const taskKey = args[0].toLowerCase();
      const action  = args[1]?.toLowerCase();

      if (!TASKS[taskKey]) {
        return extra.reply(
          `❌ Unknown task: *${taskKey}*\n\n` +
          `Available tasks:\n` +
          Object.keys(TASKS).map(k => `  • ${k}`).join('\n')
        );
      }

      if (!action || !['on', 'off'].includes(action)) {
        const current = settings[taskKey] ? 'ON ✅' : 'OFF ❌';
        return extra.reply(
          `${TASKS[taskKey].icon} *${TASKS[taskKey].label}*\n\n` +
          `Current status: *${current}*\n\n` +
          `Usage: .autotasks ${taskKey} on/off`
        );
      }

      const enable = action === 'on';

      // Special check: weeklyrules needs rules to be set
      if (taskKey === 'weeklyrules' && enable && !settings.rules) {
        return extra.reply(
          `⚠️ You need to set group rules first!\n\n` +
          `Use: *.setrules <your rules>*\n` +
          `Then enable: *.autotasks weeklyrules on*`
        );
      }

      database.updateGroupSettings(extra.from, { [taskKey]: enable });

      const info = TASKS[taskKey];
      await extra.reply(
        `${enable ? '✅' : '❌'} *${info.label}* has been *${enable ? 'enabled' : 'disabled'}*!\n\n` +
        `${info.icon} _${info.desc}_`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
