import { BotCommand } from "../types.js";

const swebCommand: BotCommand = {
  name: "sweb",
  aliases: ["ssweb", "screenshot", "ss", "webss"],
  category: "General",
  description: "Take a high-quality screenshot of a website",
  usage: "sweb <url>",
  execute: async (sock, msg, context) => {
    try {
      if (context.args.length === 0) {
        await context.reply("❌ Please provide a website URL!\n\nExample: `.sweb https://github.com` or `.ssweb google.com`");
        return;
      }

      let url = context.args.join(" ").trim();

      // Automatically prepend https:// if missing, for convenience
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }

      // Simple regex validation for URLs
      const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/i;
      if (!urlPattern.test(url)) {
        await context.reply("❌ Please provide a valid website URL!");
        return;
      }

      await context.react("📸");
      await context.reply(`⏳ *Capturing webpage screenshot of:* ${url}\n_Please wait a moment..._`);

      // Use microlink screenshot API
      const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`;
      // M11: explicit third-party disclosure
      await context.reply("ℹ️ Screenshot request sent to a third-party rendering service (microlink.io — the page URL you provided is forwarded to them).");

      await context.reply(`📸 *Screenshot of ${url}:*`, screenshotUrl);
    } catch (error: any) {
      console.error("SSWeb command error:", error);
      await context.reply(`❌ Failed to screenshot website: ${error.message || error}`);
    }
  }
};

export default swebCommand;
