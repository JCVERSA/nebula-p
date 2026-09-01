import { BotCommandContext } from "../types.js";
import downloadCommand from "./download.js";

/**
 * Native per-platform download commands (audit 8.26): `.tiktok`, `.instagram`,
 * `.facebook`, `.youtube` — thin wrappers that validate the link then delegate
 * to the hardened native `.download` pipeline (Cobalt waterfall + fallbacks,
 * SSRF guard per redirect hop, byte caps, temp links for >100 MB). They exist
 * so the popular platform shortcuts keep working with the legacy corpus
 * quarantined (NEBULA_ENABLE_LEGACY), and never load third-party CJS code.
 */

export interface SocialPlatform {
  key: string;
  command: string;
  aliases: string[];
  emoji: string;
  label: string;
  domains: string[]; // accepted substrings in the URL
  examples: string[];
  extraHint?: string;
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    key: "tiktok",
    command: "tiktok",
    aliases: ["tt", "ttdl", "tiktokdl"],
    emoji: "🎵",
    label: "TikTok (sans watermark quand disponible)",
    domains: ["tiktok.com"],
    examples: [".tiktok https://vm.tiktok.com/xxx", ".tiktok https://www.tiktok.com/@user/video/123"]
  },
  {
    key: "instagram",
    command: "instagram",
    aliases: ["ig", "igdl"],
    emoji: "📸",
    label: "Instagram (reels, posts, vidéos)",
    domains: ["instagram.com", "instagr.am"],
    examples: [".instagram https://www.instagram.com/reel/xxx", ".ig https://instagram.com/p/xxx"]
  },
  {
    key: "facebook",
    command: "facebook",
    aliases: ["fb", "fbdl"],
    emoji: "📘",
    label: "Facebook (vidéos & reels publics)",
    domains: ["facebook.com", "fb.watch", "fb.me"],
    examples: [".facebook https://www.facebook.com/watch?v=xxx", ".fb https://fb.watch/xxx"]
  },
  {
    key: "youtube",
    command: "youtube",
    aliases: ["yt", "ytdl"],
    emoji: "▶️",
    label: "YouTube (vidéo ou audio)",
    domains: ["youtube.com", "youtu.be"],
    examples: [".youtube https://youtu.be/xxx", ".yt audio https://youtu.be/xxx", ".yt https://youtu.be/xxx 720"],
    extraHint: "Audio seulement : `.yt audio <lien>` · Qualité : ajoute `480`, `720`, `1080` ou `max`"
  }
];

/** Returns the platform whose host matches the URL's hostname (null otherwise). */
export function matchSocialPlatform(url: string): SocialPlatform | null {
  const raw = (url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    SOCIAL_PLATFORMS.find((p) =>
      p.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`) || hostname === `www.${d}`)
    ) || null
  );
}

export function platformUsage(p: SocialPlatform): string {
  return (
    `${p.emoji} *Nebula ${p.label}*\n\n` +
    `*Usage:* \`.${p.command} <lien>\`\n\n` +
    `*Exemples:*\n` +
    p.examples.map((e) => `• \`${e}\``).join("\n") +
    (p.extraHint ? `\n\n💡 ${p.extraHint}` : "") +
    `\n\n_Grande vidéo (>100 Mo) ? Le bot envoie un lien de téléchargement rapide._`
  );
}

/**
 * Shared executor: validates the platform link, then delegates to the native
 * download pipeline preserving extra args (audio/video, quality).
 */
export async function executeSocialDownload(
  platform: SocialPlatform,
  sock: any,
  msg: any,
  context: BotCommandContext
): Promise<any> {
  const args = context.args || [];
  const url = args.find((a) => matchSocialPlatform(a)) || "";

  if (!url) {
    const wrong = args[0] || "";
    if (wrong && /^https?:\/\//i.test(wrong)) {
      return context.reply(
        `❌ Ce lien n'est pas un lien ${platform.label.split(" (")[0]}.\n\n${platformUsage(platform)}`
      );
    }
    return context.reply(platformUsage(platform));
  }

  // Pass through: [audio|video] <url> [quality] — same grammar as `.download`.
  return downloadCommand.execute(sock, msg, { ...context, args });
}
