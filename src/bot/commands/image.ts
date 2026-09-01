import { BotCommand } from "../types.js";
import { generateImageWithFallback } from "../geminiClient.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "../aiQuota.js";

const imageCommand: BotCommand = {
  name: "image",
  category: "AI & Creative",
  description: "Generate a new image or edit a replied image using Gemini Image AI.",
  usage: "image <your prompt or edit instructions>",
  execute: async (sock, msg, context) => {
    const prompt = context.args.join(" ");
    
    if (!prompt) {
      await context.reply("❌ Please provide an image prompt!\nExample: `.image A futuristic space cat` or reply to an image with `.image Add a space helmet` to edit.");
      return;
    }

    await context.react("🎨");
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
      // Try downloading media if the user quoted/replied to an image
      let inputImageBase64: string | undefined;
      if (context.downloadMedia) {
        const inputImageBuffer = await context.downloadMedia();
        if (inputImageBuffer) {
          await context.reply("✨ *Analyzing referenced image for editing instructions...*");
          inputImageBase64 = inputImageBuffer.toString("base64");
        }
      }

      consumeAIQuota(context.sender);
      const result = await withAIConcurrency(() => generateImageWithFallback(prompt, inputImageBase64));
      // M11: when Gemini is unavailable the prompt is sent to a third-party
      // public service — say so explicitly before handing out the URL.
      if (result && result.mode === "fallback") {
        await context.reply("ℹ️ *Heads up:* Gemini is unavailable right now, so your prompt is being sent to a third-party public image service (Pollinations) to generate the result.");
      }

      if (result.mode === "fallback") {
        await context.reply(
          `🚀 *Nebula Alternate Engine Activated*\n_Note: Gemini image generation is currently rate-limited or busy, so we processed your prompt using our lightning-fast open-source backup generator._\n\n✨ *Generated:* "${prompt}"`,
          result.imageUrl
        );
      } else if (result.mode === "edited") {
        await context.reply(`✨ *Edited Image:* "${prompt}"`, result.imageUrl);
      } else {
        await context.reply(`✨ *Generated Image:* "${prompt}"`, result.imageUrl);
      }
    } catch (error: any) {
      console.error("Gemini Image Command Error:", error);
      await context.reply(`❌ *Error processing image request:* ${error.message || error}`);
    }
  }
};

export default imageCommand;
