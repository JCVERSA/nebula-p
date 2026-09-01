/**
 * Promote Command — Nebula Bot by Dark Neon
 * Give admin privileges to a member
 */

const { findParticipant } = require('../../utils/jidHelper');
const { longDelay, isOnCooldown, getCooldownRemaining } = require('../../utils/antibanDelay');

module.exports = {
  name: 'promote',
  aliases: ['addadmin'],
  category: 'admin',
  description: 'Promote a member to admin',
  usage: '.promote @user',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (isOnCooldown(extra.sender, 'promote', 10)) {
        const remaining = getCooldownRemaining(extra.sender, 'promote', 10);
        return extra.reply(`⏳ Please wait *${remaining}s* before using this command again.`);
      }

      let target;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];

      if (mentioned && mentioned.length > 0) {
        target = mentioned[0];
      } else if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
        target = ctx.participant;
      } else {
        return extra.reply('❌ Please mention or reply to the user to promote!\n\nExample: .promote @user');
      }

      const freshMetadata = await sock.groupMetadata(extra.from);
      const foundParticipant = findParticipant(freshMetadata.participants, target);

      if (!foundParticipant) {
        return extra.reply('❌ User not found in group!');
      }

      if (foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin') {
        return extra.reply('❌ This user is already an admin!');
      }

      await longDelay();
      await sock.groupParticipantsUpdate(extra.from, [target], 'promote');

      await sock.sendMessage(extra.from, {
        text: `⭐ @${target.split('@')[0]} has been promoted to admin!`,
        mentions: [target]
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
