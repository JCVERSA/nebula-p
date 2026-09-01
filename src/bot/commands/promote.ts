import { BotCommand } from "../types.js";

const promoteCommand: BotCommand = {
  name: "promote",
  category: "Moderation / Admin",
  parentCategory: "Moderation",
  description: "Promote a member to group administrator",
  usage: ".promote @user [or reply to their message]",
  aliases: ["makeadmin", "addadmin"],
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can promote members.");
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
          `⚠️ *Specify a user to promote:*\n\n` +
          `👉 Mention them: \`${context.prefix}promote @user\`\n` +
          `👉 Or reply to their message and type \`${context.prefix}promote\``
        );
      }

      const targetNumber = targetJid.split("@")[0].replace(/[^0-9]/g, "");

      // Execute promotion using helper method if available, or socket direct
      if (typeof context.promoteMember === "function") {
        await context.promoteMember(context.sender, targetJid);
      } else if (sock && typeof sock.groupParticipantsUpdate === "function") {
        await sock.groupParticipantsUpdate(context.sender, [targetJid], "promote");
      }

      await context.react("👑");
      await context.reply(`⭐ *Promotion Successful:* @${targetNumber} is now a group administrator!`);
    } catch (error: any) {
      console.error("Promote command error:", error);
      await context.reply(`❌ *Failed to promote member:* ${error?.message || error}`);
    }
  },
};

export default promoteCommand;
