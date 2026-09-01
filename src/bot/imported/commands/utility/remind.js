// Nebula Bot by Dark Neon
/**
 * Remind Command - Set a reminder
 * Usage: .remind 10m Do the homework
 *        .remind 2h Call mom
 *        .remind 1d Pay the bills
 */

module.exports = {
  name: 'remind',
  aliases: ['reminder', 'remindme'],
  category: 'utility',
  description: 'Set a reminder (e.g. .remind 10m Call mom)',
  usage: '.remind <time> <message>  — time format: 30s, 10m, 2h, 1d',

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0] || !args[1]) {
        return extra.reply(
          '⏰ *Reminder*\n\n' +
          'Usage: .remind <time> <message>\n\n' +
          'Time formats:\n' +
          '  30s → 30 seconds\n' +
          '  10m → 10 minutes\n' +
          '  2h  → 2 hours\n' +
          '  1d  → 1 day\n\n' +
          'Examples:\n' +
          '  .remind 10m Check the oven\n' +
          '  .remind 2h Call mom\n' +
          '  .remind 1d Pay the bills'
        );
      }

      const timeStr = args[0].toLowerCase();
      const reminder = args.slice(1).join(' ');

      // Parse time
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        return extra.reply('❌ Invalid time format!\n\nUse: 30s, 10m, 2h, 1d');
      }

      const value = parseInt(match[1]);
      const unit = match[2];

      const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      const ms = value * multipliers[unit];

      const maxMs = 7 * 24 * 3600000; // 7 days max
      if (ms > maxMs) {
        return extra.reply('❌ Maximum reminder time is 7 days!');
      }

      const unitNames = { s: 'second(s)', m: 'minute(s)', h: 'hour(s)', d: 'day(s)' };
      const timeLabel = `${value} ${unitNames[unit]}`;

      // Confirmation
      const warningNote = ms > 3600000 ? '\n\n⚠️ _Note: Le rappel sera perdu si le bot redémarre avant l\'heure prévue._' : '';
      await extra.reply(`✅ Reminder set!\n\n⏰ I will remind you in *${timeLabel}*\n📝 Message: _${reminder}_${warningNote}`);

      const sender = extra.sender;
      const from = extra.from;

      // Schedule the reminder
      setTimeout(async () => {
        try {
          await sock.sendMessage(from, {
            text: `⏰ *Reminder!*\n\n@${sender.split('@')[0]}, here is your reminder:\n\n📝 _${reminder}_`,
            mentions: [sender]
          });
        } catch (e) {
          console.error('[Remind] Failed to send reminder:', e.message);
        }
      }, ms);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
