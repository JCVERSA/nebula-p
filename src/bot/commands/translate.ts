import { BotCommand } from "../types.js";
import { generateTextWithFallback } from "../geminiClient.js";

const translateCommand: BotCommand = {
  name: "translate",
  category: "Utilities",
  description: "Translate text to any language with high-fidelity using Gemini AI.",
  usage: ".translate <text> <lang_code> or reply to a message with `.translate <lang_code>`",
  aliases: ["trt", "tr"],
  execute: async (sock, msg, context) => {
    const args = context.args;
    let textToTranslate = "";
    let targetLang = "";

    // Check if replying to a message
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
      textToTranslate = quoted.conversation || 
                        quoted.extendedTextMessage?.text || 
                        quoted.imageMessage?.caption || 
                        quoted.videoMessage?.caption || 
                        "";
      targetLang = args.join(" ").trim() || "english";
    } else {
      if (args.length < 2) {
        return context.reply(
          `🌐 *Nebula Gemini Translator*\n\n` +
          `*Usage:*\n` +
          `1. Reply to any message: \`.translate <target_language>\`\n` +
          `2. Direct: \`.translate <text> <target_language>\`\n\n` +
          `*Examples:*\n` +
          `• \`.translate hello french\`\n` +
          `• \`.translate hello fr\`\n` +
          `• \`.translate How are you doing? spanish\`\n\n` +
          `_Uses Gemini AI for highly accurate, contextual, and localized translations._`
        );
      }
      targetLang = args[args.length - 1];
      textToTranslate = args.slice(0, args.length - 1).join(" ");
    }

    if (!textToTranslate || textToTranslate.trim() === "") {
      return context.reply("❌ Please provide some text to translate or reply to a message.");
    }

    await context.react("🌐");
    try {
      const prompt = `Translate the following text into "${targetLang}". Do not explain, describe, or add commentary. Return ONLY the translated text.\n\nText: "${textToTranslate}"`;
      const translation = await generateTextWithFallback(
        prompt,
        "You are an expert translator. Translate the text accurately into the requested language. Do not add quotes around the output, do not include original language notes, just return the translated text.",
        "gemini-3.7-flash"
      );
      await context.reply(`🌐 *Translation (${targetLang})*\n\n${translation}`);
    } catch (err: any) {
      console.error("Translation command error:", err);
      await context.reply(`❌ *Translation failed:* ${err.message || err}`);
    }
  }
};

export default translateCommand;
