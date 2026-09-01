import { BotCommand } from "../types.js";
import { database } from "../database.js";

const antilink: BotCommand = {
  name: "antilink",
  category: "Admin",
  description: "Configure antilink protection (delete/kick for group invite links)",
  usage: ".antilink <on/off/set/get>",
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can configure antilink protection.");
    }

    try {
      const args = context.args;
      const settings = database.getGroupSettings(context.sender);

      if (!args[0]) {
        const status = settings.antilink ? "ON" : "OFF";
        const action = settings.antilinkAction || "delete";
        return context.reply(
          `🔗 *Antilink Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n\n` +
          `Usage:\n` +
          `  .antilink on\n` +
          `  .antilink off\n` +
          `  .antilink set delete | kick\n` +
          `  .antilink get`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === "on") {
        if (settings.antilink) {
          return context.reply("🛡️ *Antilink is already turned ON for this group.*");
        }
        database.updateGroupSettings(context.sender, { antilink: true });
        await context.react("🛡️");
        return context.reply("✅ *Antilink protection has been turned ON.* Invite links from other groups will be filtered!");
      }

      if (opt === "off") {
        database.updateGroupSettings(context.sender, { antilink: false });
        await context.react("🔓");
        return context.reply("🔓 *Antilink protection has been turned OFF.*");
      }

      if (opt === "set") {
        if (args.length < 2) {
          return context.reply("⚠️ *Please specify an action:* `.antilink set delete` or `.antilink set kick`.");
        }

        const actionOpt = args[1].toLowerCase();
        if (actionOpt !== "delete" && actionOpt !== "kick") {
          return context.reply("❌ *Invalid action.* Choose either *delete* (removes the link message) or *kick* (removes the sender).");
        }

        database.updateGroupSettings(context.sender, {
          antilinkAction: actionOpt as "delete" | "kick",
          antilink: true, // Auto-enable on set
        });
        await context.react("⚙️");
        return context.reply(`✅ *Antilink action set to:* *${actionOpt.toUpperCase()}* (and protection is now ON)`);
      }

      if (opt === "get") {
        const status = settings.antilink ? "ON" : "OFF";
        const action = settings.antilinkAction || "delete";
        return context.reply(`📊 *Antilink Configuration:*\n\n• Status: *${status}*\n• Enforcement Action: *${action.toUpperCase()}*`);
      }

      return context.reply("⚠️ *Unknown option.* Use `.antilink` to see all available commands.");

    } catch (error: any) {
      console.error("Antilink command error:", error);
      await context.reply(`❌ *Error:* Failed to configure antilink.\nReason: ${error.message || error}`);
    }
  }
};

export default antilink;
