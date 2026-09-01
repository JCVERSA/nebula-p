import { BotCommand } from "../types.js";
import { executeSocialDownload, SOCIAL_PLATFORMS } from "./socialPlatforms.js";

const platform = SOCIAL_PLATFORMS.find((p) => p.key === "facebook")!;

const facebookCommand: BotCommand = {
  name: "facebook",
  aliases: platform.aliases,
  category: "Media",
  description: "Download Facebook via the native Nebula pipeline (no legacy code).",
  usage: ".facebook <lien>",
  execute: async (sock, msg, context) => executeSocialDownload(platform, sock, msg, context)
};

export default facebookCommand;
