import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import {
  clearFallbackCacheForTests,
  getCrossSourceFallbackMirrors,
  isVfLangLabel,
  languageOfUrl,
  pickBestResult,
  pickCandidateSeasons,
  resolveFallbackSource,
  tierMirrorsForEpisode,
  type FallbackDeps,
  type FallbackEpisodeAccess
} from "../src/bot/services/animeFallback.js";

/**
 * Cross-source fallback (audit 8.46): when every mirror of the selected
 * source fails (production case: a vidmoly CDN node 403s the VPS for one
 * file), the episode is retried on the secondary catalog — VF-labeled lists
 * first, honest language reporting.
 */

const TITLE = "Vinland Saga";

function makeDeps() {
  const calls = { search: 0, seasons: 0, players: [] as string[] };
  const deps: FallbackDeps = {
    search: async () => {
      calls.search++;
      return [
        { title: "Vinland Saga", url: "https://nakanime.tv/anime/12/vinland-saga" },
        { title: "Vinland Saga & Mermaid", url: "https://nakanime.tv/anime/99/other" }
      ];
    },
    seasons: async () => {
      calls.seasons++;
      return [
        { name: "Saison 1", url: "https://nakanime.tv/anime/12/season/1" },
        { name: "Saison 2 VOSTFR", url: "https://nakanime.tv/anime/12/season/2v" },
        { name: "Saison 2 VF", url: "https://nakanime.tv/anime/12/season/2vf" }
      ];
    },
    players: async (seasonUrl: string): Promise<FallbackEpisodeAccess> => {
      calls.players.push(seasonUrl);
      if (seasonUrl.endsWith("/2vf")) {
        return {
          lists: { 1: ["https://vp1.example/embed-a"], 2: ["https://vp2.example/embed-b"] },
          labels: { 1: { language: "VF" }, 2: { language: "VOSTFR" } }
        };
      }
      if (seasonUrl.endsWith("/2v")) {
        return { lists: { 1: ["https://vp3.example/embed-c"] }, labels: { 1: { language: "VOSTFR" } } };
      }
      return { lists: {}, labels: {} };
    }
  };
  return { deps, calls };
}

beforeEach(() => clearFallbackCacheForTests());

describe("language helpers", () => {
  it("detects VF labels without matching VOSTFR", () => {
    expect(isVfLangLabel("VF")).toBe(true);
    expect(isVfLangLabel("vf")).toBe(true);
    expect(isVfLangLabel("VOSTFR")).toBe(false);
    expect(isVfLangLabel("vost")).toBe(false);
    expect(isVfLangLabel("")).toBe(false);
  });

  it("languageOfUrl maps a downloaded URL back to its list language", () => {
    const lists = { 1: ["https://a.example/x"], 2: ["https://b.example/y"] };
    const labels = { 1: { language: "VF" }, 2: { language: "VOSTFR" } };
    expect(languageOfUrl(lists, labels, "https://a.example/x")).toBe("VF");
    expect(languageOfUrl(lists, labels, "https://b.example/y")).toBe("VOSTFR");
    expect(languageOfUrl(lists, labels, "https://c.example/z")).toBeNull();
  });
});

describe("catalog matching", () => {
  it("pickBestResult prefers exact then prefix matches, rejects noise", () => {
    const results = [
      { title: "Vinland Saga & Mermaid", url: "u1" },
      { title: "Vinland Saga", url: "u2" },
      { title: "One Piece", url: "u3" }
    ];
    expect(pickBestResult(results, "vinland saga")?.url).toBe("u2");
    expect(pickBestResult(results, "Complètement Autre Chose")?.url ?? null).toBeNull();
    expect(pickBestResult([], "x")).toBeNull();
  });

  it("pickCandidateSeasons filters by season number and orders VF first when VF is wanted", () => {
    const seasons = [
      { name: "Saison 1", url: "s1" },
      { name: "Saison 2 VOSTFR", url: "s2v" },
      { name: "Saison 2 VF", url: "s2vf" },
      { name: "Film", url: "f" }
    ];
    expect(pickCandidateSeasons(seasons, 2, true).map(s => s.url)).toEqual(["s2vf", "s2v"]);
    expect(pickCandidateSeasons(seasons, 2, false).map(s => s.url)).toEqual(["s2v", "s2vf"]);
    expect(pickCandidateSeasons(seasons, 7, true)).toEqual([]);
  });
});

describe("mirror tiering", () => {
  it("VF and unlabeled lists are primary, other languages are tier two", () => {
    const lists = { 1: ["https://vf.example/a"], 2: ["https://vost.example/b"], 3: ["https://any.example/c"] };
    const labels = { 1: { language: "VF" }, 2: { language: "VOSTFR" } };
    const tiers = tierMirrorsForEpisode(lists, labels, 0, true);
    // same semantics as the main flow's splitMirrorsByLanguage: in a labeled
    // context, a label-less list is NOT assumed VF — it goes to tier two
    expect(tiers.primary).toEqual(["https://vf.example/a"]);
    expect(tiers.secondary).toEqual(["https://vost.example/b", "https://any.example/c"]);
  });

  it("returns empty tiers for an out-of-range episode index", () => {
    const tiers = tierMirrorsForEpisode({ 1: ["https://vf.example/a"] }, { 1: { language: "VF" } }, 5, true);
    expect(tiers.primary).toEqual([]);
    expect(tiers.secondary).toEqual([]);
  });
});

describe("resolution + cache", () => {
  it("resolves the VF season of the same number and caches per title|season", async () => {
    const { deps, calls } = makeDeps();
    const first = await resolveFallbackSource(TITLE, 2, true, deps);
    expect(first?.seasonUrl).toBe("https://nakanime.tv/anime/12/season/2vf");
    expect(calls.search).toBe(1);
    expect(calls.seasons).toBe(1);
    expect(calls.players).toEqual(["https://nakanime.tv/anime/12/season/2vf"]);

    const second = await resolveFallbackSource(TITLE, 2, true, deps);
    expect(second?.seasonUrl).toBe(first?.seasonUrl);
    expect(calls.search).toBe(1); // served from cache
  });

  it("returns null when the catalog has nothing for that title/season", async () => {
    const { deps } = makeDeps();
    expect(await resolveFallbackSource(TITLE, 9, true, deps)).toBeNull();
  });

  it("getCrossSourceFallbackMirrors orders mirrors VF-first and carries lists for honesty", async () => {
    const { deps } = makeDeps();
    const fb = await getCrossSourceFallbackMirrors(TITLE, 2, 0, "VF", deps);
    expect(fb?.mirrors).toEqual(["https://vp1.example/embed-a", "https://vp2.example/embed-b"]);
    expect(languageOfUrl(fb!.lists, fb!.labels, fb!.mirrors[0])).toBe("VF");

    clearFallbackCacheForTests(); // the previous call cached title|season 2
    const fbVostOnly = await getCrossSourceFallbackMirrors(TITLE, 2, 0, "VOSTFR", {
      ...deps,
      players: async (url): Promise<FallbackEpisodeAccess> =>
        url.endsWith("/2v")
          ? { lists: { 1: ["https://vp3.example/embed-c"] }, labels: { 1: { language: "VOSTFR" } } }
          : { lists: {}, labels: {} }
    });
    expect(fbVostOnly?.mirrors).toEqual(["https://vp3.example/embed-c"]);
  });
});

describe("wiring (8.46)", () => {
  it("novabox wires the fallback in single + batch flows behind NEBULA_VOSTFR_FALLBACK", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect((src.match(/NEBULA_VOSTFR_FALLBACK/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("getCrossSourceFallbackMirrors(");
    expect(src).toContain("deliveredFilename"); // honest filename when language differs
    expect(src).toContain("rescued"); // batch per-episode rescue
    expect(src).toContain("fallbackLangDelivered"); // batch summary note
  });

  it("env surfaces document the toggle (default ON, 0 disables)", () => {
    const env = fs.readFileSync(".env.example", "utf-8");
    expect(env).toContain("NEBULA_VOSTFR_FALLBACK");
    const sh = fs.readFileSync("manage.sh", "utf-8");
    expect(sh).toContain("NEBULA_VOSTFR_FALLBACK");
  });
});
