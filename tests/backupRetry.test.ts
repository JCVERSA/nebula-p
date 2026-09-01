import { describe, expect, it } from "vitest";
import { createBatchJob, retryBatchJob, retryEpisode } from "../src/bot/batchDownloadManager.js";
import { sanitizeWatchSubscriptions, WATCH_MAX_GLOBAL } from "../src/bot/services/episodeWatchService.js";

/**
 * Audit follow-up T1 (2026-09-01): R11 honesty — panel retry used to fake
 * progress on REAL WhatsApp jobs (status flips, no worker behind); it must
 * refuse explicitly and only work for simulator jobs. B1 — backups must round-
 * trip watch subscriptions through a bounded sanitizer.
 */

describe("R11: honest panel retry", () => {
  it("refuses retry on REAL (WhatsApp-driven) jobs with a clear pointer back to WhatsApp", () => {
    const job = createBatchJob({ animeTitle: "Sparks of Tomorrow", season: "S1", totalEpisodes: 3 });
    // real job: simulated flag untouched

    const ep = retryEpisode(job.id, 2);
    expect(ep.success).toBe(false);
    expect(ep.error).toContain("WhatsApp");

    const all = retryBatchJob(job.id);
    expect(all.success).toBe(false);
    expect(all.error).toContain("WhatsApp");
  });

  it("still works for simulator jobs (flagged simulated)", () => {
    const job = createBatchJob({ animeTitle: "Demo", season: "S1", totalEpisodes: 2 });
    job.simulated = true;

    const ep = retryEpisode(job.id, 1);
    expect(ep.success).toBe(true);
    expect(ep.job?.episodes.find((e) => e.epNum === 1)?.status).toBe("downloading");

    const all = retryBatchJob(job.id);
    expect(all.success).toBe(true);
    expect(all.job?.status).toBe("downloading");
  });

  it("returns 404-style errors for unknown jobs/episodes", () => {
    expect(retryBatchJob("batch_doesnotexist").success).toBe(false);
    const job = createBatchJob({ animeTitle: "X", season: "S1", totalEpisodes: 1 });
    job.simulated = true;
    expect(retryEpisode(job.id, 99).success).toBe(false);
  });
});

describe("B1: watch-subscription backup sanitizer", () => {
  it("keeps valid entries and rebuilds safe defaults", () => {
    const clean = sanitizeWatchSubscriptions([
      { chatJid: "c@g.us", title: "Sparks of Tomorrow", seasonUrl: "https://voir-anime.to/anime/s-vf/", lang: "VF", lastSeenEp: 9, createdAt: 1000, consecutiveErrors: 42 },
      { chatJid: "c@g.us", title: "No URL", seasonUrl: "not-a-url" },           // dropped
      { chatJid: "", title: "No chat", seasonUrl: "https://x/y" },             // dropped
      "garbage"                                                                 // dropped
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0]!.lastSeenEp).toBe(9);
    expect(clean[0]!.consecutiveErrors).toBe(0); // clean slate after restore
    expect(clean[0]!.id).toBeTruthy();
  });

  it("bounds the payload to the global cap and clamps numbers", () => {
    const flood = Array.from({ length: WATCH_MAX_GLOBAL + 50 }, (_, i) => ({
      chatJid: `c${i}@g.us`,
      title: `T${i}`,
      seasonUrl: "https://voir-anime.to/anime/x-vf/",
      lastSeenEp: -5
    }));
    const clean = sanitizeWatchSubscriptions(flood);
    expect(clean).toHaveLength(WATCH_MAX_GLOBAL);
    expect(clean.every((s) => s.lastSeenEp >= 0)).toBe(true);
  });

  it("returns [] for non-array payloads", () => {
    expect(sanitizeWatchSubscriptions(null)).toEqual([]);
    expect(sanitizeWatchSubscriptions({} as any)).toEqual([]);
  });
});
