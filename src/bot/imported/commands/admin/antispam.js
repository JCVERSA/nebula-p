// Nebula Bot by Dark Neon
/**
 * AntiSpam Command - Detect and kick spammers (too many messages in short time)
 */

const database = require('../../database');

// In-memory tracker: { groupId: { userId: { count, timer } } }
const spamTracker = {};

const SPAM_LIMIT = 7;       // max messages
const SPAM_WINDOW = 5000;   // in 5 seconds

/**
 * Called by the message handler on every incoming message.
 * Returns true if the message was spam and action was taken.
 */
async function checkSpam(sock, msg, groupId, senderId) {
  const settings = database.getGroupSettings(groupId);
  if (!settings.antispam) return false;

  if (!spamTracker[groupId]) spamTracker[groupId] = {};
  if (!spamTracker[groupId][senderId]) {
    spamTracker[groupId][senderId] = { count: 0, timer: null };
  }

  const tracker = spamTracker[groupId][senderId];
  tracker.count++;

  if (tracker.timer) clearTimeout(tracker.timer);
  tracker.timer = setTimeout(() => {
    if (spamTracker[groupId]) delete spamTracker[groupId][senderId];
  }, SPAM_WINDOW);

  if (tracker.count >= SPAM_LIMIT) {
    delete spamTracker[groupId][senderId];
    try {
      await sock.groupParticipantsUpdate(groupId, [senderId], 'remove');
      await sock.sendMessage(groupId, {
        text: `🚫 @${senderId.split('@')[0]} has been kicked for spamming!`,
        mentions: [senderId]
      });
    } catch (e) {
      console.error('[AntiSpam] kick error:', e.message);
    }
    return true;
  }
  return false;
}

module.exports = {
  name: 'antispam',
  aliases: ['as'],
  category: 'admin',
  description: 'Enable/disable anti-spam protection (auto-kick spammers)',
  usage: '.antispam <on/off>',
  groupOnly: true,
  featureKey: "antispam",
  adminOnly: true,
  botAdminNeeded: true,
  checkSpam, // exported so index.js can use it

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antispam ? 'ON' : 'OFF';
        return extra.reply(
          `🛡️ *AntiSpam Status*\n\n` +
          `Status: *${status}*\n` +
          `Limit: *${SPAM_LIMIT} messages / ${SPAM_WINDOW / 1000}s*\n\n` +
          `Usage:\n` +
          `  .antispam on\n` +
          `  .antispam off`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'on') {
        if (database.getGroupSettings(extra.from).antispam) {
          return extra.reply('*AntiSpam is already ON*');
        }
        database.updateGroupSettings(extra.from, { antispam: true });
        return extra.reply(`✅ *AntiSpam has been turned ON*\n\nMembers sending more than ${SPAM_LIMIT} messages in ${SPAM_WINDOW / 1000} seconds will be kicked!`);
      }

      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { antispam: false });
        return extra.reply('❌ *AntiSpam has been turned OFF*');
      }

      return extra.reply('❌ Invalid option!\nUsage: .antispam <on/off>');
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
