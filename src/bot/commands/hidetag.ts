import { BotCommand } from "../types.js";

const hidetag: BotCommand = {
  name: "hidetag",
  category: "Admin",
  description: "Silently tag all members in the group",
  usage: ".hidetag <message> (or reply to media)",
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can tag all members.");
    }

    try {
      // 1. Fetch group metadata and participants
      const groupMetadata = await sock.groupMetadata(context.sender);
      const participants = groupMetadata.participants || [];
      const mentions = participants.map((p: any) => p.id || p.lid).filter(Boolean);

      // 2. Check if quoted message exists
      const ctxInfo = msg?.message?.extendedTextMessage?.contextInfo;
      let targetMessage = msg;

      if (ctxInfo?.quotedMessage) {
        targetMessage = {
          key: {
            remoteJid: context.sender,
            id: ctxInfo.stanzaId,
            participant: ctxInfo.participant,
          },
          message: ctxInfo.quotedMessage,
        };
      }

      const messageContent = targetMessage?.message;
      const mediaMessage = 
        messageContent?.imageMessage ||
        messageContent?.videoMessage ||
        messageContent?.stickerMessage;

      // 3. React to indicate processing
      await context.react("📢");

      if (mediaMessage && context.downloadMedia) {
        // If there is media, download it and send it with mentions
        const mediaBuffer = await context.downloadMedia();
        if (mediaBuffer) {
          if (messageContent.imageMessage) {
            const text = context.args.join(" ") || messageContent.imageMessage.caption || "";
            await sock.sendMessage(context.sender, { image: mediaBuffer, caption: text, mentions }, { quoted: msg });
          } else if (messageContent.videoMessage) {
            const text = context.args.join(" ") || messageContent.videoMessage.caption || "";
            await sock.sendMessage(context.sender, { video: mediaBuffer, caption: text, mentions }, { quoted: msg });
          } else if (messageContent.stickerMessage) {
            await sock.sendMessage(context.sender, { sticker: mediaBuffer, mentions }, { quoted: msg });
            const text = context.args.join(" ");
            if (text) {
              await sock.sendMessage(context.sender, { text, mentions }, { quoted: msg });
            }
          }
          return;
        }
      }

      // Default to plain text hidetag
      if (ctxInfo?.quotedMessage) {
        const quotedText = ctxInfo.quotedMessage.conversation || 
                         ctxInfo.quotedMessage.extendedTextMessage?.text || 
                         context.args.join(" ") || "📢 *Nebula Broadcast Announcement*";
        await sock.sendMessage(context.sender, { text: quotedText, mentions }, { quoted: msg });
      } else {
        const text = context.args.join(" ") || "📢 *Nebula Broadcast Announcement*";
        await sock.sendMessage(context.sender, { text, mentions }, { quoted: msg });
      }

    } catch (error: any) {
      console.error("HideTag command error:", error);
      await context.reply(`❌ *Error:* Failed to tag group members.\nReason: ${error.message || error}`);
    }
  }
};

export default hidetag;
