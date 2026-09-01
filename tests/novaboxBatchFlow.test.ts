import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createBatchJob,
  getBatchJob,
  updateEpisodeProgress,
  completeBatchJob,
} from "../src/bot/batchDownloadManager.js";
import {
  registerTempDownload,
  getTempDownload,
} from "../src/bot/tempDownloadManager.js";
import { BatchZipManager } from "../src/bot/services/batchZipManager.js";

describe("Novabox Batch Flow & File Management", () => {
  const testFiles: string[] = [];

  afterEach(() => {
    for (const f of testFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    testFiles.length = 0;
  });

  it("registers temp download with moveFile: true without breaking subsequent access", () => {
    const srcPath = path.join(os.tmpdir(), `test_ep_${Date.now()}.mp4`);
    fs.writeFileSync(srcPath, "fake-video-content-stream-bytes-12345");
    testFiles.push(srcPath);

    const record = registerTempDownload(srcPath, "Anime_S01E01_1080P.mp4", {
      ttlMinutes: 60,
      moveFile: true,
    });

    expect(record.token).toBeDefined();
    expect(record.downloadUrl).toContain(record.token);
    expect(fs.existsSync(srcPath)).toBe(false); // Source file moved

    const fetched = getTempDownload(record.token);
    expect(fetched).not.toBeNull();
    expect(fetched?.filename).toBe("Anime_S01E01_1080P.mp4");
    expect(fs.existsSync(fetched!.filePath)).toBe(true);
    testFiles.push(fetched!.filePath);
  });

  it("handles batch job tracking with isolated episode failures", () => {
    const job = createBatchJob({
      animeTitle: "Jujutsu Kaisen",
      season: "Season 2",
      resolution: "1080P",
      language: "VOSTFR",
      totalEpisodes: 3,
      episodeNumbers: [1, 2, 3],
    });

    expect(job.status).toBe("queued");
    expect(job.episodes.length).toBe(3);

    // Episode 1 fails (simulating CDN glitch)
    updateEpisodeProgress(job.id, 1, {
      status: "failed",
      progressPercent: 0,
      error: "CDN mirror 403",
    });

    // Episode 2 succeeds
    updateEpisodeProgress(job.id, 2, {
      status: "completed",
      progressPercent: 100,
      sizeMB: 45.2,
      downloadUrl: "http://localhost:3000/api/media/download/tok2",
    });

    // Episode 3 succeeds
    updateEpisodeProgress(job.id, 3, {
      status: "completed",
      progressPercent: 100,
      sizeMB: 48.0,
      downloadUrl: "http://localhost:3000/api/media/download/tok3",
    });

    const updatedJob = getBatchJob(job.id);
    expect(updatedJob).not.toBeNull();
    expect(updatedJob!.episodes[0].status).toBe("failed");
    expect(updatedJob!.episodes[1].status).toBe("completed");
    expect(updatedJob!.episodes[2].status).toBe("completed");

    // Total job can complete partially ready
    completeBatchJob(job.id, {
      zipDownloadUrl: "http://localhost:3000/api/media/download/zipTok",
      zipFilename: "Jujutsu_Kaisen_S02_Complete.zip",
      zipSizeMB: 93.2,
      zipToken: "zipTok",
      expiresAt: Date.now() + 3600000,
    });

    const completed = getBatchJob(job.id);
    expect(completed!.status).toBe("completed");
    expect(completed!.zipDownloadUrl).toBe("http://localhost:3000/api/media/download/zipTok");
  });

  it("packages available episodes into ZIP while keeping source links valid", async () => {
    const ep1Path = path.join(os.tmpdir(), `test_pkg_ep1_${Date.now()}.mp4`);
    const ep2Path = path.join(os.tmpdir(), `test_pkg_ep2_${Date.now()}.mp4`);
    fs.writeFileSync(ep1Path, "video-episode-1-stream-data");
    fs.writeFileSync(ep2Path, "video-episode-2-stream-data");
    testFiles.push(ep1Path, ep2Path);

    const res = await BatchZipManager.packageEpisodes({
      episodes: [
        { filePath: ep1Path, episodeNumber: 1 },
        { filePath: ep2Path, episodeNumber: 2 },
      ],
      animeTitle: "Solo Leveling",
      season: "S01",
      resolution: "720P",
      language: "VF",
      cleanupSourceFiles: false,
    });

    expect(res.success).toBe(true);
    expect(res.episodesCount).toBe(2);
    expect(fs.existsSync(ep1Path)).toBe(true);
    expect(fs.existsSync(ep2Path)).toBe(true);
    const tempRecord = getTempDownload(res.token);
    expect(tempRecord).not.toBeNull();
    expect(fs.existsSync(tempRecord!.filePath)).toBe(true);
    testFiles.push(tempRecord!.filePath);
  });
});
