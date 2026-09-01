import { BotCommand } from "../types.js";
import { getConfig, updateConfig } from "../config.js";

const ownerCommand: BotCommand = {
  name: "owner",
  category: "Owner Tools",
  description: "View owner details or configure bot parameters (owner only).",
  usage: "owner [setprefix | setname | setimage | setchannel] <value>",
  execute: async (sock, msg, context) => {
    const config = getConfig();
    
    // Check if user is owner
    if (!context.isOwner) {
      await context.react("❌");
      await context.reply("⚠️ *Access Denied:* This command is restricted to the bot owner.");
      return;
    }

    const subCommand = context.args[0]?.toLowerCase();
    const value = context.args.slice(1).join(" ");

    if (!subCommand) {
      await context.react("👑");
      await context.reply(
        `👑 *Nebula Bot Owner Menu*\n\n` +
        `• *Prefix:* \`${config.prefix}\` (Change with \`${config.prefix}owner setprefix <char>\`)\n` +
        `• *Bot Name:* \`${config.botName}\` (Change with \`${config.prefix}owner setname <name>\`)\n` +
        `• *Bot Image:* \`Configured\` (Change with \`${config.prefix}owner setimage <url>\`)\n` +
        `• *Channel Link:* \`Configured\` (Change with \`${config.prefix}owner setchannel <url>\`)\n\n` +
        `🔒 _These changes are persistent and update the dashboard in real-time._`
      );
      return;
    }

    await context.react("⚙️");

    switch (subCommand) {
      case "setprefix":
        if (!value || value.length > 2) {
          await context.reply("❌ Prefix must be 1-2 characters long!");
          return;
        }
        updateConfig({ prefix: value });
        await context.reply(`✅ *Prefix updated successfully!*\nNew prefix: \`${value}\``);
        break;

      case "setname":
        if (!value) {
          await context.reply("❌ Please provide a name!");
          return;
        }
        updateConfig({ botName: value });
        await context.reply(`✅ *Bot Name updated successfully!*\nNew name: *${value}*`);
        break;

      case "setimage":
        if (!value || !value.startsWith("http")) {
          await context.reply("❌ Please provide a valid URL starting with http/https!");
          return;
        }
        updateConfig({ botImage: value });
        await context.reply(`✅ *Bot Image updated successfully!*`);
        break;

      case "setchannel":
        if (!value || !value.startsWith("http")) {
          await context.reply("❌ Please provide a valid WhatsApp Channel URL!");
          return;
        }
        updateConfig({ newsletterUrl: value });
        await context.reply(`✅ *Channel link updated successfully!*\nNew link: ${value}`);
        break;

      default:
        await context.reply(`❌ Unknown subcommand: \`${subCommand}\`. Use \`.owner\` to see available tools.`);
        break;
    }
  }
};

export default ownerCommand;
