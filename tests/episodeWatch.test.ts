import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  computeNewEpisodes,
  isQuietHour,
  formatWatchNotification,
  addSubscription,
  removeSubscriptions,
  listSubscriptions,
  loadSubscriptions,
  WATCH_MAX_PER_CHAT,
  runWatchCycle,
  type WatchSubscription
} from "../src/bot/services/episodeWatchService.js";

/**
 * Audit S4 — `.a watch` episode watcher: pure delta/quiet-hour logic, storage
 * caps + persistence, and a fully injected watch cycle (no network).
 */

// Isolated storage per suite via NEBULA_DATA_DIR (resolved on every call).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;
afterAll(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  delete process.env.NEBULA_DATA_DIR;
});

describe("computeNewEpisodes", () => {
  it("returns only episodes strictly greater than the last seen, sorted", () => {
    expect(computeNewEpisodes(9, [1, 2, 9, 10, 12, 11])).toEqual([10, 11, 12]);
  });
  it("dedupes and ignores non-positive/garbage numbers", () => {
    expect(computeNewEpisodes(0, [1, 1, 0, -3, 2, NaN as any])).toEqual([1, 2]);
  });
  it("returns [] when nothing is new", () => {
    expect(computeNewEpisodes(12, [1, 5, 12])).toEqual([]);
  });
});

describe("isQuietHour", () => {
  const at = (h: number, m = 30) => new Date(2026, 8, 1, h, m); // local hour used with fixed tz below

  it("detects midnight-crossing windows (23-7)", () => {
    expect(isQuietHour(at(23), "UTC", "23-7")).toBe(true);
    expect(isQuietHour(at(3), "UTC", "23-7")).toBe(true);
    expect(isQuietHour(at(6, 59), "UTC", "23-7")).toBe(true);
    expect(isQuietHour(at(7), "UTC", "23-7")).toBe(false);
    expect(isQuietHour(at(12), "UTC", "23-7")).toBe(false);
    expect(isQuietHour(at(22, 59), "UTC", "23-7")).toBe(false);
  });
  it("handles same-day windows", () => {
    expect(isQuietHour(at(2), "UTC", "1-5")).toBe(true);
    expect(isQuietHour(at(6), "UTC", "1-5")).toBe(false);
  });
  it("disables on 'off', zero-length and malformed ranges (fail-open)", () => {
    expect(isQuietHour(at(3), "UTC", "off")).toBe(false);
    expect(isQuietHour(at(3), "UTC", "5-5")).toBe(false);
    expect(isQuietHour(at(3), "UTC", "nonsense")).toBe(false);
  });
});

describe("formatWatchNotification", () => {
  it("includes title, episodes and the ready-made download command", () => {
    const sub: WatchSubscription = {
      id: "x", chatJid: "c@g.us", title: "Sparks of Tomorrow", seasonUrl: "https://voir-anime.to/anime/x-vf/",
      lang: "VF", lastSeenEp: 9, createdAt: 0, consecutiveErrors: 0
    };
    const text = formatWatchNotification(sub, [10, 11]);
    expect(text).toContain("Sparks of Tomorrow");
    expect(text).toContain("Ép. 10, 11");
    expect(text).toContain("`.a Sparks of Tomorrow s1 10-11 r1`");
    expect(text).toContain("unwatch");
  });
});

describe("storage: add / list / remove / caps", () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  });

  it("persists subscriptions and refreshes duplicates instead of stacking them", () => {
    const first = addSubscription({ chatJid: "c@g.us", title: "A", seasonUrl: "https://s/a-vf/", lastSeenEp: 5 });
    expect(first.ok).toBe(true);
    const again = addSubscription({ chatJid: "c@g.us", title: "A", seasonUrl: "https://s/a-vf/", lastSeenEp: 7 });
    expect(again.ok && again.updated).toBe(true);
    expect(listSubscriptions("c@g.us")).toHaveLength(1);
    expect(loadSubscriptions()[0]!.lastSeenEp).toBe(7);
  });

  it("enforces the per-chat cap", () => {
    for (let i = 0; i < WATCH_MAX_PER_CHAT; i++) {
      expect(addSubscription({ chatJid: "c@g.us", title: `A${i}`, seasonUrl: `https://s/${i}-vf/`, lastSeenEp: 1 }).ok).toBe(true);
    }
    const over = addSubscription({ chatJid: "c@g.us", title: "Extra", seasonUrl: "https://s/extra-vf/", lastSeenEp: 1 });
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/Maximum de 20/);
  });

  it("removes only the matching chat + title, keeps others", () => {
    addSubscription({ chatJid: "a@x", title: "Naruto VF", seasonUrl: "https://s/n-vf/", lastSeenEp: 3 });
    addSubscription({ chatJid: "a@x", title: "Bleu VF", seasonUrl: "https://s/b-vf/", lastSeenEp: 3 });
    addSubscription({ chatJid: "b@x", title: "Naruto VF", seasonUrl: "https://s/n-vf/", lastSeenEp: 3 });

    expect(removeSubscriptions("a@x", "naruto")).toBe(1);
    expect(listSubscriptions("a@x").map(s => s.title)).toEqual(["Bleu VF"]);
    expect(listSubscriptions("b@x")).toHaveLength(1);
  });
});

describe("runWatchCycle (injected fetch/send)", () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    sent.length = 0;
  });

  const sub = (over: Partial<WatchSubscription> = {}): WatchSubscription => ({
    id: "1", chatJid: "c@g.us", title: "Sparks of Tomorrow", seasonUrl: "https://s/vf/",
    lang: "VF", lastSeenEp: 9, createdAt: 0, consecutiveErrors: 0, ...over
  });
  const sent: Array<[string, string]> = [];
  const send = async (jid: string, text: string) => { sent.push([jid, text]); };

  it("notifies about new episodes and advances lastSeenEp", async () => {
    const s = sub();
    const summary = await runWatchCycle({
      send,
      now: new Date(2026, 8, 1, 12, 0),
      subscriptions: [s],
      fetchEpisodes: async () => [{ n: 1 }, { n: 9 }, { n: 10 }]
    });
    expect(summary.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe("c@g.us");
    expect(sent[0]![1]).toContain("Ép. 10");
    expect(s.lastSeenEp).toBe(10);
    expect(s.consecutiveErrors).toBe(0);
  });

  it("stays silent when there is nothing new", async () => {
    const s = sub({ lastSeenEp: 12 });
    const summary = await runWatchCycle({
      send, now: new Date(2026, 8, 1, 12, 0), subscriptions: [s],
      fetchEpisodes: async () => [{ n: 10 }, { n: 11 }, { n: 12 }]
    });
    expect(summary.notified).toBe(0);
    expect(sent).toHaveLength(0);
    expect(s.lastSeenEp).toBe(12);
  });

  it("counts errors without deleting the subscription", async () => {
    const s = sub();
    const summary = await runWatchCycle({
      send, now: new Date(2026, 8, 1, 12, 0), subscriptions: [s],
      fetchEpisodes: async () => { throw new Error("network down"); }
    });
    expect(summary.errors).toBe(1);
    expect(s.consecutiveErrors).toBe(1);
    expect(s.lastSeenEp).toBe(9); // unchanged -> retry next cycle
  });

  it("skips (without consuming) subscriptions during quiet hours", async () => {
    const s = sub();
    const fetch = vi.fn(async () => [{ n: 10 }]);
    const summary = await runWatchCycle({
      send, now: new Date(2026, 8, 1, 3, 0), subscriptions: [s], fetchEpisodes: fetch,
      quietRange: "23-7", tz: "UTC"
    });
    expect(summary.skippedQuiet).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(s.lastSeenEp).toBe(9); // notification deferred, not lost
  });
});
