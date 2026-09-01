import { describe, it, expect } from "vitest";
import {
  parseFranimeCatalog,
  parseFranimePlayerBody,
  isCloudflareChallenge,
  isFranimeRef,
  parseFranimeAnimeRef,
  parseFranimeSeasonRef
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
