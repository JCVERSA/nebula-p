/**
 * Warn Command — Nebula Bot by Dark Neon
 * Warning system with auto-kick after max warns
 */

const database = require('../../database');
const config = require('../../config');
const { longDelay, isOnCooldown, getCooldownRemaining } = require('../../utils/antibanDelay');

module.exports = {
  name: 'warn',
  aliases: ['w'],
  category: 'admin',
  description: 'Warn a member (auto-kick after max warns)',
  usage: '.warn @user [reason]',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (isOnCooldown(extra.sender, 'warn', 5)) {
        const remaining = getCooldownRemaining(extra.sender, 'warn', 5);
        return extra.reply(`⏳ Please wait *${remaining}s* before using this command again.`);
      }

      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];
      let target;

      if (mentioned && mentioned.length > 0) {
        target = mentioned[0];
      } else if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
        target = ctx.participant;
      } else {
        return extra.reply('❌ Please mention or reply to the user to warn!\n\nExample: .warn @user spamming');
      }

      // Empêcher de se warn soi-même ou de warner le bot
      if (target === extra.sender) {
        return extra.reply('❌ You cannot warn yourself!');
      }

      const reason = args.filter(a => !a.startsWith('@')).join(' ') || 'No reason specified';
      const groupId = extra.from;
      const MAX_WARNS = config.maxWarnings || 3;

      // Utiliser le système de warns dédié dans database.js
      const warnData = database.addWarning(groupId, target, reason);
      const userWarns = warnData.count;

      await longDelay();

      if (userWarns >= MAX_WARNS) {
        // Réinitialiser les warns et kick
        database.clearWarnings(groupId, target);
        try {
          await sock.groupParticipantsUpdate(groupId, [target], 'remove');
          await sock.sendMessage(groupId, {
            text: `⛔ @${target.split('@')[0]} has been kicked!\nReason: Reached maximum warnings (${MAX_WARNS}/${MAX_WARNS}).`,
            mentions: [target]
          }, { quoted: msg });
        } catch (kickError) {
          await extra.reply(`❌ Could not kick user: ${kickError.message}`);
        }
      } else {
        const remaining = MAX_WARNS - userWarns;
        await sock.sendMessage(groupId, {
          text: `⚠️ *Warning* ⚠️\n\n@${target.split('@')[0]} has been warned!\n📝 Reason: ${reason}\n⚠️ Warnings: ${userWarns}/${MAX_WARNS}\n\n${remaining === 1 ? '🚨 One more warning will result in a kick!' : `${remaining} warnings remaining before kick.`}`,
          mentions: [target]
        }, { quoted: msg });
      }

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
