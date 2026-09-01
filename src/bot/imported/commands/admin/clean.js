/**
 * Clean Command — Nebula Bot by Dark Neon
 * Delete messages in group with anti-ban delays
 */

const { shortDelay } = require('../../utils/antibanDelay');

module.exports = {
  name: 'clean',
  aliases: ['purge', 'clear'],
  category: 'admin',
  description: 'Clean messages (all or from specific user if replied)',
  usage: '.clean <number>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,
  
  async execute(sock, msg, args, extra) {
    try {
      const count = parseInt(args[0]);
      if (!count || count < 1 || count > 100) {
        return extra.reply('❌ Please enter a valid number (1-100).');
      }

      const jid = extra.from;
      const { store } = require('../../index');
      
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

      const msgs = store.messages[jid];
      if (!msgs) {
        return extra.reply('❌ No stored messages found.');
      }

      let messagesToDelete = [];

      if (quotedMsg && quotedParticipant) {
        messagesToDelete = Object.values(msgs)
          .filter(m => {
            const sender = m.key.participant || m.key.remoteJid;
            return sender === quotedParticipant;
          })
          .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
          .slice(0, count);
      } else {
        messagesToDelete = Object.values(msgs)
          .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
          .slice(0, count);
      }

      let deleted = 0;
      for (const m of messagesToDelete) {
        try {
          await sock.sendMessage(jid, { delete: m.key });
          deleted++;
          // Random human-like delay between each deletion
          await shortDelay();
        } catch (err) {
          console.error('[clean] delete error:', err.message);
        }
      }

      // Send confirmation then auto-delete it after 3 seconds
      const confirmMsg = await extra.reply(`🗑️ Successfully deleted *${deleted}* message(s).`);
      setTimeout(async () => {
        try { await sock.sendMessage(jid, { delete: confirmMsg.key }); } catch (_) {}
      }, 3000);

    } catch (e) {
      console.error('[clean cmd] error:', e);
      extra.reply('❌ Failed to clean messages.');
    }
  }
};
