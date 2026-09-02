import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import {
  clearDeadSlugsForTests,
  extractVidmolyFileSlug,
  isDeadFileSlug,
  markDeadFileSlug
} from "../src/bot/services/hlsDownloader.js";
import { compressionPointless } from "../src/bot/commands/novabox.js";

/**
 * Audit 8.47 — two production-log time sinks:
 * 1. a fully-403ing file retried via another embed host of the same family
 *    (34 attempts + two FFmpeg runs wasted) → dead-file slug memory (30 min);
 * 2. a 121.8s 480p→480p re-encode that could only time out → ffprobe height
 *    check skips pointless compression.
 */

beforeEach(() => clearDeadSlugsForTests());
afterEach(() => {
  clearDeadSlugsForTests();
  vi.useRealTimers();
});

const EMBED = "https://vidmoly.biz/embed-q49ll9us6nok.html";
const EMBED_OTHER_HOST = "https://vidmoly.org/embed-q49ll9us6nok.html";
const URLSET = "https://box-1659-u.vmbox.space/hls2/04/00895/q49ll9us6nok_,n,l,.urlset/master.m3u8?t=TOK";
const MEDIA = "https://gate-1-an.vmnow.online/hls2/04/00559/54dc10uswida_l/index-v1-a1.m3u8?t=TOK";

describe("extractVidmolyFileSlug", () => {
  it("extracts the file id from embed, urlset and media URL forms", () => {
    expect(extractVidmolyFileSlug(EMBED)).toBe("q49ll9us6nok");
    expect(extractVidmolyFileSlug(EMBED_OTHER_HOST)).toBe("q49ll9us6nok");
    expect(extractVidmolyFileSlug(URLSET)).toBe("q49ll9us6nok");
    expect(extractVidmolyFileSlug(MEDIA)).toBe("54dc10uswida");
  });

  it("returns null for URLs without a file id", () => {
    expect(extractVidmolyFileSlug("https://vidmoly.biz/embed.html")).toBeNull();
    expect(extractVidmolyFileSlug("https://example.com/hls2/04/index.m3u8")).toBeNull();
    expect(extractVidmolyFileSlug("")).toBeNull();
  });
});

describe("dead-file memory", () => {
  it("marks via one form, detects across ALL forms of the same file", () => {
    expect(isDeadFileSlug(URLSET)).toBe(false);
    markDeadFileSlug(EMBED);
    expect(isDeadFileSlug(EMBED_OTHER_HOST)).toBe(true); // the production case
    expect(isDeadFileSlug(URLSET)).toBe(true);
    expect(isDeadFileSlug(MEDIA)).toBe(false); // different file stays live
  });

  it("forgets after the TTL so transient failures self-heal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    markDeadFileSlug(EMBED);
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(isDeadFileSlug(EMBED)).toBe(true);
    vi.advanceTimersByTime(2 * 60 * 1000); // 31 min total > 30 min TTL
    expect(isDeadFileSlug(EMBED)).toBe(false);
  });
});

describe("compression decision (8.47)", () => {
  it("flags sources already at/below the target as pointless to re-encode", () => {
    expect(compressionPointless(480, 480)).toBe(true);
    expect(compressionPointless(360, 480)).toBe(true);
    expect(compressionPointless(1080, 480)).toBe(false);
    expect(compressionPointless(720, 480)).toBe(false);
  });

  it("never skips when the probe failed (null → compress as before)", () => {
    expect(compressionPointless(null, 480)).toBe(false);
    expect(compressionPointless(0, 480)).toBe(false);
  });
});

describe("wiring (8.47)", () => {
  it("every retry surface checks the dead-file memory and marks failures", () => {
    const hls = fs.readFileSync("src/bot/services/hlsDownloader.ts", "utf-8");
    expect(hls).toContain("isDeadFileSlug(masterUrl)"); // urlset matrix skip

    const ext = fs.readFileSync("src/bot/services/animeStreamExtractor.ts", "utf-8");
    expect(ext).toContain("isDeadFileSlug(stream.url)"); // funnel guard
    expect(ext).toContain("isDeadFileSlug(mirrorUrl)"); // mirror-loop skip
    expect((ext.match(/markDeadFileSlug\(mirrorUrl\)/g) || []).length).toBe(2); // both failure exits

    const nova = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(nova).toContain("isDeadFileSlug(targetHlsUrl)"); // novabox ffmpeg guard
    expect((nova.match(/markDeadFileSlug\(targetHlsUrl\)/g) || []).length).toBe(2); // single + batch marks
  });

  it("compression is skipped via a real height probe before encoding", () => {
    const nova = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    // 8.48 folded the probe into mediaToolkit.probeVideoInfo (duration + height)
    expect(nova).toContain("probeVideoInfo(localPath)");
    expect(nova).toContain("compressionPointless(probed.height, 480)");
    expect(nova).toContain("compression skipped, delivering via high-speed link");
  });
});
