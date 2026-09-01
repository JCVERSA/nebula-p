import { BotCommand } from "../types.js";
import { database } from "../database.js";

const antitag: BotCommand = {
  name: "antitag",
  category: "Admin",
  description: "Configure antitag protection (blocks mass tagall/mention spam)",
  usage: ".antitag <on/off/set/get>",
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can configure antitag protection.");
    }

    try {
      const args = context.args;
      const settings = database.getGroupSettings(context.sender);

      if (!args[0]) {
        const status = settings.antitag ? "ON" : "OFF";
        const action = settings.antitagAction || "delete";
        return context.reply(
          `📛 *Antitag Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n\n` +
          `Usage:\n` +
          `  .antitag on\n` +
          `  .antitag off\n` +
          `  .antitag set delete | kick\n` +
          `  .antitag get`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === "on") {
        if (settings.antitag) {
          return context.reply("🛡️ *Antitag is already turned ON for this group.*");
        }
        database.updateGroupSettings(context.sender, { antitag: true });
        await context.react("🛡️");
        return context.reply("✅ *Antitag protection has been turned ON.* Mass tagalls or tag-spams from non-admins will be moderated!");
      }

      if (opt === "off") {
        database.updateGroupSettings(context.sender, { antitag: false });
        await context.react("🔓");
        return context.reply("🔓 *Antitag protection has been turned OFF.*");
      }

      if (opt === "set") {
        if (args.length < 2) {
          return context.reply("⚠️ *Please specify an action:* `.antitag set delete` or `.antitag set kick`.");
        }

        const actionOpt = args[1].toLowerCase();
        if (actionOpt !== "delete" && actionOpt !== "kick") {
          return context.reply("❌ *Invalid action.* Choose either *delete* (removes the tagall message) or *kick* (removes the sender).");
        }

        database.updateGroupSettings(context.sender, {
          antitagAction: actionOpt as "delete" | "kick",
          antitag: true, // Auto-enable on set
        });
        await context.react("⚙️");
        return context.reply(`✅ *Antitag action set to:* *${actionOpt.toUpperCase()}* (and protection is now ON)`);
      }

      if (opt === "get") {
        const status = settings.antitag ? "ON" : "OFF";
        const action = settings.antitagAction || "delete";
        return context.reply(`📊 *Antitag Configuration:*\n\n• Status: *${status}*\n• Enforcement Action: *${action.toUpperCase()}*`);
      }

      return context.reply("⚠️ *Unknown option.* Use `.antitag` to see all available options.");

    } catch (error: any) {
      console.error("Antitag command error:", error);
      await context.reply(`❌ *Error:* Failed to configure antitag.\nReason: ${error.message || error}`);
    }
  }
};

export default antitag;
