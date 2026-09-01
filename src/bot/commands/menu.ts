import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

// We will export a function or rely on a global command registry to generate the menu list dynamically
// For safety, we can define a default list or fetch from a helper
const menuCommand: BotCommand = {
  name: "menu",
  category: "General",
  description: "Display all available commands categorized.",
  usage: "menu",
  execute: async (sock, msg, context) => {
    const config = getConfig();
    await context.react("🌌");

    // Retrieve all commands from global variable or context. Since context doesn't store all,
    // we can retrieve it from the server's command registry if available, or print a lovely structured menu.
    // In our backend we will attach a list of commands to global so we can access it here.
    const commands: BotCommand[] = (global as any).botCommands || [];

    let menuText = `🌟 *${config.botName.toUpperCase()} SERVICES* 🌟\n`;
    menuText += `*Prefix:* \`${config.prefix}\` | *User:* @${context.sender.split("@")[0]}\n`;
    menuText += `⚡ _Powered by Nebula Engine_\n\n`;

    if (commands.length > 0) {
      // Group commands by category
      const categories: { [key: string]: BotCommand[] } = {};
      commands.forEach(cmd => {
        if (!categories[cmd.category]) {
          categories[cmd.category] = [];
        }
        categories[cmd.category].push(cmd);
      });

      for (const [category, cmds] of Object.entries(categories)) {
        menuText += `🔮 *${category.toUpperCase()} COMMANDS*\n`;
        cmds.forEach(cmd => {
          menuText += ` ├ \`${config.prefix}${cmd.name}\` - ${cmd.description}\n`;
        });
        menuText += ` └───────────────\n\n`;
      }
    } else {
      // Fallback menu if not loaded dynamically
      menuText += `🔮 *GENERAL*\n`;
      menuText += ` ├ \`${config.prefix}menu\` - Show this help menu\n`;
      menuText += ` ├ \`${config.prefix}ping\` - Check speed & latency\n`;
      menuText += ` ├ \`${config.prefix}help <command>\` - Detailed command help\n`;
      menuText += `🔮 *AI & CREATIVE*\n`;
      menuText += ` ├ \`${config.prefix}ai <prompt>\` - Ask Gemini AI\n`;
      menuText += ` ├ \`${config.prefix}image <prompt>\` - Generate AI image\n`;
      menuText += `🔮 *FUN & UTILITY*\n`;
      menuText += ` ├ \`${config.prefix}joke\` - Get a random joke\n`;
      menuText += ` ├ \`${config.prefix}quote\` - Inspiring quotes\n`;
      menuText += `🔮 *OWNER*\n`;
      menuText += ` ├ \`${config.prefix}owner\` - Owner tools (prefix, name, image, channel)\n`;
    }

    menuText += `📢 *Official Channel:* ${config.newsletterUrl}\n`;
    menuText += `🌌 _Keep exploring, keep building._`;

    await context.reply(menuText);
  }
};

export default menuCommand;
