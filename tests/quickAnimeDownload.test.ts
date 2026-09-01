import { describe, it, expect } from "vitest";
import {
  parseQuickDownloadParams,
  isExactAnimeMatch,
  resolveRequestedSeason,
  resolveRequestedEpisodes
} from "../src/bot/utils/quickAnimeParser.js";

describe("Quick Anime Download Parser & Matcher", () => {
  describe("parseQuickDownloadParams", () => {
    it("parses '.a jjk s3 all r2' correctly", () => {
      const parsed = parseQuickDownloadParams(["jjk", "s3", "all", "r2"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("jjk");
      expect(parsed.canonicalQuery).toBe("Jujutsu Kaisen");
      expect(parsed.seasonNumber).toBe(3);
      expect(parsed.episodesMode).toBe("all");
      expect(parsed.resolutionChoice).toBe("r2");
    });

    it("parses '.a jjk s3 ep6 r2' correctly", () => {
      const parsed = parseQuickDownloadParams(["jjk", "s3", "ep6", "r2"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("jjk");
      expect(parsed.canonicalQuery).toBe("Jujutsu Kaisen");
      expect(parsed.seasonNumber).toBe(3);
      expect(parsed.episodesMode).toBe("single");
      expect(parsed.parsedEpisodeNumbers).toEqual([6]);
      expect(parsed.resolutionChoice).toBe("r2");
    });

    it("parses '.a jjk s3 e1,2,3,5,7,8,9 r2' correctly", () => {
      const parsed = parseQuickDownloadParams(["jjk", "s3", "e1,2,3,5,7,8,9", "r2"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("jjk");
      expect(parsed.seasonNumber).toBe(3);
      expect(parsed.episodesMode).toBe("list");
      expect(parsed.parsedEpisodeNumbers).toEqual([1, 2, 3, 5, 7, 8, 9]);
      expect(parsed.resolutionChoice).toBe("r2");
    });

    it("parses '.a jjk s3 2-9 r2' correctly", () => {
      const parsed = parseQuickDownloadParams(["jjk", "s3", "2-9", "r2"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("jjk");
      expect(parsed.seasonNumber).toBe(3);
      expect(parsed.episodesMode).toBe("range");
      expect(parsed.parsedEpisodeNumbers).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(parsed.resolutionChoice).toBe("r2");
    });

    it("parses multi-word titles like '.a solo leveling s1 all' without resolution", () => {
      const parsed = parseQuickDownloadParams(["solo", "leveling", "s1", "all"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("solo leveling");
      expect(parsed.canonicalQuery).toBe("Solo Leveling");
      expect(parsed.seasonNumber).toBe(1);
      expect(parsed.episodesMode).toBe("all");
      expect(parsed.resolutionChoice).toBeUndefined();
    });

    it("parses quality tags like 1080p and language like vf", () => {
      const parsed = parseQuickDownloadParams(["demon", "slayer", "s2", "ep4", "1080p", "vf"]);
      expect(parsed.isQuickCommand).toBe(true);
      expect(parsed.animeQuery).toBe("demon slayer");
      expect(parsed.seasonNumber).toBe(2);
      expect(parsed.parsedEpisodeNumbers).toEqual([4]);
      expect(parsed.resolutionChoice).toBe("1080P");
      expect(parsed.language).toBe("VF");
    });

    it("identifies non-quick search commands properly", () => {
      const parsed = parseQuickDownloadParams(["solo", "leveling"]);
      expect(parsed.isQuickCommand).toBe(false);
      expect(parsed.animeQuery).toBe("solo leveling");
      expect(parsed.seasonNumber).toBeUndefined();
      expect(parsed.episodesSpec).toBeUndefined();
    });
  });

  describe("isExactAnimeMatch", () => {
    it("recognizes exact match from canonical abbreviation (jjk -> Jujutsu Kaisen)", () => {
      const results = [
        { title: "Jujutsu Kaisen", subtitle: "2020", url: "https://anime-sama.to/catalogue/jujutsu-kaisen/" },
        { title: "Jujutsu Kaisen (TV 2)", subtitle: "2023", url: "https://anime-sama.to/catalogue/jujutsu-kaisen-tv-2/" },
        { title: "Jujutsu Kaisen 0", subtitle: "Film", url: "https://anime-sama.to/catalogue/jujutsu-kaisen-0/" }
      ];

      const match = isExactAnimeMatch("jjk", results);
      expect(match.isExact).toBe(true);
      expect(match.exactMatchIndex).toBe(0);
    });

    it("recognizes exact match when title is identical to query", () => {
      const results = [
        { title: "Solo Leveling", subtitle: "2024", url: "https://anime-sama.to/catalogue/solo-leveling/" },
        { title: "Solo Leveling: ReAwakening", subtitle: "Film", url: "https://anime-sama.to/catalogue/solo-leveling-film/" }
      ];

      const match = isExactAnimeMatch("solo leveling", results);
      expect(match.isExact).toBe(true);
      expect(match.exactMatchIndex).toBe(0);
    });

    it("marks vague query like 'solo lev' as ambiguous (not exact)", () => {
      const results = [
        { title: "Solo Leveling", subtitle: "2024", url: "https://anime-sama.to/catalogue/solo-leveling/" },
        { title: "Solo Leveling: ReAwakening", subtitle: "Film", url: "https://anime-sama.to/catalogue/solo-leveling-film/" }
      ];

      const match = isExactAnimeMatch("solo lev", results);
      expect(match.isExact).toBe(false);
    });

    it("marks vague query like 'demon' as ambiguous (not exact)", () => {
      const results = [
        { title: "Demon Slayer: Kimetsu no Yaiba", subtitle: "2019", url: "..." },
        { title: "Demon Lord 2099", subtitle: "2024", url: "..." },
        { title: "The Misfit of Demon King Academy", subtitle: "2020", url: "..." }
      ];

      const match = isExactAnimeMatch("demon", results);
      expect(match.isExact).toBe(false);
    });

    it("marks single result as exact match", () => {
      const results = [
        { title: "Wind Breaker", subtitle: "2024", url: "..." }
      ];

      const match = isExactAnimeMatch("wind breaker", results);
      expect(match.isExact).toBe(true);
      expect(match.exactMatchIndex).toBe(0);
    });
  });

  describe("resolveRequestedSeason", () => {
    const seasons = [
      { name: "Saison 1", subPath: "saison1/vostfr", url: "https://anime-sama.to/catalogue/jjk/saison1/vostfr/" },
      { name: "Saison 2", subPath: "saison2/vostfr", url: "https://anime-sama.to/catalogue/jjk/saison2/vostfr/" },
      { name: "Saison 3", subPath: "saison3/vostfr", url: "https://anime-sama.to/catalogue/jjk/saison3/vostfr/" }
    ];

    it("finds season by season number", () => {
      const resolved = resolveRequestedSeason(seasons, 3);
      expect(resolved.season).not.toBeNull();
      expect(resolved.season?.name).toBe("Saison 3");
      expect(resolved.index).toBe(2);
    });

    it("returns null for non-existent season number", () => {
      const resolved = resolveRequestedSeason(seasons, 9);
      expect(resolved.season).toBeNull();
    });
  });

  describe("resolveRequestedEpisodes", () => {
    it("resolves all episodes mode", () => {
      const quickParams = parseQuickDownloadParams(["jjk", "s3", "all", "r2"]);
      const indices = resolveRequestedEpisodes(12, quickParams);
      expect(indices.length).toBe(12);
      expect(indices[0]).toBe(0);
      expect(indices[11]).toBe(11);
    });

    it("resolves single episode mode", () => {
      const quickParams = parseQuickDownloadParams(["jjk", "s3", "ep6", "r2"]);
      const indices = resolveRequestedEpisodes(12, quickParams);
      expect(indices).toEqual([5]);
    });

    it("resolves episode list mode", () => {
      const quickParams = parseQuickDownloadParams(["jjk", "s3", "e1,2,3,5,7,8,9", "r2"]);
      const indices = resolveRequestedEpisodes(12, quickParams);
      expect(indices).toEqual([0, 1, 2, 4, 6, 7, 8]);
    });

    it("resolves episode range mode", () => {
      const quickParams = parseQuickDownloadParams(["jjk", "s3", "2-9", "r2"]);
      const indices = resolveRequestedEpisodes(12, quickParams);
      expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });
});
