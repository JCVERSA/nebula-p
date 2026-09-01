import { BotCommand } from "../types.js";

const demoteCommand: BotCommand = {
  name: "demote",
  category: "Moderation / Admin",
  parentCategory: "Moderation",
  description: "Demote a group administrator to regular member",
  usage: ".demote @user [or reply to their message]",
  aliases: ["removeadmin", "unadmin"],
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can demote members.");
    }

    try {
      // Find target user from mentions, quoted message, or digits argument
      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
      let targetJid: string | null = null;

      if (ctxInfo?.mentionedJid && ctxInfo.mentionedJid.length > 0) {
        targetJid = ctxInfo.mentionedJid[0];
      } else if (ctxInfo?.participant) {
        targetJid = ctxInfo.participant;
      } else if (context.args[0]) {
        const cleanDigits = context.args[0].replace(/[^0-9]/g, "");
        if (cleanDigits.length >= 8) {
          targetJid = `${cleanDigits}@s.whatsapp.net`;
        }
      }

      if (!targetJid) {
        return context.reply(
          `⚠️ *Specify an admin to demote:*\n\n` +
          `👉 Mention them: \`${context.prefix}demote @user\`\n` +
          `👉 Or reply to their message and type \`${context.prefix}demote\``
        );
      }

      const targetNumber = targetJid.split("@")[0].replace(/[^0-9]/g, "");

      // Execute demotion using helper method if available, or socket direct
      if (typeof context.demoteMember === "function") {
        await context.demoteMember(context.sender, targetJid);
      } else if (sock && typeof sock.groupParticipantsUpdate === "function") {
        await sock.groupParticipantsUpdate(context.sender, [targetJid], "demote");
      }

      await context.react("📉");
      await context.reply(`👤 *Demotion Applied:* @${targetNumber} has been returned to regular member privileges.`);
    } catch (error: any) {
      console.error("Demote command error:", error);
      await context.reply(`❌ *Failed to demote member:* ${error?.message || error}`);
    }
  },
};

export default demoteCommand;
