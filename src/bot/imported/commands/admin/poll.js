// Nebula Bot by Dark Neon
/**
 * Poll Command - Create a poll in the group
 * Usage: .poll Question | Option1 | Option2 | Option3
 */

module.exports = {
  name: 'poll',
  aliases: ['vote'],
  category: 'admin',
  description: 'Create a poll in the group',
  usage: '.poll Question | Option1 | Option2 ...',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const input = args.join(' ');
      const parts = input.split('|').map(p => p.trim()).filter(Boolean);

      if (parts.length < 3) {
        return extra.reply(
          '❌ Invalid format!\n\n' +
          'Usage: .poll Question | Option1 | Option2 | Option3\n\n' +
          'Example: .poll Best color? | Red | Blue | Green'
        );
      }

      if (parts.length > 13) {
        return extra.reply('❌ Maximum 12 options allowed!');
      }

      const question = parts[0];
      const options = parts.slice(1);

      await sock.sendMessage(extra.from, {
        poll: {
          name: question,
          values: options,
          selectableCount: 1
        }
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
