import { describe, expect, it } from "vitest";
import { SOCIAL_PLATFORMS, matchSocialPlatform, platformUsage } from "../src/bot/commands/socialPlatforms.js";
import tiktok from "../src/bot/commands/tiktok.js";
import instagram from "../src/bot/commands/instagram.js";
import facebook from "../src/bot/commands/facebook.js";
import youtube from "../src/bot/commands/youtube.js";

/**
 * Audit 8.26 — native per-platform download commands (.tiktok/.instagram/
 * .facebook/.youtube): thin wrappers over the hardened `.download` pipeline,
 * independent of the quarantined legacy corpus.
 */

describe("matchSocialPlatform", () => {
  it("matches each platform's real link shapes (incl. shorteners)", () => {
    expect(matchSocialPlatform("https://vm.tiktok.com/ZMabc123/")?.key).toBe("tiktok");
    expect(matchSocialPlatform("https://www.tiktok.com/@user/video/123")?.key).toBe("tiktok");
    expect(matchSocialPlatform("https://instagram.com/reel/Cxyz/")?.key).toBe("instagram");
    expect(matchSocialPlatform("https://youtu.be/dQw4w9WgXcQ")?.key).toBe("youtube");
    expect(matchSocialPlatform("https://www.facebook.com/watch?v=1")?.key).toBe("facebook");
    expect(matchSocialPlatform("https://fb.watch/abc/")?.key).toBe("facebook");
  });

  it("rejects non-http input, foreign links and empty strings", () => {
    expect(matchSocialPlatform("")).toBeNull();
    expect(matchSocialPlatform("tiktok.com/video")).toBeNull(); // no scheme
    expect(matchSocialPlatform("https://example.com/tiktok.com")).toBeNull();
    expect(matchSocialPlatform("https://twitter.com/x/status/1")).toBeNull();
  });
});

describe("platformUsage", () => {
  it("renders examples and the audio/quality hint for YouTube", () => {
    const text = platformUsage(SOCIAL_PLATFORMS.find((p) => p.key === "youtube")!);
    expect(text).toContain(".youtube <lien>");
    expect(text).toContain(".yt audio");
    expect(text).toContain("1080");
  });
});

describe("native registration (quarantine-proof)", () => {
  const cases = [
    [tiktok, "tiktok", ["tt", "ttdl", "tiktokdl"]],
    [instagram, "instagram", ["ig", "igdl"]],
    [facebook, "facebook", ["fb", "fbdl"]],
    [youtube, "youtube", ["yt", "ytdl"]]
  ] as const;

  it.each(cases)("%s is a native command with its aliases and an executor", (cmd, name, aliases) => {
    expect(cmd.name).toBe(name);
    expect(cmd.aliases?.slice(0, aliases.length)).toEqual([...aliases]);
    expect(typeof cmd.execute).toBe("function");
    expect(cmd.category).toBe("Media");
  });

  it("all four platforms are declared exactly once", () => {
    const keys = SOCIAL_PLATFORMS.map((p) => p.key).sort();
    expect(keys).toEqual(["facebook", "instagram", "tiktok", "youtube"]);
  });
});
