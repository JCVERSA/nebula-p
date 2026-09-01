// Nebula Bot by Dark Neon
/**
 * Warns Command - View or reset warnings
 */

const database = require('../../database');

module.exports = {
  name: 'warns',
  aliases: ['warnlist', 'resetwarn'],
  category: 'admin',
  description: 'View or reset warnings for a user',
  usage: '.warns @user | .warns reset @user',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];
      const groupId = extra.from;
      const settings = database.getGroupSettings(groupId);
      const warns = settings.warns || {};

      // .warns reset @user
      if (args[0]?.toLowerCase() === 'reset') {
        const target = mentioned[0] || ctx?.participant;
        if (!target) return extra.reply('❌ Please mention or reply to the user to reset warns!');
        warns[target] = 0;
        database.updateGroupSettings(groupId, { warns });
        return await sock.sendMessage(groupId, {
          text: `✅ Warnings for @${target.split('@')[0]} have been reset!`,
          mentions: [target]
        }, { quoted: msg });
      }

      // .warns @user — view specific user's warns
      if (mentioned.length > 0 || (ctx?.participant && ctx.quotedMessage)) {
        const target = mentioned[0] || ctx.participant;
        const count = warns[target] || 0;
        return await sock.sendMessage(groupId, {
          text: `⚠️ @${target.split('@')[0]} has *${count}/3* warnings.`,
          mentions: [target]
        }, { quoted: msg });
      }

      // .warns — list all warned users
      const warnedUsers = Object.entries(warns).filter(([, count]) => count > 0);
      if (warnedUsers.length === 0) {
        return extra.reply('✅ No warnings in this group!');
      }

      let text = `⚠️ *Warned Members*\n\n`;
      for (const [jid, count] of warnedUsers) {
        text += `• @${jid.split('@')[0]}: ${count}/3 warns\n`;
      }

      await sock.sendMessage(groupId, {
        text,
        mentions: warnedUsers.map(([jid]) => jid)
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
