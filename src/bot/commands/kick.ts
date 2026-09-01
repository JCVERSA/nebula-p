import { BotCommand } from "../types.js";

const kickCommand: BotCommand = {
  name: "kick",
  category: "Moderation / Admin",
  parentCategory: "Moderation",
  description: "Remove a member from the group",
  usage: ".kick @user [or reply to their message]",
  aliases: ["remove", "banmember"],
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can use the kick command.");
    }

    try {
      // Find target user from mentions, quoted message, or explicit digits argument
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
          `⚠️ *Specify a user to kick:*\n\n` +
          `👉 Mention them: \`${context.prefix}kick @user\`\n` +
          `👉 Or reply to their message and type \`${context.prefix}kick\``
        );
      }

      const targetNumber = targetJid.split("@")[0].replace(/[^0-9]/g, "");

      // Prevent kicking oneself or bot
      const myNumber = sock?.user?.id?.split(":")[0]?.replace(/[^0-9]/g, "") || "";
      if (targetNumber === myNumber) {
        return context.reply("⚠️ *Cannot kick:* The bot cannot kick itself!");
      }

      // Execute removal using helper method if available, or socket direct
      if (typeof context.kickMember === "function") {
        await context.kickMember(context.sender, targetJid);
      } else if (sock && typeof sock.groupParticipantsUpdate === "function") {
        await sock.groupParticipantsUpdate(context.sender, [targetJid], "remove");
      }

      await context.react("👢");
      await context.reply(`🚫 *Member Removed:* @${targetNumber} has been kicked from the group.`);
    } catch (error: any) {
      console.error("Kick command error:", error);
      await context.reply(`❌ *Failed to kick member:* ${error?.message || error}`);
    }
  },
};

export default kickCommand;
