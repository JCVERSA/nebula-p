import { describe, it, expect } from "vitest";
import { canonicalResolutionForChoice } from "../src/bot/utils/quickAnimeParser.js";
import { pickOptimalStream, resolveCanonicalQualityTrack } from "../src/bot/services/animeStreamExtractor.js";
import { isNakanimeVfLabel, splitMirrorsByLanguage } from "../src/bot/commands/novabox.js";

describe("canonicalResolutionForChoice (quick mode rN semantics)", () => {
  it("maps r1..r4 to the canonical menu qualities", () => {
    expect(canonicalResolutionForChoice("r1")).toBe("480P");
    expect(canonicalResolutionForChoice("r2")).toBe("360P");
    expect(canonicalResolutionForChoice("r3")).toBe("720P");
    expect(canonicalResolutionForChoice("r4")).toBe("1080P");
  });
  it("clamps out-of-range indices instead of returning garbage", () => {
    expect(canonicalResolutionForChoice("r9")).toBe("1080P");
    expect(canonicalResolutionForChoice("r0")).toBe("480P");
  });
  it("accepts explicit and sloppy forms", () => {
    expect(canonicalResolutionForChoice("480p")).toBe("480P");
    expect(canonicalResolutionForChoice("720P")).toBe("720P");
    expect(canonicalResolutionForChoice("")).toBe("480P");
  });
});

describe("pickOptimalStream nearest-quality fallback", () => {
  const t = (resolution: string, url = "https://x/" + resolution) =>
    ({ resolution, url, type: "hls" as const });

  it("returns the exact match when present", () => {
    const tracks = [t("720P"), t("360P"), t("1080P")];
    expect(pickOptimalStream(tracks, "360P").resolution).toBe("360P");
  });

  it("prefers the tallest track not taller than the request", () => {
    const tracks = [t("360P"), t("480P"), t("720P")];
    expect(pickOptimalStream(tracks, "480P").resolution).toBe("480P");
    // 360P requested, only 360 absent: tallest <= 360 none -> smallest (720P)
    const only720 = [t("720P"), t("1080P")];
    expect(pickOptimalStream(only720, "360P").resolution).toBe("720P");
  });

  it("never silently upgrades to a bigger quality than requested when smaller exists", () => {
    const tracks = [t("480P"), t("1080P")];
    expect(pickOptimalStream(tracks, "360P").resolution).toBe("480P");
  });

  it("keeps the legacy 480>360>720 preference when nothing requested", () => {
    const tracks = [t("1080P"), t("360P"), t("720P")];
    expect(pickOptimalStream(tracks).resolution).toBe("360P");
  });
});

describe("isNakanimeVfLabel", () => {
  it("detects French dub labels and nothing else", () => {
    expect(isNakanimeVfLabel("VF")).toBe(true);
    expect(isNakanimeVfLabel("vf")).toBe(true);
    expect(isNakanimeVfLabel("VOSTFR")).toBe(false);
    expect(isNakanimeVfLabel("vostfr")).toBe(false);
    expect(isNakanimeVfLabel("VOST")).toBe(false);
    expect(isNakanimeVfLabel("")).toBe(false);
  });
});

describe("splitMirrorsByLanguage", () => {
  const eps = {
    1: ["https://vf.example/e1", "https://vf.example/e2"],
    2: ["https://vost.example/e1", "https://vost.example/e2"],
    3: ["https://vf2.example/e1", "https://vf2.example/e2"]
  };
  const labels = {
    1: { host: "P1", language: "VF" },
    2: { host: "P2", language: "VOSTFR" },
    3: { host: "P3", language: "VF" }
  };

  it("puts VF lists first when VF is requested (VF-by-default)", () => {
    const { primary, secondary } = splitMirrorsByLanguage(eps, labels, 0, "VF");
    expect(primary).toEqual(["https://vf.example/e1", "https://vf2.example/e1"]);
    expect(secondary).toEqual(["https://vost.example/e1"]);
  });

  it("puts VOSTFR lists first when VOSTFR is requested", () => {
    const { primary, secondary } = splitMirrorsByLanguage(eps, labels, 1, "VOSTFR");
    expect(primary).toEqual(["https://vost.example/e2"]);
    expect(secondary).toEqual(["https://vf.example/e2", "https://vf2.example/e2"]);
  });

  it("keeps every list primary when no labels exist (anime-sama path)", () => {
    const { primary, secondary } = splitMirrorsByLanguage(eps, undefined, 0, "VF");
    expect(primary.length).toBe(3);
    expect(secondary.length).toBe(0);
  });

  it("falls back to all mirrors when the requested language has no list", () => {
    const onlyVost = { 1: eps[2] };
    const onlyVostLabels = { 1: labels[2] };
    const { primary } = splitMirrorsByLanguage(onlyVost, onlyVostLabels, 0, "VF");
    expect(primary).toEqual(["https://vost.example/e1"]);
  });
});

describe("resolveCanonicalQualityTrack (vidmoly-first early-exit, audit 8.5)", () => {
  const probeOk = (tracks: Array<{ resolution: string; url: string }>) => async () => ({
    hostName: "test",
    url: tracks[0]?.url || "https://x/master.m3u8",
    type: "hls" as const,
    headers: {},
    availableTracks: tracks.map((t) => ({ ...t, type: "hls" as const }))
  });

  it("returns the exact canonical quality from the first mirror that has it", async () => {
    const probed: string[] = [];
    const match = await resolveCanonicalQualityTrack(
      ["https://vidmoly.org/e/a", "https://ansembed.net/e/b"],
      "480P",
      async (u) => {
        probed.push(u);
        return probeOk([{ resolution: "480P", url: "https://cdn/480.m3u8" }, { resolution: "1080P", url: "https://cdn/1080.m3u8" }])();
      }
    );
    expect(match?.exact).toBe(true);
    expect(match?.label).toBe("480P");
    expect(match?.url).toBe("https://cdn/480.m3u8");
    expect(probed).toEqual(["https://vidmoly.org/e/a"]); // early exit
  });

  it("falls back to the nearest quality from the FIRST usable mirror without probing the rest", async () => {
    const probed: string[] = [];
    const match = await resolveCanonicalQualityTrack(
      ["https://vidmoly.org/e/a", "https://video.sibnet.ru/x"],
      "360P",
      async (u) => {
        probed.push(u);
        return probeOk([{ resolution: "480P", url: "https://cdn/480.m3u8" }, { resolution: "1080P", url: "https://cdn/1080.m3u8" }])();
      }
    );
    expect(match?.exact).toBe(false);
    expect(match?.label).toBe("480P");
    expect(probed).toEqual(["https://vidmoly.org/e/a"]);
  });

  it("moves to the next mirror when the first yields nothing", async () => {
    const match = await resolveCanonicalQualityTrack(
      ["https://vidmoly.org/e/a", "https://ansembed.net/e/b"],
      "720P",
      async (u) => (u.includes("vidmoly") ? null : probeOk([{ resolution: "720P", url: "https://cdn/720.m3u8" }])())
    );
    expect(match?.exact).toBe(true);
    expect(match?.url).toBe("https://cdn/720.m3u8");
  });

  it("probes in hostPriority order regardless of input order", async () => {
    const probed: string[] = [];
    await resolveCanonicalQualityTrack(
      ["https://video.sibnet.ru/x", "https://vidmoly.org/e/a"],
      "480P",
      async (u) => {
        probed.push(u);
        return probeOk([{ resolution: "1080P", url: "https://cdn/1080.m3u8" }])();
      }
    );
    expect(probed[0]).toBe("https://vidmoly.org/e/a");
  });

  it("returns null when no mirror yields anything", async () => {
    const match = await resolveCanonicalQualityTrack(["https://a.example/x"], "480P", async () => null);
    expect(match).toBeNull();
    expect(await resolveCanonicalQualityTrack([], "480P", async () => null)).toBeNull();
  });
});

describe("fast-lane size guard (audit 8.13)", () => {
  const tr = (resolution: string, mb: number, url: string) =>
    ({ resolution, url, fileSizeBytes: mb * 1048576, type: "hls" as const });

  it("downgrades a pathological 480P (400 MB) to the lightest <=480 track", () => {
    const tracks = [tr("480P", 400, "https://x/fat"), tr("360P", 90, "https://x/light")];
    expect(pickOptimalStream(tracks, "480P").url).toBe("https://x/light");
  });

  it("keeps a normal 480P when its size is WhatsApp-fit", () => {
    const tracks = [tr("480P", 88, "https://x/480"), tr("360P", 45, "https://x/360")];
    expect(pickOptimalStream(tracks, "480P").url).toBe("https://x/480");
  });

  it("resolveCanonicalQualityTrack reports the lighter variant honestly", async () => {
    const tracks = [tr("480P", 403, "https://x/fat"), tr("360P", 92, "https://x/light")];
    const probe = async () => ({
      hostName: "vidmoly",
      url: "https://x/master.m3u8",
      type: "hls" as const,
      headers: {},
      availableTracks: tracks
    });
    const match = await resolveCanonicalQualityTrack(["https://vidmoly.org/e/a"], "480P", probe);
    expect(match?.url).toBe("https://x/light");
    expect(match?.label).toBe("360P");
    expect(match?.exact).toBe(false);
  });

  it("does not touch non-fast-lane qualities (720P stays exact however fat)", () => {
    const tracks = [tr("720P", 500, "https://x/720"), tr("480P", 90, "https://x/480")];
    expect(pickOptimalStream(tracks, "720P").url).toBe("https://x/720");
  });
});
