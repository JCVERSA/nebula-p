import { BotCommand } from "../types.js";

const membersCommand: BotCommand = {
  name: "members",
  category: "Moderation / Group",
  parentCategory: "Moderation",
  description: "Display the list of all members and admins in the group",
  usage: ".members",
  aliases: ["memberlist", "groupmembers", "listmembers"],
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used inside group chats.");
    }

    try {
      await context.react("👥");

      // Fetch group members using helper method if available, or sock.groupMetadata fallback
      let participants: { id: string; number: string; admin: "admin" | "superadmin" | null }[] = [];
      let groupSubject = "Group";

      if (typeof context.getGroupMembers === "function") {
        participants = await context.getGroupMembers(context.sender);
      }

      if (participants.length === 0 && sock && typeof sock.groupMetadata === "function") {
        const metadata = await sock.groupMetadata(context.sender);
        groupSubject = metadata?.subject || groupSubject;
        if (metadata?.participants) {
          participants = metadata.participants.map((p: any) => ({
            id: p.id,
            number: p.id.split("@")[0].replace(/[^0-9]/g, ""),
            admin: p.admin || null,
          }));
        }
      }

      if (participants.length === 0) {
        // Mock fallback if simulator
        participants = [
          { id: context.sender.replace("@g.us", "@s.whatsapp.net"), number: "1234567890", admin: "superadmin" },
          { id: "9876543210@s.whatsapp.net", number: "9876543210", admin: null },
        ];
      }

      const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin");
      const regularMembers = participants.filter((p) => !p.admin);

      let text = `👥 *GROUP DIRECTORY: ${groupSubject.toUpperCase()}*\n`;
      text += `📊 *Total Population:* ${participants.length} member(s)\n`;
      text += `👑 *Admins:* ${admins.length} | 👤 *Members:* ${regularMembers.length}\n\n`;

      if (admins.length > 0) {
        text += `👑 *ADMINISTRATORS:*\n`;
        admins.forEach((a) => {
          const roleBadge = a.admin === "superadmin" ? " (Creator/SuperAdmin)" : " (Admin)";
          text += ` • @${a.number}${roleBadge}\n`;
        });
        text += `\n`;
      }

      text += `👤 *MEMBERS:*\n`;
      // Show first 50 members to adhere to WhatsApp message length constraints
      const previewMembers = regularMembers.slice(0, 50);
      previewMembers.forEach((m) => {
        text += ` • @${m.number}\n`;
      });

      if (regularMembers.length > 50) {
        text += `\n_...and ${regularMembers.length - 50} more members._\n`;
      }

      text += `\n⚡ _Use \`${context.prefix}kick @user\` or \`${context.prefix}promote @user\` for admin actions._`;

      await context.reply(text);
    } catch (error: any) {
      console.error("Members command error:", error);
      await context.reply(`❌ *Error fetching members:* ${error?.message || error}`);
    }
  },
};

export default membersCommand;
