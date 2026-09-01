import { describe, it, expect } from "vitest";
import {
  parseVoiranimeSearch,
  parseVoiranimeEpisodes,
  parseVoiranimePlayer,
  resolveVoiranimeSeason,
  isVoiranimeVfSlug
} from "../src/bot/services/voiranimeClient.js";

const SEARCH_HTML = `
<div class="page-item-detail">
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/" title="Sparks of Tomorrow (VF)"><img></a>
  <h3><a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/">Sparks of Tomorrow (VF)</a></h3>
</div>
<div class="page-item-detail">
  <h3><a href="https://voir-anime.to/anime/sparks-of-tomorrow/">Sparks of Tomorrow</a></h3>
</div>
<div class="page-item-detail">
  <h3><a href="https://voir-anime.to/anime/mushoku-tensei-3-vf/">Mushoku Tensei 3 (VF)</a></h3>
</div>
<nav><a href="https://voir-anime.to/anime-genre/action/" title="Action">Action</a></nav>`;

describe("parseVoiranimeSearch", () => {
  it("extracts entries, dedupes, skips genre links and flags VF structurally", () => {
    const out = parseVoiranimeSearch(SEARCH_HTML);
    expect(out.length).toBe(3);
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain("sparks-of-tomorrow-vf");
    expect(slugs).toContain("sparks-of-tomorrow");
    expect(out.find((r) => r.slug === "sparks-of-tomorrow-vf")!.isVf).toBe(true);
    expect(out.find((r) => r.slug === "sparks-of-tomorrow")!.isVf).toBe(false);
    expect(out.find((r) => r.slug === "sparks-of-tomorrow-vf")!.title).toBe("Sparks of Tomorrow");
    expect(slugs).not.toContain("anime-genre");
  });
  it("handles empty html", () => {
    expect(parseVoiranimeSearch("")).toEqual([]);
  });
});

describe("isVoiranimeVfSlug", () => {
  it("matches -vf slugs and urls", () => {
    expect(isVoiranimeVfSlug("one-piece-vf")).toBe(true);
    expect(isVoiranimeVfSlug("https://voir-anime.to/anime/one-piece-vf/")).toBe(true);
    expect(isVoiranimeVfSlug("one-piece")).toBe(false);
  });
});

const ANIME_URL = "https://voir-anime.to/anime/sparks-of-tomorrow-vf/";
const EPISODES_HTML = `
<div class="listing">
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-09-vf/">EP 09</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-01-vf/">EP 01</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-05-vf/">EP 05</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/film-vf-sparks/">FILM</a>
  <a href="https://voir-anime.to/anime/other-anime/other-01-vf/">OTHER</a>
</div>`;

describe("parseVoiranimeEpisodes", () => {
  it("lists numbered episodes of the entry in ascending order and ignores other entries", () => {
    const out = parseVoiranimeEpisodes(EPISODES_HTML, ANIME_URL);
    expect(out.map((e) => e.n)).toEqual([0, 1, 5, 9]);
    expect(out.filter((e) => e.n > 0).map((e) => e.n)).toEqual([1, 5, 9]);
    expect(out.every((e) => e.url.startsWith(ANIME_URL))).toBe(true);
  });
});

describe("parseVoiranimePlayer", () => {
  it("finds the voembed iframe", () => {
    const html = `<html><body><iframe src="https://voembed.net/embed-miu8i0n5yyms.html" allowfullscreen></iframe></body></html>`;
    expect(parseVoiranimePlayer(html)).toBe("https://voembed.net/embed-miu8i0n5yyms.html");
  });
  it("falls back to a regex match and returns null otherwise", () => {
    const html = `<script>var u="https://voembed.net/embed-abc123.html";</script>`;
    expect(parseVoiranimePlayer(html)).toBe("https://voembed.net/embed-abc123.html");
    expect(parseVoiranimePlayer("<html><body>hi</body></html>")).toBeNull();
    expect(parseVoiranimePlayer("")).toBeNull();
  });
});

describe("resolveVoiranimeSeason", () => {
  const entries = [
    { title: "Code Geass: Lelouch of the Rebellion", url: "u1", slug: "code-geass-hangyaku-no-lelouch-vf", isVf: true },
    { title: "Code Geass: Lelouch of the Rebellion R2", url: "u2", slug: "code-geass-r2-vf", isVf: true },
    { title: "Code Geass: Rozé of the Recapture", url: "u3", slug: "code-geass-roze-vf", isVf: true }
  ];
  it("matches season 2 to the R2 entry", () => {
    expect(resolveVoiranimeSeason(entries, 2)?.slug).toBe("code-geass-r2-vf");
  });
  it("falls back to the first VF entry for season 1", () => {
    expect(resolveVoiranimeSeason(entries, 1)?.slug).toBe("code-geass-hangyaku-no-lelouch-vf");
  });
  it("returns null when nothing matches a higher season", () => {
    expect(resolveVoiranimeSeason(entries, 5)).toBeNull();
    expect(resolveVoiranimeSeason([], 1)).toBeNull();
  });
});
