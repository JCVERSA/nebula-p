import { BotCommand } from "../types.js";
import { executeSocialDownload, SOCIAL_PLATFORMS } from "./socialPlatforms.js";

const platform = SOCIAL_PLATFORMS.find((p) => p.key === "instagram")!;

const instagramCommand: BotCommand = {
  name: "instagram",
  aliases: platform.aliases,
  category: "Media",
  description: "Download Instagram via the native Nebula pipeline (no legacy code).",
  usage: ".instagram <lien>",
  execute: async (sock, msg, context) => executeSocialDownload(platform, sock, msg, context)
};

export default instagramCommand;
