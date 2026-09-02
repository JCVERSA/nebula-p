import { BotCommand } from "../types.js";
import { generateTextWithFallback, isAIConfigured } from "../geminiClient.js";
import { getPersonaPrompt } from "../persona.js";
import {
  getMemoryContext,
  recordExchange,
  compactIfNeeded,
  forgetMemory,
  defaultMemorySummarizer
} from "../services/aiMemory.js";
import { getConfig } from "../config.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "../aiQuota.js";

const aiCommand: BotCommand = {
  name: "ai",
  category: "AI & Creative",
  description: "Ask anything and get an intelligent response from Gemini 3.7 Flash.",
  usage: "ai <your question or prompt>",
  execute: async (sock, msg, context) => {
    const prompt = context.args.join(" ");
    
    // Memory control: `.ai forget` wipes this chat's conversation memory.
    const first = (context.args[0] || "").toLowerCase();
    if (first === "forget" || first === "oublie") {
      const wiped = forgetMemory(msg.key.remoteJid || "");
      return void (await context.reply(
        wiped
          ? "🧹 *Mémoire de cette discussion effacée.* Le bot repart d'une page blanche."
          : "ℹ️ Aucune mémoire enregistrée pour cette discussion."
      ));
    }

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
      const chatJid = msg.key.remoteJid || "";
      const memoryBlock = getMemoryContext(chatJid);
      const systemPrompt =
        getPersonaPrompt("command", getConfig().botName) +
        (memoryBlock ? `\n\n${memoryBlock}` : "");
      const answer = await withAIConcurrency(() =>
        generateTextWithFallback(
          prompt,
          systemPrompt,
          "gemini-3.7-flash"
        )
      );
      await context.reply(`🌌 *Nebula AI Assistant*\n\n${answer}`);
      // Persist the exchange for the next message in this chat (sliding TTL),
      // then compact old turns into the rolling summary (internal call).
      recordExchange(chatJid, prompt, answer);
      compactIfNeeded(chatJid, defaultMemorySummarizer).catch((e) =>
        console.warn(`[AI Memory] compaction skipped: ${e?.message || e}`)
      );
    } catch (error: any) {
      console.error("Gemini AI Command Error:", error);
      await context.reply(`❌ *Error contacting Gemini AI:* ${error.message || error}`);
    }
  }
};

export default aiCommand;
