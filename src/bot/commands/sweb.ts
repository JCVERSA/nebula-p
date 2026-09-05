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
        await context.reply("❌ *Il manque l\u2019adresse du site.*\n\nExemple : `.sweb https://github.com` ou `.ssweb google.com`");
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
        await context.reply("❌ *Adresse de site invalide.*");
        return;
      }

      await context.react("📸");
      await context.reply(`⏳ *Capture du site en cours…*\n${url}\n_Un instant…_`);

      // Use microlink screenshot API
      const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`;
      // M11: explicit third-party disclosure
      await context.reply("ℹ️ La capture passe par un service externe de rendu (microlink.io) — l\u2019adresse que tu envoies lui est transmise.");

      await context.reply(`📸 *Screenshot of ${url}:*`, screenshotUrl);
    } catch (error: any) {
      console.error("SSWeb command error:", error);
      await context.reply(`❌ *La capture a échoué.*\n🔄 Réessaie dans un instant.`);
    }
  }
};

export default swebCommand;
