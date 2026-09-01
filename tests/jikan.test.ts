import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeTitle,
  pickBestMatch,
  formatAnimeCard,
  searchAnimeInfo,
  clearJikanCache,
  bestAnimeMatch,
  type JikanAnimeInfo
} from "../src/bot/services/jikanClient.js";

/**
 * Audit 8.19 — Jikan (MyAnimeList) integration: `.anime <title>` info cards
 * and the Novabox season-screen poster enrichment. The client must be
 * best-effort (failures resolve to []/null), cache responses (rate limits),
 * and match noisy bot titles ("Tomb Raider King VF Saison 1") to MAL entries.
 */

const fakeEntry = (over: Partial<any> = {}): any => ({
  mal_id: 1,
  title: "Naruto",
  title_english: "NARUTO",
  images: { jpg: { large_image_url: "https://cdn.myanimelist.net/n.jpg" } },
  score: 8.0,
  scored_by: 150000,
  episodes: 220,
  type: "TV",
  status: "Finished Airing",
  year: 2002,
  genres: [{ name: "Action" }, { name: "Adventure" }],
  synopsis: "A young ninja dreams of becoming the strongest leader of his village. ".repeat(20),
  url: "https://myanimelist.net/anime/20",
  ...over
});

describe("normalizeTitle", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeTitle("Tombeau des Lucioles! (Le)")).toBe("tombeau des lucioles le");
    expect(normalizeTitle("Éléments Étrangers")).toBe("elements etrangers");
  });

  it("drops VF/VOSTFR/season noise tokens", () => {
    expect(normalizeTitle("Tomb Raider King VF")).toBe("tomb raider king");
    expect(normalizeTitle("Tomb Raider King Saison 2")).toBe("tomb raider king");
    expect(normalizeTitle("naruto s1 vostfr")).toBe("naruto");
  });
});

describe("pickBestMatch", () => {
  const mk = (title: string, english?: string): JikanAnimeInfo =>
    ({ malId: 1, title, englishTitle: english, genres: [], posterUrl: "u", score: 7, episodes: 12 });

  it("returns null on an empty list", () => {
    expect(pickBestMatch("x", [])).toBeNull();
  });

  it("prefers the exact normalized match over MAL's first result", () => {
    const results = [mk("Naruto: Shippuuden"), mk("Tomb Raider King"), mk("Something Else")];
    expect(pickBestMatch("tomb raider king vf", results)?.title).toBe("Tomb Raider King");
  });

  it("matches on the English title too", () => {
    const results = [mk("Gintama'", "Gintama Season 2")];
    expect(pickBestMatch("Gintama Season 2", results)?.title).toBe("Gintama'");
  });

  it("falls back to MAL relevance order (first result) when nothing scores", () => {
    const results = [mk("Attack on Titan"), mk("Death Note")];
    expect(pickBestMatch("one piece", results)?.title).toBe("Attack on Titan");
  });
});

describe("formatAnimeCard", () => {
  const info: JikanAnimeInfo = {
    malId: 20,
    title: "Naruto",
    englishTitle: "NARUTO",
    posterUrl: "https://cdn.myanimelist.net/n.jpg",
    score: 8.71,
    scoredBy: 1500000,
    episodes: 220,
    type: "TV",
    status: "Finished Airing",
    year: 2002,
    genres: ["Action", "Adventure", "Shounen"],
    synopsis: "Becoming a ninja".repeat(200),
    url: "https://myanimelist.net/anime/20"
  };

  it("renders the full card with score, episodes, genres, MAL link and footer", () => {
    const card = formatAnimeCard(info, false);
    expect(card).toContain("🎬 *Naruto*");
    expect(card).toContain("⭐ 8.7/10");
    expect(card).toContain("220 ép.");
    expect(card).toContain("📅 2002");
    expect(card).toContain("Action, Adventure, Shounen");
    expect(card).toContain("https://myanimelist.net/anime/20");
    expect(card).toContain("Jikan");
  });

  it("trims the synopsis with an ellipsis", () => {
    const card = formatAnimeCard(info, false);
    expect(card).toContain("…");
    expect(card.length).toBeLessThan(1000);
  });

  it("compact variant points to .anime instead of the MAL link", () => {
    const card = formatAnimeCard(info, true);
    expect(card).toContain("`.anime Naruto`");
    expect(card).not.toContain("myanimelist.net");
  });

  it("survives sparse entries (no score, no synopsis, no genres)", () => {
    const card = formatAnimeCard({ malId: 1, title: "X", genres: [] }, false);
    expect(card).toContain("🎬 *X*");
    expect(card).not.toContain("undefined");
  });
});

describe("searchAnimeInfo (fetch mocked)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearJikanCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps MAL entries and caches identical queries (single network hit)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [fakeEntry()] }) });

    const first = await searchAnimeInfo("naruto");
    const second = await searchAnimeInfo("Naruto!");

    expect(first).toHaveLength(1);
    expect(first[0]!.title).toBe("Naruto");
    expect(first[0]!.posterUrl).toBe("https://cdn.myanimelist.net/n.jpg");
    expect(first[0]!.genres).toEqual(["Action", "Adventure"]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns [] on HTTP errors, network failures and malformed payloads", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    expect(await searchAnimeInfo("a")).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await searchAnimeInfo("b")).toEqual([]);

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) });
    expect(await searchAnimeInfo("c")).toEqual([]);
  });

  it("bestAnimeMatch returns null when the search yields nothing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    expect(await bestAnimeMatch("zzz")).toBeNull();
  });
});
