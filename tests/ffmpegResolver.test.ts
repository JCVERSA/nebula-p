import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Shared ffmpeg resolver (audit 8.29, 2026-09-01): the ffmpeg-static npm
 * dependency was removed (its postinstall downloaded ~70 MB from GitHub on
 * every fresh install — the dominant cause of 20-30 min `nebula update`).
 * The resolver must work with NO ffmpeg-static package installed.
 */

describe("ffmpeg resolver (8.29)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.FFMPEG_BIN;
  });

  it("honours an explicit FFMPEG_BIN override first — deterministic on any host", async () => {
    process.env.FFMPEG_BIN = "/opt/nebula-ffmpeg";
    const mod = await import("../src/bot/ffmpeg.js");
    expect(mod.resolvedFfmpegPath).toBe("/opt/nebula-ffmpeg");
  });

  it("trims a whitespace-padded FFMPEG_BIN", async () => {
    process.env.FFMPEG_BIN = "  /usr/bin/ffmpeg  ";
    const mod = await import("../src/bot/ffmpeg.js");
    expect(mod.resolvedFfmpegPath).toBe("/usr/bin/ffmpeg");
  });

  it("always resolves to a non-empty string without the removed package", async () => {
    const mod = await import("../src/bot/ffmpeg.js");
    expect(typeof mod.resolvedFfmpegPath).toBe("string");
    expect(mod.resolvedFfmpegPath.length).toBeGreaterThan(0);
  });
});
