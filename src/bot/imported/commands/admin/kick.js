/**
 * Kick Command — Nebula Bot by Dark Neon
 * Remove a member from the group
 */

const { findParticipant } = require('../../utils/jidHelper');
const { longDelay, isOnCooldown, getCooldownRemaining } = require('../../utils/antibanDelay');

module.exports = {
  name: 'kick',
  aliases: ['remove', 'ban'],
  category: 'admin',
  description: 'Kick a member from the group',
  usage: '.kick @user',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      // Cooldown: 1 kick per 10 seconds per admin
      if (isOnCooldown(extra.sender, 'kick', 10)) {
        const remaining = getCooldownRemaining(extra.sender, 'kick', 10);
        return extra.reply(extra.formatter.compact('COOLDOWN', `Please wait *${remaining}s* before using this command again.`));
      }

      let target;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];

      if (mentioned && mentioned.length > 0) {
        target = mentioned[0];
      } else if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
        target = ctx.participant;
      } else {
        return extra.reply(extra.formatter.compact('ERROR', 'Please mention or reply to the user to kick!\n\nExample: .kick @user'));
      }

      const freshMetadata = await sock.groupMetadata(extra.from);
      const foundParticipant = findParticipant(freshMetadata.participants, target);

      if (!foundParticipant) {
        return extra.reply(extra.formatter.compact('ERROR', 'User not found in group!'));
      }

      if (foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin') {
        return extra.reply(extra.formatter.compact('ERROR', 'You cannot kick an admin!'));
      }

      // Human-like delay before action
      await longDelay();

      await sock.groupParticipantsUpdate(extra.from, [target], 'remove');

      await sock.sendMessage(extra.from, {
        text: extra.formatter.formatMessage('KICK SUCCESS', `@${target.split('@')[0]} has been removed from the shadows.`),
        mentions: [target]
      }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
