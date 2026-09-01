import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import {
  BatchZipManager,
  formatBatchEpisodeFilename,
  padEpisodeNumber,
  sanitizeFilename,
  sanitizeAndFormatEpisodeFilename,
  calculatePaddingDigits
} from "../src/bot/services/batchZipManager.js";
import { getTempDownload } from "../src/bot/tempDownloadManager.js";

describe("Batch Download Filename Sanitization and Zero Padding", () => {
  describe("padEpisodeNumber", () => {
    it("pads single digit episode numbers with zero", () => {
      expect(padEpisodeNumber(1)).toBe("01");
      expect(padEpisodeNumber(5)).toBe("05");
      expect(padEpisodeNumber(9)).toBe("09");
    });

    it("keeps two digit episode numbers intact with default 2 minDigits", () => {
      expect(padEpisodeNumber(10)).toBe("10");
      expect(padEpisodeNumber(24)).toBe("24");
      expect(padEpisodeNumber(99)).toBe("99");
    });

    it("pads three digits when minDigits is set to 3", () => {
      expect(padEpisodeNumber(1, 3)).toBe("001");
      expect(padEpisodeNumber(12, 3)).toBe("012");
      expect(padEpisodeNumber(100, 3)).toBe("100");
    });

    it("handles zero and decimal numbers safely", () => {
      expect(padEpisodeNumber(0)).toBe("00");
      expect(padEpisodeNumber(4.8)).toBe("04");
    });

    it("calculates padding digits dynamically based on episode count", () => {
      expect(calculatePaddingDigits(12)).toBe(2);
      expect(calculatePaddingDigits(99)).toBe(2);
      expect(calculatePaddingDigits(100)).toBe(3);
      expect(calculatePaddingDigits(1250)).toBe(4);
    });
  });

  describe("sanitizeFilename", () => {
    it("strips illegal filesystem characters", () => {
      const sanitized = sanitizeFilename('Naruto: Shippuden / Episode * 1? <VF> | "720p"');
      expect(sanitized).not.toContain(":");
      expect(sanitized).not.toContain("/");
      expect(sanitized).not.toContain("*");
      expect(sanitized).not.toContain("?");
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
      expect(sanitized).not.toContain("|");
      expect(sanitized).not.toContain('"');
    });

    it("prevents directory traversal patterns", () => {
      expect(sanitizeFilename("../../etc/passwd")).toBe("etc_passwd");
    });

    it("collapses multiple consecutive underscores", () => {
      expect(sanitizeFilename("Solo___Leveling___S01")).toBe("Solo_Leveling_S01");
    });

    it("handles empty or blank string gracefully", () => {
      expect(sanitizeFilename("")).toBe("unnamed_file");
    });
  });

  describe("formatBatchEpisodeFilename", () => {
    it("formats in 'simple' style as 'Episode 01.mp4', 'Episode 10.mp4'", () => {
      expect(formatBatchEpisodeFilename({ episodeNumber: 1, style: "simple" })).toBe("Episode 01.mp4");
      expect(formatBatchEpisodeFilename({ episodeNumber: 10, style: "simple" })).toBe("Episode 10.mp4");
      expect(formatBatchEpisodeFilename({ episodeNumber: 2, extension: "mkv", style: "simple" })).toBe("Episode 02.mkv");
    });

    it("formats in 'short' style as 'Ep01.mp4', 'Ep10.mp4'", () => {
      expect(formatBatchEpisodeFilename({ episodeNumber: 1, style: "short" })).toBe("Ep01.mp4");
      expect(formatBatchEpisodeFilename({ episodeNumber: 12, style: "short" })).toBe("Ep12.mp4");
    });

    it("formats in 'full' style with title, season, episode, and resolution", () => {
      const name = formatBatchEpisodeFilename({
        title: "Solo Leveling",
        season: "Saison 2",
        episodeNumber: 3,
        resolution: "720p",
        language: "VF",
        style: "full"
      });
      expect(name).toBe("Solo_Leveling_S02_Ep03_720p_VF.mp4");
    });

    it("dynamically widens padding when totalEpisodes >= 100", () => {
      const name1 = formatBatchEpisodeFilename({ episodeNumber: 5, totalEpisodes: 500, style: "simple" });
      const name2 = formatBatchEpisodeFilename({ episodeNumber: 42, totalEpisodes: 500, style: "simple" });
      const name3 = formatBatchEpisodeFilename({ episodeNumber: 125, totalEpisodes: 500, style: "simple" });

      expect(name1).toBe("Episode 005.mp4");
      expect(name2).toBe("Episode 042.mp4");
      expect(name3).toBe("Episode 125.mp4");
    });

    it("guarantees correct natural alphabetical sorting in destination devices", () => {
      const unpadded = ["Episode 1.mp4", "Episode 10.mp4", "Episode 2.mp4"];
      const unpaddedSorted = [...unpadded].sort();
      // Notice that unpadded 'Episode 10' incorrectly comes BEFORE 'Episode 2'
      expect(unpaddedSorted[1]).toBe("Episode 10.mp4");

      const padded = [1, 2, 10, 11, 3, 20].map((num) =>
        formatBatchEpisodeFilename({ episodeNumber: num, style: "simple" })
      );
      const paddedSorted = [...padded].sort();

      expect(paddedSorted).toEqual([
        "Episode 01.mp4",
        "Episode 02.mp4",
        "Episode 03.mp4",
        "Episode 10.mp4",
        "Episode 11.mp4",
        "Episode 20.mp4"
      ]);
    });

    it("works via convenience alias sanitizeAndFormatEpisodeFilename", () => {
      expect(sanitizeAndFormatEpisodeFilename(7, { style: "short" })).toBe("Ep07.mp4");
    });
  });
});

describe("BatchZipManager", () => {
  let testTempDir: string;
  let testEpisodeFiles: string[] = [];

  beforeEach(() => {
    testTempDir = path.join(os.tmpdir(), `batch_zip_test_${Date.now()}`);
    fs.mkdirSync(testTempDir, { recursive: true });
    testEpisodeFiles = [];

    // Create mock episode video files
    for (let i = 1; i <= 3; i++) {
      const filePath = path.join(testTempDir, `raw_stream_ep${i}.mp4`);
      fs.writeFileSync(filePath, `Dummy MP4 video stream data for Episode ${i}`, "utf-8");
      testEpisodeFiles.push(filePath);
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("packages multiple downloaded episodes into a single ZIP with zero-padded filenames", async () => {
    const episodeInputs = testEpisodeFiles.map((filePath, idx) => ({
      filePath,
      episodeNumber: idx + 1
    }));

    const result = await BatchZipManager.packageEpisodes({
      episodes: episodeInputs,
      animeTitle: "Jujutsu Kaisen",
      season: "S02",
      resolution: "1080P",
      language: "VOSTFR",
      ttlMinutes: 60,
      namingStyle: "simple",
      includeManifest: true
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.downloadUrl).toContain(`/api/media/download/${result.token}`);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.sizeMB).toBeGreaterThanOrEqual(0);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.episodesCount).toBe(3);

    // Verify ZIP structure and entry names using AdmZip
    const tempRecord = getTempDownload(result.token);
    expect(tempRecord).not.toBeNull();
    expect(fs.existsSync(tempRecord!.filePath)).toBe(true);

    const zip = new AdmZip(tempRecord!.filePath);
    const zipEntries = zip.getEntries().map((e) => e.entryName);

    expect(zipEntries).toContain("README.txt");
    expect(zipEntries).toContain("Episode 01.mp4");
    expect(zipEntries).toContain("Episode 02.mp4");
    expect(zipEntries).toContain("Episode 03.mp4");

    // Check README manifest contents
    const readmeEntry = zip.getEntry("README.txt");
    expect(readmeEntry).toBeDefined();
    const readmeText = readmeEntry!.getData().toString("utf-8");
    expect(readmeText).toContain("Jujutsu Kaisen");
    expect(readmeText).toContain("Total Episodes       : 3");
    expect(readmeText).toContain("Episode 01.mp4");
  });

  it("supports 'short' naming style (Ep01.mp4, Ep02.mp4)", async () => {
    const episodeInputs = testEpisodeFiles.map((filePath, idx) => ({
      filePath,
      episodeNumber: idx + 1
    }));

    const result = await BatchZipManager.packageEpisodes({
      episodes: episodeInputs,
      animeTitle: "Chainsaw Man",
      season: 1,
      resolution: "720p",
      namingStyle: "short",
      includeManifest: false
    });

    expect(result.success).toBe(true);
    const tempRecord = getTempDownload(result.token);
    const zip = new AdmZip(tempRecord!.filePath);
    const zipEntries = zip.getEntries().map((e) => e.entryName);

    expect(zipEntries).toContain("Ep01.mp4");
    expect(zipEntries).toContain("Ep02.mp4");
    expect(zipEntries).toContain("Ep03.mp4");
    expect(zipEntries).not.toContain("README.txt");
  });

  it("cleans up source episode files if cleanupSourceFiles is set to true", async () => {
    const episodeInputs = testEpisodeFiles.map((filePath, idx) => ({
      filePath,
      episodeNumber: idx + 1
    }));

    // Files exist before packaging
    expect(fs.existsSync(testEpisodeFiles[0])).toBe(true);

    const result = await BatchZipManager.packageEpisodes({
      episodes: episodeInputs,
      animeTitle: "Bleach",
      season: 1,
      cleanupSourceFiles: true
    });

    expect(result.success).toBe(true);
    // Source files should be cleaned up
    expect(fs.existsSync(testEpisodeFiles[0])).toBe(false);
    expect(fs.existsSync(testEpisodeFiles[1])).toBe(false);
    expect(fs.existsSync(testEpisodeFiles[2])).toBe(false);
  });

  it("handles empty episode input gracefully", async () => {
    const result = await BatchZipManager.packageEpisodes({
      episodes: []
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No episodes provided");
  });

  it("generates a sequence list of zero-padded filenames with generateFilenameList", () => {
    const filenames = BatchZipManager.generateFilenameList(5, {
      title: "Attack on Titan",
      season: "S04",
      style: "simple"
    });

    expect(filenames).toEqual([
      "Episode 01.mp4",
      "Episode 02.mp4",
      "Episode 03.mp4",
      "Episode 04.mp4",
      "Episode 05.mp4"
    ]);
  });
});
