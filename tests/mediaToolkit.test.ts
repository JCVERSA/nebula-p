import { describe, expect, it } from "vitest";
import fs from "fs";
import {
  atempoChain,
  buildCompressArgs,
  buildGifArgs,
  buildMp3Args,
  buildSpeedArgs,
  buildTrimArgs,
  crfFromPercentage,
  estimateSizeMb,
  gifVideoFilter,
  parseTimeSpec,
  scalePadFilter,
  speedFilterComplex,
  videoBitrateKbpsForTargetMb,
  whatsappFitVideoOptions
} from "../src/bot/services/mediaToolkit.js";
import { extractQuotedMediaContent } from "../src/bot/utils/quotedMedia.js";

/**
 * Media toolkit (audit 8.48): pure FFmpeg recipes — size-target compression
 * (video-compress formula with the audio track subtracted), percentage→CRF,
 * chained atempo, palettegen GIFs, lossless trims.
 */

describe("formulas (8.48)", () => {
  it("percentage → CRF mapping with clamps", () => {
    expect(crfFromPercentage(100)).toBe(18);
    expect(crfFromPercentage(50)).toBe(35); // 51 - 16.5 → 34.5 → 35
    expect(crfFromPercentage(0)).toBe(51);
    expect(crfFromPercentage(150)).toBe(18); // clamped high
    expect(crfFromPercentage(-5)).toBe(51); // clamped low
    expect(crfFromPercentage(NaN)).toBe(35); // NaN falls back to 50%
  });

  it("target-MB bitrate SUBTRACTS the audio track (the video-compress bug we fix)", () => {
    // 95 MB over 1200 s = 648.5 total kbps → 648 - 96 = 552 video kbps
    expect(videoBitrateKbpsForTargetMb(95, 1200, 96)).toBe(552);
    // estimate round-trips to the target
    expect(estimateSizeMb(1200, 552, 96)).toBeCloseTo(94.92, 1); // floor(95*8192/1200)=648 total kbps
    // clamps
    expect(videoBitrateKbpsForTargetMb(95, 10, 96)).toBe(4000); // absurd short clip → cap
    expect(videoBitrateKbpsForTargetMb(5, 60 * 60 * 6, 96)).toBe(120); // 6 h → floor
  });

  it("atempo chains respect the per-filter [0.5, 2.0] limit", () => {
    expect(atempoChain(1.5)).toEqual(["atempo=1.5"]);
    expect(atempoChain(2)).toEqual(["atempo=2"]);
    expect(atempoChain(3)).toEqual(["atempo=2", "atempo=1.5"]); // 3 = 2 x 1.5
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5"]); // clamped to the 0.5 floor
    expect(atempoChain(10)).toEqual(["atempo=2", "atempo=2"]); // factor clamped to 4 max
  });

  it("time specs parse MM:SS, HH:MM:SS, 1m30 and plain seconds", () => {
    expect(parseTimeSpec("1:20")).toBe(80);
    expect(parseTimeSpec("12:05:30")).toBe(43530);
    expect(parseTimeSpec("1m30")).toBe(90);
    expect(parseTimeSpec("45")).toBe(45);
    expect(parseTimeSpec("1:99")).toBeNull();
    expect(parseTimeSpec("abc")).toBeNull();
    expect(parseTimeSpec("")).toBeNull();
  });
});

describe("argument builders (8.48)", () => {
  it("mp3: bitrate whitelist with default 192", () => {
    expect(buildMp3Args("in", "out.mp3", 320)).toContain("-b:a");
    const i = buildMp3Args("in", "out.mp3", 320).indexOf("-b:a");
    expect(buildMp3Args("in", "out.mp3", 320)[i + 1]).toBe("320k");
    expect(buildMp3Args("in", "out.mp3", 123)[buildMp3Args("in", "out.mp3", 123).indexOf("-b:a") + 1]).toBe("192k");
    expect(buildMp3Args("in", "out.mp3", 192)).toContain("-vn");
  });

  it("gif: palettegen/lanczos recipe, bounds, and duration cap", () => {
    const args = buildGifArgs("in", "out.gif", 12, 480, 10);
    expect(args.join(" ")).toContain("palettegen");
    expect(args.join(" ")).toContain("lanczos");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("10");
    expect(gifVideoFilter(15, 640)).toBe("fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse");
    // out-of-range fps/width are clamped
    const clamped = buildGifArgs("in", "out.gif", 99, 9999, 10);
    expect(clamped.join(" ")).toContain("fps=24");
    expect(clamped.join(" ")).toContain("scale=1280");
  });

  it("speed: setpts + chained atempo, video-only variant without audio map", () => {
    expect(speedFilterComplex(2, true)).toBe("[0:v]setpts=0.500000[v];[0:a]atempo=2[a]");
    expect(speedFilterComplex(3, true)).toContain("atempo=2,atempo=1.5");
    expect(speedFilterComplex(1.5, false)).not.toContain("[0:a]");
    const args = buildSpeedArgs("in", "out.mp4", 3, true);
    expect(args).toContain("-map");
    expect(args.join(" ")).toContain("atempo=2,atempo=1.5");
  });

  it("trim: lossless stream copy with -ss/-to", () => {
    const args = buildTrimArgs("in", "out.mp4", 80, 225);
    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args[args.indexOf("-ss") + 1]).toBe("80");
    expect(args[args.indexOf("-to") + 1]).toBe("225");
  });

  it("compress: mb mode computes -b:v with audio subtracted; pct maps to CRF; unknown duration falls back", () => {
    const mb = buildCompressArgs("in", "out.mp4", { mode: "mb", value: 95, durationSec: 1200 });
    expect(mb.args).toContain("-b:v");
    expect(mb.args[mb.args.indexOf("-b:v") + 1]).toBe("552k"); // (95*8192/1200)-96
    expect(mb.args).toContain("-maxrate");

    const pct = buildCompressArgs("in", "out.mp4", { mode: "pct", value: 50 });
    expect(pct.args[pct.args.indexOf("-crf") + 1]).toBe("35");

    const noDur = buildCompressArgs("in", "out.mp4", { mode: "mb", value: 95, durationSec: null });
    expect(noDur.args).toContain("-crf"); // fallback
    expect(noDur.note).toContain("durée inconnue");
  });

  it("whatsappFitVideoOptions: deterministic options, null on unknown duration", () => {
    const fit = whatsappFitVideoOptions(1440, 92, 480)!;
    expect(fit.videoKbps).toBe(427); // (92*8192/1440)-96
    expect(fit.options.join(" ")).toContain("-b:v");
    expect(fit.options.join(" ")).toContain("-maxrate");
    expect(fit.note).toContain("91.9 MB");
    expect(whatsappFitVideoOptions(null)).toBeNull();
    expect(whatsappFitVideoOptions(0)).toBeNull();
  });

  it("scale+pad preserves aspect (no distortion)", () => {
    expect(scalePadFilter(640, 360)).toBe(
      "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2"
    );
  });
});

describe("quoted media extraction (8.48)", () => {
  it("finds the quoted message's video and unwraps viewOnce wrappers", () => {
    const content = {
      conversation: undefined,
      extendedTextMessage: {
        text: ".m gif",
        contextInfo: { quotedMessage: { videoMessage: { url: "x" } } }
      }
    };
    expect(extractQuotedMediaContent(content as any)?.videoMessage).toBeTruthy();

    const viewOnce = {
      extendedTextMessage: {
        text: ".m mp3",
        contextInfo: { quotedMessage: { viewOnceMessageV2: { message: { audioMessage: {} } } } }
      }
    };
    expect(extractQuotedMediaContent(viewOnce as any)?.audioMessage).toBeTruthy();
  });

  it("returns null for text-only quotes and no quote at all", () => {
    const textQuote = { extendedTextMessage: { text: "hi", contextInfo: { quotedMessage: { conversation: "plain" } } } };
    expect(extractQuotedMediaContent(textQuote as any)).toBeNull();
    expect(extractQuotedMediaContent({ conversation: "hi" } as any)).toBeNull();
    expect(extractQuotedMediaContent(undefined)).toBeNull();
  });
});

describe("wiring (8.48)", () => {
  it("botEngine falls back to the quoted media; the .m command and deterministic novabox compression exist", () => {
    const engine = fs.readFileSync("src/bot/botEngine.ts", "utf-8");
    expect(engine).toContain("extractQuotedMediaContent(messageContent)");

    const cmd = fs.readFileSync("src/bot/commands/media.ts", "utf-8");
    expect(cmd).toContain('name: "media"');
    expect(cmd).toContain('"m"');
    for (const tool of ["mp3", "gif", "vitesse", "trim", "compress"]) {
      expect(cmd).toContain(tool);
    }

    const nova = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(nova).toContain("whatsappFitVideoOptions(probed.durationSec, 92, 480)");
    expect(nova).toContain("Deterministic WhatsApp fit");
  });
});
