import { describe, expect, it } from "vitest";
import { purgeStartupOrphans } from "../src/bot/tempDownloadManager.js";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Audit 8.16 — OOM-killed runs leave debris (kernel kills bypass `finally`
 * cleanup): episode files in nebula_temp_downloads and cat_catch_* HLS staging
 * dirs in os.tmpdir(). Because the token registry is in-memory, after a
 * restart every stored file is unreachable anyway, so the startup purge may
 * remove them all — otherwise the 4 GB quota saturates and fresh batches fail
 * with "Temporary download storage quota reached".
 */
describe("purgeStartupOrphans (audit 8.16)", () => {
  const tempDir = path.join(os.tmpdir(), "nebula_temp_downloads");

  it("removes orphaned episode files and cat_catch_/batch_zip_ staging dirs", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const staleEpisode = path.join(tempDir, "deadtoken_S01_E09.mp4");
    fs.writeFileSync(staleEpisode, Buffer.alloc(2048, 1));

    const catCatchDir = path.join(os.tmpdir(), `cat_catch_${Date.now()}_test`);
    fs.mkdirSync(path.join(catCatchDir, "segments"), { recursive: true });
    fs.writeFileSync(path.join(catCatchDir, "segments", "segment_000000.ts"), Buffer.alloc(512, 2));

    const zipStaging = path.join(os.tmpdir(), `batch_zip_${Date.now()}_test`);
    fs.mkdirSync(zipStaging, { recursive: true });

    // Innocent bystanders must survive: unrelated tmp entries are untouched.
    const bystander = path.join(os.tmpdir(), `unrelated_${Date.now()}.txt`);
    fs.writeFileSync(bystander, "keep me");

    try {
      const result = purgeStartupOrphans();

      expect(fs.existsSync(staleEpisode)).toBe(false);
      expect(fs.existsSync(catCatchDir)).toBe(false);
      expect(fs.existsSync(zipStaging)).toBe(false);
      expect(fs.existsSync(bystander)).toBe(true);
      expect(result.cleanedItems).toBeGreaterThanOrEqual(3);
      expect(result.freedBytes).toBeGreaterThan(0);
    } finally {
      try { fs.rmSync(catCatchDir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(zipStaging, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(bystander); } catch {}
    }
  });
});
