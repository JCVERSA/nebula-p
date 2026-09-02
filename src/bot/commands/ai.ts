import { BotCommand } from "../types.js";
import { generateTextWithFallback, isAIConfigured } from "../geminiClient.js";
import { getPersonaPrompt } from "../persona.js";
import { getConfig } from "../config.js";
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

    if (!isAIConfigured()) {
      await context.reply(
        "⚠️ *No AI engine configured on the server.*\n" +
        "Configure `GEMINI_API_KEY` (primary) or `NVIDIA_NIM_API_KEY` (fallback) in the secrets or environment file."
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
          getPersonaPrompt("command", getConfig().botName),
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
