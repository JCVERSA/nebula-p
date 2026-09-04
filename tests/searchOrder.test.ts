import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

/**
 * Audit 8.53 — source order. Production evidence: every `.a` search logged
 * "anime-sama search failed (403)" before falling back to nakanime —
 * anime-sama is chronically Cloudflare-blocked from the VPS IP range, so it
 * must be the LAST resort, not the first. voiranime stays out of the SEARCH
 * chain (search results feed parseSeasons catalog pages) but is probed FIRST
 * at selection time as the VF-by-default source (its wiring is covered by
 * tests/interactiveVfDefault.test.ts).
 */

vi.mock("../src/bot/services/nakanimeClient.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/bot/services/nakanimeClient.js")>();
  return { ...orig, nakanimeSearch: vi.fn() };
});

const SAMA_HTML = `
  <a class="asn-search-result" href="https://anime-sama.to/catalogue/vinland-saga/">
    <div class="asn-search-result-title">Vinland Saga</div>
    <div class="asn-search-result-subtitle">VOSTFR/VF</div>
  </a>`;

let axiosPostMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  axiosPostMock = vi.fn();
  // Fresh module registry per test: novabox.js must re-import axios against
  // THIS test's mock (a cached module would keep the previous mock instance).
  vi.resetModules();
  vi.doMock("axios", () => ({ default: { post: axiosPostMock, get: vi.fn() } }));
});

afterEach(() => {
  vi.doUnmock("axios");
});

async function loadSearchAnime() {
  const mod = await import("../src/bot/commands/novabox.js");
  return mod.searchAnime;
}

async function loadNakanimeSearch() {
  const mod = await import("../src/bot/services/nakanimeClient.js");
  return mod.nakanimeSearch as any;
}

describe("searchAnime source order (8.53)", () => {
  it("searches nakanime FIRST and does not touch anime-sama when it has results", async () => {
    const nakanimeSearch = await loadNakanimeSearch();
    nakanimeSearch.mockResolvedValue([
      { title: "Vinland Saga", url: "https://nakanime.tv/anime/12/vinland-saga" }
    ]);
    const searchAnime = await loadSearchAnime();

    const results = await searchAnime("vinland");

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Vinland Saga");
    expect(nakanimeSearch).toHaveBeenCalledWith("vinland");
    expect(axiosPostMock).not.toHaveBeenCalled(); // anime-sama never contacted
  });

  it("falls back to anime-sama (last resort) when nakanime returns nothing", async () => {
    const nakanimeSearch = await loadNakanimeSearch();
    nakanimeSearch.mockResolvedValue([]);
    axiosPostMock.mockResolvedValue({ data: SAMA_HTML });
    const searchAnime = await loadSearchAnime();

    const results = await searchAnime("vinland");

    expect(results).toHaveLength(1);
    expect(results[0].url).toContain("anime-sama.to");
    expect(nakanimeSearch).toHaveBeenCalled();
    expect(axiosPostMock).toHaveBeenCalledTimes(1); // sama tried exactly once
  });

  it("falls back to anime-sama when nakanime throws (network/parse)", async () => {
    const nakanimeSearch = await loadNakanimeSearch();
    nakanimeSearch.mockRejectedValue(Object.assign(new Error("blocked"), { response: { status: 403 } }));
    axiosPostMock.mockResolvedValue({ data: SAMA_HTML });
    const searchAnime = await loadSearchAnime();

    const results = await searchAnime("vinland");
    expect(results).toHaveLength(1);
  });

  it("rejects when BOTH sources fail (no silent empty result)", async () => {
    const nakanimeSearch = await loadNakanimeSearch();
    nakanimeSearch.mockRejectedValue(new Error("net down"));
    axiosPostMock.mockRejectedValue(Object.assign(new Error("cf 403"), { response: { status: 403 } }));
    const searchAnime = await loadSearchAnime();

    await expect(searchAnime("vinland")).rejects.toThrow();
  });
});

describe("source order wiring (the 8.49b lesson: pin the wiring, not just the units)", () => {
  it("the selection handler probes voiranime BEFORE parsing the catalog seasons", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    const handler = source.slice(source.indexOf("const chosen = results[choiceIndex];"));
    const wirePos = handler.indexOf("await wireVoiranimeVfSeasons(session, chosen.title");
    const parsePos = handler.indexOf("await parseSeasons(chosen.url)");
    expect(wirePos).toBeGreaterThanOrEqual(0);
    expect(parsePos).toBeGreaterThan(wirePos);
  });

  it("searchAnime tries nakanimeSearch before searchAnimeSama", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    const fn = source.slice(source.indexOf("export async function searchAnime"));
    expect(fn.indexOf("nakanimeSearch")).toBeLessThan(fn.indexOf("searchAnimeSama"));
  });

  it("NEBULA_ANIME_PROXY is documented in .env.example (Cloudflare escape hatch)", () => {
    const env = fs.readFileSync(".env.example", "utf8");
    expect(env).toContain("NEBULA_ANIME_PROXY");
  });
});
