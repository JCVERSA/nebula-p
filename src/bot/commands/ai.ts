import { BotCommand } from "../types.js";
import { generateTextWithFallback } from "../geminiClient.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "../aiQuota.js";

const aiCommand: BotCommand = {
  name: "ai",
  category: "AI & Creative",
  description: "Ask anything and get an intelligent response from Gemini 3.7 Flash.",
  usage: "ai <your question or prompt>",
  execute: async (sock, msg, context) => {
    const prompt = context.args.join(" ");
    
    if (!prompt) {
      await context.reply("❌ Please provide a prompt or question!\nExample: `.ai Explain Quantum Computing in 3 sentences`");
      return;
    }

    await context.react("🧠");
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
      await context.reply(
        "⚠️ *Gemini API Key is not configured on the server.*\n" +
        "Please configure your `GEMINI_API_KEY` in the secrets or environment file."
      );
      return;
    }

    const quota = checkAIQuota(context.sender);
    if (!quota.allowed) {
      await context.reply(`⚠️ ${quota.error}`);
      return;
    }

    try {
      consumeAIQuota(context.sender);
      const answer = await withAIConcurrency(() =>
        generateTextWithFallback(
          prompt,
          "You are Nebula Bot, an advanced WhatsApp multi-device bot assistant. Keep responses helpful, structured, concise, and clean for a messaging app interface. Use bolding, bullet points, and emojis appropriately.",
          "gemini-3.7-flash"
        )
      );
      await context.reply(`🌌 *Nebula AI Assistant*\n\n${answer}`);
    } catch (error: any) {
      console.error("Gemini AI Command Error:", error);
      await context.reply(`❌ *Error contacting Gemini AI:* ${error.message || error}`);
    }
  }
};

export default aiCommand;
