/**
 * BotGroup Command — Nebula Bot by Dark Neon
 * List all groups the bot is currently in
 * Owner only
 */

const config = require('../../config');

module.exports = {
  name: 'botgroup',
  aliases: ['botg', 'gbot', 'grouplist', 'listgroups'],
  category: 'owner',
  description: 'List all groups the bot is currently in',
  usage: '.botgroup',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const ownerNumbers = (config.ownerNumber || []).map(n => `${n}@s.whatsapp.net`);
      if (!ownerNumbers.includes(extra.sender) && !ownerNumbers.includes(extra.sender?.replace('@s.whatsapp.net', '') + '@s.whatsapp.net')) {
        return extra.reply('👑 This command is only for the bot owner!');
      }

      await extra.reply('⏳ Fetching group list...');

      // Get all chats and filter groups
      const allGroups = await sock.groupFetchAllParticipating();
      const groups = Object.values(allGroups);

      if (!groups || groups.length === 0) {
        return extra.reply('❌ The bot is not in any group!');
      }

      // Sort by name
      groups.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));

      const lines = groups.map((g, i) => {
        const name = g.subject || 'Unknown';
        const count = g.participants?.length || 0;
        const shortId = g.id.split('@')[0];
        return `│ *${i + 1}.* ${name}\n│    👥 ${count} members | 🆔 \`${shortId}\``;
      });

      // Split into chunks of 20 groups per message to avoid too-long messages
      const CHUNK = 20;
      const chunks = [];
      for (let i = 0; i < lines.length; i += CHUNK) {
        chunks.push(lines.slice(i, i + CHUNK));
      }

      for (let c = 0; c < chunks.length; c++) {
        const header = c === 0
          ? `╭━━━━━━━━━━━━━━━━╮\n┃ 🤖 *BOT GROUPS*\n╰━━━━━━━━━━━━━━━━╯\n\n📊 Total: *${groups.length} groups*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
          : `📄 *(continued ${c + 1}/${chunks.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        const footer = c === chunks.length - 1
          ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Use *.remote <group_id> <cmd> [args]* to manage any group remotely.\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
          : '';

        await sock.sendMessage(extra.from, {
          text: header + chunks[c].join('\n') + footer
        }, { quoted: c === 0 ? msg : undefined });

        if (c < chunks.length - 1) await new Promise(r => setTimeout(r, 600));
      }

    } catch (error) {
      console.error('[BOTGROUP] Error:', error.message);
      await extra.reply('❌ Failed to fetch groups: ' + error.message);
    }
  }
};
