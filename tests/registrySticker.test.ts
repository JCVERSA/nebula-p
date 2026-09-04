import { describe, expect, it } from "vitest";
import { getCommands, initRegistry } from "../src/bot/commandRegistry.js";

/**
 * 8.56 P3 — the native `.s` sticker must be REGISTERED (the 8.49b lesson:
 * a command file alone is invisible in the production bundle) and expose its
 * aliases. Also pins the builder args the FFmpeg runner receives.
 */
describe("sticker command registration", () => {
  it("registers sticker with its aliases in the live registry", async () => {
    await initRegistry();
    const names = getCommands().map(c => c.name.toLowerCase());
    expect(names).toContain("sticker");
    const { getCommand } = await import("../src/bot/commandRegistry.js");
    for (const alias of ["s", "stiker", "stc"]) {
      expect(getCommand(alias)?.name.toLowerCase()).toBe("sticker");
    }
  });
});

import { imageStickerArgs, videoStickerArgs } from "../src/bot/commands/sticker.js";

describe("sticker ffmpeg builders", () => {
  it("image: webp ≤512px, rgba, quality 90", () => {
    const a = imageStickerArgs("in.jpg", "out.webp");
    expect(a).toContain("libwebp");
    expect(a.join(" ")).toContain("scale=512:512:force_original_aspect_ratio=decrease");
    expect(a.join(" ")).toContain("format=rgba");
    expect(a.join(" ")).not.toContain("-loop");
  });

  it("video: animated webp capped at 6 s, 12 fps, loop 0", () => {
    const a = videoStickerArgs("in.mp4", "out.webp");
    const j = a.join(" ");
    expect(j).toContain("-t 6");
    expect(j).toContain("fps=12");
    expect(j).toContain("-loop 0");
    expect(j).toContain("-an");
  });
});
