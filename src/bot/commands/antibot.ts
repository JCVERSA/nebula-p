import { BotCommand } from "../types.js";
import { setGroupAntibot, getGroupAntibotStatus } from "../utils/antibot.js";

const antibotCommand: BotCommand = {
  name: "antibot",
  category: "Moderation / Admin",
  parentCategory: "Moderation",
  description: "Configure antibot & unauthorized link protection for the group",
  usage: ".antibot <on/off/status/action [delete/kick/warn]>",
  aliases: ["botprotect", "nobots"],
  execute: async (sock, msg, context) => {
    if (!context.sender.endsWith("@g.us")) {
      return context.reply("❌ *Error:* This command can only be used in group chats.");
    }

    if (!context.isAdmin && !context.isOwner) {
      return context.reply("⚠️ *Access Denied:* Only group administrators can configure antibot protection.");
    }

    try {
      const args = context.args;
      const current = getGroupAntibotStatus(context.sender);

      if (!args[0]) {
        const statusText = current.enabled ? "ON (Active)" : "OFF (Disabled)";
        const actionText = (current.action || "delete").toUpperCase();

        return context.reply(
          `🛡️ *ANTIBOT GROUP PROTECTION SYSTEM*\n\n` +
          `• *Status:* ${statusText}\n` +
          `• *Action:* ${actionText}\n\n` +
          `*Available Commands:*\n` +
          `👉 \`${context.prefix}antibot on\` - Enable antibot & link blocking\n` +
          `👉 \`${context.prefix}antibot off\` - Disable antibot protection\n` +
          `👉 \`${context.prefix}antibot action delete\` - Delete violating messages\n` +
          `👉 \`${context.prefix}antibot action kick\` - Remove violators immediately\n` +
          `👉 \`${context.prefix}antibot action warn\` - Issue warnings\n` +
          `👉 \`${context.prefix}antibot status\` - Show current configuration`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === "on" || opt === "enable") {
        if (current.enabled) {
          return context.reply("🛡️ *Antibot protection is already ENABLED for this group.*");
        }
        setGroupAntibot(context.sender, true, current.action);
        await context.react("🛡️");
        return context.reply(
          `✅ *Antibot Protection Activated!*\n\n` +
          `• Foreign bot messages & unauthorized links will be automatically handled with action: *${current.action.toUpperCase()}*.\n` +
          `• Group admins & bot owner remain exempt.`
        );
      }

      if (opt === "off" || opt === "disable") {
        setGroupAntibot(context.sender, false, current.action);
        await context.react("🔓");
        return context.reply("🔓 *Antibot protection has been DISABLED for this group.*");
      }

      if (opt === "status" || opt === "get") {
        const statusText = current.enabled ? "✅ ACTIVE (ON)" : "❌ DISABLED (OFF)";
        return context.reply(
          `📊 *Antibot Group Status*\n\n` +
          `• Protection: ${statusText}\n` +
          `• Enforcement Action: *${(current.action || "delete").toUpperCase()}*\n` +
          `• Scope: Automatic detection of foreign bots, spam scripts, and links.`
        );
      }

      if (opt === "action" || opt === "set") {
        const targetAction = args[1]?.toLowerCase();
        if (!targetAction || !["delete", "kick", "warn"].includes(targetAction)) {
          return context.reply(
            `⚠️ *Invalid action specified.* Choose one of:\n` +
            `• \`${context.prefix}antibot action delete\` (deletes messages)\n` +
            `• \`${context.prefix}antibot action kick\` (removes offending sender)\n` +
            `• \`${context.prefix}antibot action warn\` (sends warning notice)`
          );
        }

        setGroupAntibot(context.sender, true, targetAction as "delete" | "kick" | "warn");
        await context.react("⚙️");
        return context.reply(
          `✅ *Antibot enforcement action set to:* *${targetAction.toUpperCase()}*\n(Protection has been enabled)`
        );
      }

      return context.reply(
        `⚠️ *Unknown option:* \`${args[0]}\`. Use \`${context.prefix}antibot\` to view help.`
      );
    } catch (error: any) {
      console.error("Antibot command error:", error);
      await context.reply(`❌ *Error:* Failed to configure antibot: ${error?.message || error}`);
    }
  }
};

export default antibotCommand;
