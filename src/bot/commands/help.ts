import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

const helpCommand: BotCommand = {
  name: "help",
  category: "General",
  description: "Get detailed help for a specific command or view system guidelines.",
  usage: ".help <command_name>",
  aliases: ["h", "info"],
  execute: async (sock, msg, context) => {
    const config = getConfig();
    const args = context.args;
    const commands: BotCommand[] = (global as any).botCommands || [];

    await context.react("📖");

    // 1. If no command name is provided, show basic help and instruction menu
    if (!args[0]) {
      let helpText = `📖 *NEBULA BOT DIRECTORY* 📖\n\n`;
      helpText += `To get detailed explanation, usages, and aliases for any specific command, type:\n`;
      helpText += `👉 \`${config.prefix}help <command_name>\`\n\n`;
      helpText += `*Example:* \`${config.prefix}help download\`\n\n`;
      helpText += `⚡ *Quick Tips:*\n`;
      helpText += `• All command names can be called with or without uppercase.\n`;
      helpText += `• Group administrators have exclusive access to *Admin* features.\n`;
      helpText += `• Use \`${config.prefix}menu\` to list all categories at once.\n\n`;
      helpText += `🌌 _Nebula Engine v1.1.0 - Active and Secure_`;
      
      return context.reply(helpText);
    }

    // 2. Command name is provided, search by name or aliases (case-insensitive)
    const query = args[0].toLowerCase().trim();
    const targetCmd = commands.find(
      cmd => cmd.name.toLowerCase() === query || 
             (cmd.aliases && cmd.aliases.some(alias => alias.toLowerCase() === query))
    );

    if (!targetCmd) {
      await context.react("❓");
      return context.reply(`❌ *Command not found:* \`${query}\`\n\nType \`${config.prefix}menu\` to see all available commands!`);
    }

    // 3. Format detailed, clean help card
    let detailText = `🌌 *COMMAND INFORMATION: ${targetCmd.name.toUpperCase()}* 🌌\n\n`;
    detailText += `📂 *Category:*  ${targetCmd.category}\n`;
    detailText += `📝 *Description:*  ${targetCmd.description}\n\n`;
    
    // Usage details
    const usageStr = targetCmd.usage 
      ? (targetCmd.usage.startsWith(config.prefix) ? targetCmd.usage : `${config.prefix}${targetCmd.usage}`)
      : `${config.prefix}${targetCmd.name}`;
    
    detailText += `💡 *Usage:*  \`${usageStr}\`\n`;

    // Aliases details
    if (targetCmd.aliases && targetCmd.aliases.length > 0) {
      const formattedAliases = targetCmd.aliases.map(al => `\`${config.prefix}${al}\``).join(", ");
      detailText += `🔗 *Aliases:*  ${formattedAliases}\n`;
    } else {
      detailText += `🔗 *Aliases:*  _None_\n`;
    }

    detailText += `\n✨ _Do not include brackets <> or [] when typing actual parameters!_`;

    await context.reply(detailText);
  }
};

export default helpCommand;
