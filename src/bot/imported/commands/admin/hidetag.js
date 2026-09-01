/**
 * HideTag Command — Nebula Bot by Dark Neon
 * Silently tag all group members without listing them
 * Supports text, images, videos, and stickers
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { mediumDelay, isOnCooldown, getCooldownRemaining } = require('../../utils/antibanDelay');

module.exports = {
  name: 'hidetag',
  aliases: ['tag'],
  description: 'Silently tag all members in the group',
  usage: '.tag <message> (or reply to media)',
  category: 'admin',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,
  
  async execute(sock, msg, args, extra) {
    try {
      // Cooldown: 1 use per 30 seconds — tagging all members is heavy
      if (isOnCooldown(extra.sender, 'hidetag', 30)) {
        const remaining = getCooldownRemaining(extra.sender, 'hidetag', 30);
        return extra.reply(`⏳ Please wait *${remaining}s* before tagging again.`);
      }

      const groupMetadata = await sock.groupMetadata(extra.from);
      const participants = groupMetadata.participants || [];
      const mentions = participants.map((p) => p.id || p.lid).filter(Boolean);
      
      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
      let targetMessage = msg;
      
      if (ctxInfo?.quotedMessage) {
        targetMessage = {
          key: {
            remoteJid: extra.from,
            id: ctxInfo.stanzaId,
            participant: ctxInfo.participant,
          },
          message: ctxInfo.quotedMessage,
        };
      }
      
      const mediaMessage = 
        targetMessage.message?.imageMessage ||
        targetMessage.message?.videoMessage ||
        targetMessage.message?.stickerMessage;
      
      // Human-like delay before sending
      await mediumDelay();

      if (mediaMessage) {
        try {
          const mediaBuffer = await downloadMediaMessage(
            targetMessage,
            'buffer',
            {},
            { logger: undefined, reuploadRequest: sock.updateMediaMessage }
          );
          
          if (targetMessage.message?.imageMessage) {
            const text = args.join(' ') || targetMessage.message.imageMessage.caption || '';
            await sock.sendMessage(extra.from, { image: mediaBuffer, caption: text, mentions }, { quoted: msg });
          } else if (targetMessage.message?.videoMessage) {
            const text = args.join(' ') || targetMessage.message.videoMessage.caption || '';
            await sock.sendMessage(extra.from, { video: mediaBuffer, caption: text, mentions }, { quoted: msg });
          } else if (targetMessage.message?.stickerMessage) {
            await sock.sendMessage(extra.from, { sticker: mediaBuffer, mentions }, { quoted: msg });
            const text = args.join(' ');
            if (text) {
              await mediumDelay();
              await sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });
            }
          }
        } catch (mediaError) {
          console.error('Error downloading media for hidetag:', mediaError);
          const text = args.join(' ') || ' ';
          await sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });
        }
      } else {
        if (ctxInfo?.quotedMessage) {
          const quotedText = ctxInfo.quotedMessage.conversation || 
                           ctxInfo.quotedMessage.extendedTextMessage?.text || 
                           args.join(' ') || ' ';
          await sock.sendMessage(extra.from, { text: quotedText, mentions }, { quoted: msg });
        } else {
          const text = args.join(' ') || ' ';
          await sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });
        }
      }
    } catch (error) {
      console.error('HideTag command error:', error);
      await extra.reply('❌ Failed to tag members.');
    }
  },
};
