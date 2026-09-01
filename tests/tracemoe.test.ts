import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimestamp,
  formatEpisode,
  formatTraceCard,
  pickBestTrace,
  searchByImageBuffer,
  searchByImageUrl,
  type TraceMoeResult
} from "../src/bot/services/tracemoeClient.js";

/**
 * Audit 8.22 — `.trace` command via trace.moe (no key): screenshot → anime,
 * episode, timecode, download hint. Best-effort contract (failures → null /
 * error message, never a crash), anonymous rate-limit friendly.
 */

const fakeResult = (over: Partial<any> = {}): any => ({
  anilist: {
    id: 113415,
    idMal: 40734,
    title: { english: "Tomb Raider King", romaji: "Tomb Raider King", native: "トゥームレイダーキング" },
    isAdult: false
  },
  episode: 7,
  from: 871.33,
  similarity: 0.9132456,
  image: "https://trace.moe/thumbs/113415/7/871.33.jpg",
  video: "https://trace.moe/video/113415/7/871.33.mp4",
  ...over
});

describe("formatTimestamp", () => {
  it("formats minutes:seconds and pads seconds", () => {
    expect(formatTimestamp(95.3)).toBe("1:35");
    expect(formatTimestamp(5)).toBe("0:05");
  });
  it("formats hours when >= 1h", () => {
    expect(formatTimestamp(3675)).toBe("1:01:15");
  });
  it("degrades to --:-- on missing/invalid input", () => {
    expect(formatTimestamp(undefined)).toBe("--:--");
    expect(formatTimestamp(-3)).toBe("--:--");
    expect(formatTimestamp(NaN)).toBe("--:--");
  });
});

describe("formatEpisode", () => {
  it("handles single episodes, movies and multi-episode ranges", () => {
    expect(formatEpisode(7)).toBe("Ép. 7");
    expect(formatEpisode(null)).toBe("Film");
    expect(formatEpisode(0)).toBe("Film");
    expect(formatEpisode([3])).toBe("Ép. 3");
    expect(formatEpisode([3, 4, 5])).toBe("Ép. 3-5");
    expect(formatEpisode([])).toBe("Film");
  });
});

describe("pickBestTrace", () => {
  it("returns null on empty and the highest similarity otherwise", () => {
    expect(pickBestTrace([])).toBeNull();
    const a: TraceMoeResult = { similarity: 0.6 };
    const b: TraceMoeResult = { similarity: 0.92 };
    expect(pickBestTrace([a, b])?.similarity).toBe(0.92);
  });
});

describe("formatTraceCard", () => {
  it("renders title, episode, timecode, similarity %, .a hint and AniList link", () => {
    const card = formatTraceCard({
      anilistId: 113415,
      titleEnglish: "Tomb Raider King",
      titleRomaji: "Tomb Raider King",
      titleNative: "トゥームレイダーキング",
      episode: 7,
      fromSeconds: 871.33,
      similarity: 0.9132456
    });
    expect(card).toContain("🎬 *Tomb Raider King*");
    expect(card).toContain("📺 Ép. 7");
    expect(card).toContain("⏱️ 14:31");
    expect(card).toContain("🎯 91.3 %");
    expect(card).toContain("`.a Tomb Raider King`");
    expect(card).toContain("https://anilist.co/anime/113415");
    expect(card).toContain("trace.moe");
  });

  it("falls back to romaji title and flags adult content", () => {
    const card = formatTraceCard({ titleRomaji: "Yosuga no Sora", similarity: 0.5, isAdult: true });
    expect(card).toContain("🎬 *Yosuga no Sora*");
    expect(card).toContain("Contenu adulte");
  });
});

describe("trace.moe client (fetch mocked)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs raw image bytes with anilistInfo and maps the payload", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [fakeResult()] }) });

    const outcome = await searchByImageBuffer(Buffer.from("jpegbytes"));

    expect(outcome.ok).toBe(true);
    expect(outcome.results[0]!.titleEnglish).toBe("Tomb Raider King");
    expect(outcome.results[0]!.anilistId).toBe(113415);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://api.trace.moe/search?anilistInfo=1");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
    expect(init.headers["X-Trace-TTL"]).toBe("3600");
  });

  it("rejects empty and oversized buffers without any network call", async () => {
    expect((await searchByImageBuffer(Buffer.alloc(0))).ok).toBe(false);
    const big = (await searchByImageBuffer(Buffer.alloc(11 * 1024 * 1024))).ok;
    expect(big).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes image URLs as a query parameter", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [] }) });
    await searchByImageUrl("https://cdn.example.com/pic.jpg?a=1&b=é");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("url=https%3A%2F%2Fcdn.example.com%2Fpic.jpg%3Fa%3D1%26b%3D%C3%A9");
  });

  it("rejects non-http inputs", async () => {
    expect((await searchByImageUrl("javascript:alert(1)")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces 429 as a friendly rate-limit error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    const outcome = await searchByImageBuffer(Buffer.from("x"));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/Trop de recherches/);
  });

  it("returns a service error on network failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const outcome = await searchByImageBuffer(Buffer.from("x"));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("trace.moe");
  });
});
