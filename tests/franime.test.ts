import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseFranimeCatalog,
  parseFranimePlayerBody,
  isCloudflareChallenge,
  isFranimeRef,
  parseFranimeAnimeRef,
  parseFranimeSeasonRef,
  clearFranimeCache,
  franimeVfOracle,
  franimeSeasonHasVf,
} from "../src/bot/services/franimeClient.js";

describe("parseFranimeCatalog", () => {
  it("keeps valid animes and drops garbage entries", () => {
    const raw = [
      { id: 1, title: "A", saisons: [{ title: "Saison 1", episodes: [{ lang: { vf: { lecteurs: ["sibnet"] } } }] }] },
      { nope: true },
      { id: 2, title: "B" }
    ];
    const out = parseFranimeCatalog(raw);
    expect(out.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe("isCloudflareChallenge", () => {
  it("detects managed-challenge interstitials", () => {
    expect(isCloudflareChallenge("<html><title>Just a moment...</title>_cf_chl_opt")).toBe(true);
    expect(isCloudflareChallenge('<script>window._cf_chl_opt = {};</script>')).toBe(true);
    expect(isCloudflareChallenge("https://video.sibnet.ru/v/abc.mp4")).toBe(false);
    expect(isCloudflareChallenge("")).toBe(false);
  });
});

describe("parseFranimePlayerBody", () => {
  it("reads a plain-text player URL", () => {
    expect(parseFranimePlayerBody("https://vidmoly.org/embed-abc.html\n")).toBe("https://vidmoly.org/embed-abc.html");
  });
  it("reads simple JSON wrappers", () => {
    expect(parseFranimePlayerBody('{"url":"https://x/y.m3u8"}')).toBe("https://x/y.m3u8");
  });
  it("extracts the first URL from loose HTML", () => {
    expect(parseFranimePlayerBody('<html><script>src="https://cdn/a.m3u8"</script>')).toBe("https://cdn/a.m3u8");
  });
  it("returns null on challenge bodies and garbage", () => {
    expect(parseFranimePlayerBody("<html><title>Just a moment...</title>")).toBeNull();
    expect(parseFranimePlayerBody("no url here")).toBeNull();
    expect(parseFranimePlayerBody("")).toBeNull();
  });
});

describe("franime refs", () => {
  it("parses anime and season refs", () => {
    expect(isFranimeRef("franime:349")).toBe(true);
    expect(isFranimeRef("https://nakanime.tv/x")).toBe(false);
    expect(parseFranimeAnimeRef("franime:349")).toBe(349);
    expect(parseFranimeSeasonRef("franime:349/1")).toEqual({ animeId: 349, seasonIndex: 1 });
    expect(parseFranimeSeasonRef("https://x")).toBeNull();
  });
});


describe("franimeVfOracle (8.62)", () => {
  const RAW = [
    {
      id: 1,
      title: "Naruto",
      saisons: [
        { title: "Saison 1", episodes: [{ lang: { vf: { lecteurs: ["sibnet"] }, vo: { lecteurs: ["vidmoly"] } } }] },
        { title: "Saison 2", episodes: [{ lang: { vo: { lecteurs: ["vidmoly"] } } }] }
      ]
    },
    { id: 2, title: "Solo Leveling VOSTFR", saisons: [{ title: "Saison 1", episodes: [{ lang: { vo: { lecteurs: ["x"] } } }] }] }
  ];

  const writeCatalog = () => fs.writeFileSync(path.join(os.tmpdir(), "franime-catalog.json"), JSON.stringify(RAW));
  let savedFlag: string | undefined;

  beforeEach(() => {
    savedFlag = process.env.NEBULA_FRANIME_ENABLED;
    clearFranimeCache();
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.NEBULA_FRANIME_ENABLED;
    else process.env.NEBULA_FRANIME_ENABLED = savedFlag;
    clearFranimeCache();
  });

  it("stays unknown when NEBULA_FRANIME_ENABLED is not set", async () => {
    delete process.env.NEBULA_FRANIME_ENABLED;
    const v = await franimeVfOracle("Naruto");
    expect(v.status).toBe("unknown");
    expect(v.seasons).toEqual([]);
  });

  it("answers vf / season-level truth from the cached catalog", async () => {
    process.env.NEBULA_FRANIME_ENABLED = "1";
    writeCatalog();
    const v = await franimeVfOracle("naruto");
    expect(v.status).toBe("vf");
    expect(v.matchedTitle).toBe("Naruto");
    expect(franimeSeasonHasVf(v, 1)).toBe(true); // S1 has a VF lecteur
    expect(franimeSeasonHasVf(v, 2)).toBe(false); // S2 VOSTFR only
    expect(franimeSeasonHasVf(v, 9)).toBeNull(); // unknown season number
  });

  it("answers no_vf when the matched title has zero VF seasons", async () => {
    process.env.NEBULA_FRANIME_ENABLED = "1";
    writeCatalog();
    const v = await franimeVfOracle("Solo Leveling VOSTFR");
    expect(v.status).toBe("no_vf");
  });

  it("returns unknown for a title with no confident match", async () => {
    process.env.NEBULA_FRANIME_ENABLED = "1";
    writeCatalog();
    expect((await franimeVfOracle("zzzzqqqqwwww")).status).toBe("unknown");
  });
});
