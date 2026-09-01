import { BotCommand } from "../types.js";

const VALID_TAGS = [
  "waifu", "maid", "marin-kitagawa", "mori-calliope", 
  "raiden-shogun", "oppai", "selfies", "uniform", "kamisato-ayaka"
];

const waifuCommand: BotCommand = {
  name: "waifu",
  category: "Creative & AI",
  description: "Get a random anime character image.",
  usage: "waifu [tag]",
  execute: async (sock, msg, context) => {
    await context.react("🌸");
    
    // Check tags
    const args = context.args || [];
    const tag = (args[0] || "").toLowerCase();
    const useTag = VALID_TAGS.includes(tag) ? tag : "waifu";

    try {
      const url = `https://api.waifu.im/search?included_tags=${useTag}&is_nsfw=false`;
      const res = await fetch(url);
      const data = await res.json();
      
      const image = data?.images?.[0];
      if (!image?.url) {
        return context.reply("❌ No image found. Please try again in a moment.");
      }

      const caption = `🌸 *Tag:* \`${useTag}\`\n` +
                      (image.dominant_color ? `🎨 *Dominant Color:* \`${image.dominant_color}\`\n` : "") +
                      `\n🌌 _Powered by Nebula Bot_`;

      await context.reply(caption, image.url);
    } catch (error: any) {
      console.error("[WAIFU] Error:", error.message || error);
      await context.reply(`❌ Error fetching image. Please try again.\n\nAvailable tags: ${VALID_TAGS.join(", ")}`);
    }
  }
};

export default waifuCommand;
