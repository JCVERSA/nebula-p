import { BotCommand } from "../types.js";
import { executeSocialDownload, SOCIAL_PLATFORMS } from "./socialPlatforms.js";

const platform = SOCIAL_PLATFORMS.find((p) => p.key === "tiktok")!;

const tiktokCommand: BotCommand = {
  name: "tiktok",
  aliases: platform.aliases,
  category: "Media",
  description: "Download Tiktok via the native Nebula pipeline (no legacy code).",
  usage: ".tiktok <lien>",
  execute: async (sock, msg, context) => executeSocialDownload(platform, sock, msg, context)
};

export default tiktokCommand;
