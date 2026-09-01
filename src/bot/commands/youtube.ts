import { BotCommand } from "../types.js";
import { executeSocialDownload, SOCIAL_PLATFORMS } from "./socialPlatforms.js";

const platform = SOCIAL_PLATFORMS.find((p) => p.key === "youtube")!;

const youtubeCommand: BotCommand = {
  name: "youtube",
  aliases: platform.aliases,
  category: "Media",
  description: "Download Youtube via the native Nebula pipeline (no legacy code).",
  usage: ".youtube <lien>",
  execute: async (sock, msg, context) => executeSocialDownload(platform, sock, msg, context)
};

export default youtubeCommand;
