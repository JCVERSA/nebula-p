import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

/**
 * 8.69 (refonte sources choisies) — search routing. ONE catalog per query,
 * chosen by the user: `as` (default, fetch.php) or `va` (WP search). There
 * is NO fallback and nakanime is dormant: an empty result is the answer.
 */

vi.mock("../src/bot/services/nakanimeClient.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/bot/services/nakanimeClient.js")>();
  return { ...orig, nakanimeSearch: vi.fn() };
});

vi.mock("../src/bot/services/voiranimeClient.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/bot/services/voiranimeClient.js")>();
  return { ...orig, voiranimeSearch: vi.fn() };
});

const SAMA_HTML = `
  <a class="asn-search-result" href="https://anime-sama.to/catalogue/vinland-saga/">
    <div class="asn-search-result-title">Vinland Saga</div>
    <div class="asn-search-result-subtitle">VOSTFR/VF</div>
  </a>`;

let axiosPostMock: ReturnType<typeof vi.fn>;
let axiosGetMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  axiosPostMock = vi.fn();
  axiosGetMock = vi.fn();
  // Fresh module registry per test: novabox.js must re-import axios against
  // THIS test's mock (a cached module would keep the previous mock instance).
  vi.resetModules();
  vi.doMock("axios", () => ({ default: { post: axiosPostMock, get: axiosGetMock } }));
});

afterEach(() => {
  vi.doUnmock("axios");
});

async function loadNovabox() {
  return await import("../src/bot/commands/novabox.js");
}

async function loadFn<T>(path: string, name: string): Promise<T> {
  const mod = await import(/* @vite-ignore */ path);
  return (mod as Record<string, unknown>)[name] as T;
}

describe("searchAnime source routing (8.69)", () => {
  it("default (no flag) searches the as catalog and touches nothing else", async () => {
    axiosPostMock.mockResolvedValue({ data: SAMA_HTML });
    const nakanimeSearch0 = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/nakanimeClient.js", "nakanimeSearch");
    const voiranimeSearch0 = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/voiranimeClient.js", "voiranimeSearch");
    nakanimeSearch0.mockClear();
    voiranimeSearch0.mockClear();
    const { searchAnime } = await loadNovabox();

    const results = await searchAnime("vinland");

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Vinland Saga");
    expect(results[0].url).toContain("anime-sama.to");
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    const nakanimeSearch = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/nakanimeClient.js", "nakanimeSearch");
    const voiranimeSearch = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/voiranimeClient.js", "voiranimeSearch");
    expect(nakanimeSearch).not.toHaveBeenCalled();
    expect(voiranimeSearch).not.toHaveBeenCalled();
  });

  it("`va` searches the va catalog (VF-first) and never touches fetch.php", async () => {
    const voiranimeSearch = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/voiranimeClient.js", "voiranimeSearch");
    voiranimeSearch.mockResolvedValue([
      { title: "Solo Leveling VOSTFR", url: "https://voir-anime.to/anime/solo-leveling-vostfr/", slug: "solo-leveling-vostfr", isVf: false },
      { title: "Solo Leveling VF", url: "https://voir-anime.to/anime/solo-leveling-vf/", slug: "solo-leveling-vf", isVf: true }
    ]);
    const { searchAnime } = await loadNovabox();

    const results = await searchAnime("solo leveling", "va");

    expect(results).toHaveLength(2);
    expect(results[0].language).toBe("VF"); // VF-first ordering
    expect(results[0].url).toContain("-vf");
    expect(results[1].language).toBe("VOSTFR");
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("no fallback: an EMPTY result is the answer (no second catalog tried)", async () => {
    axiosPostMock.mockResolvedValue({ data: "<html>no results</html>" });
    const nakanimeSearch = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/nakanimeClient.js", "nakanimeSearch");
    const voiranimeSearch = await loadFn<ReturnType<typeof vi.fn>>("../src/bot/services/voiranimeClient.js", "voiranimeSearch");
    nakanimeSearch.mockClear();
    voiranimeSearch.mockClear();
    const { searchAnime } = await loadNovabox();

    const results = await searchAnime("zzz");

    expect(results).toEqual([]);
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    expect(nakanimeSearch).not.toHaveBeenCalled();
    expect(voiranimeSearch).not.toHaveBeenCalled();
  });

  it("rejects when the chosen catalog fails (network/403) — no silent rescue", async () => {
    axiosPostMock.mockRejectedValue(Object.assign(new Error("cf 403"), { response: { status: 403 } }));
    const { searchAnime } = await loadNovabox();

    await expect(searchAnime("vinland")).rejects.toThrow();
  });
});

describe("source routing wiring pins (the 8.49b lesson: pin the wiring, not just the units)", () => {
  it("novabox never calls nakanimeSearch (dormant mirror since 8.69)", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    expect(source).not.toMatch(/nakanimeSearch\s*\(/);
  });

  it("the language switch re-filters sourceSeasons locally (no parseSeasons rebuild)", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    const switchPos = source.indexOf("Handle language switch");
    const seg = source.slice(switchPos, switchPos + 2000);
    expect(seg).toContain("applyPolicyToSession(session, langChoice)");
    expect(seg).not.toContain("await parseSeasons(");
  });

  it("NEBULA_ANIME_PROXY is documented in .env.example (Cloudflare escape hatch)", () => {
    const env = fs.readFileSync(".env.example", "utf8");
    expect(env).toContain("NEBULA_ANIME_PROXY");
  });

  it("NEBULA_VOSTFR_FALLBACK is gone everywhere (mono-source strict)", () => {
    expect(fs.readFileSync(".env.example", "utf8")).not.toContain("NEBULA_VOSTFR_FALLBACK");
    expect(fs.readFileSync("src/bot/commands/novabox.ts", "utf8")).not.toContain("NEBULA_VOSTFR_FALLBACK");
  });

  // 8.70 — field-report UX pins (owner's first .a test, 2026-09-21)
  it("the season screen never stacks the policy header AND the switch hint (8.70)", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    // def + exactly 2 call sites (both screens)
    expect(source.split("seasonScreenLanguageHint(").length - 1).toBe(3);
    // both call sites are the hint arm of a ternary whose other arm is the header
    expect((source.match(/\? wired\.header \+ /g) || []).length).toBe(2);
    // the old stacked label ("langue demandee absente" suffix) is gone
    expect(source).not.toContain("langue demand\u00e9e absente)_");
  });

  it("a lone catalog flag answers with help, not a literal search (8.70)", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    const guard = source.indexOf('["as", "va"].includes((args[0] || "").toLowerCase()');
    expect(guard).toBeGreaterThan(0);
    // the guard sits BEFORE the usage screen and before any searchAnime call
    const usagePos = source.indexOf("// If no args and no active session, show usage");
    expect(guard).toBeLessThan(usagePos);
  });

  it("session timeout is 10 minutes with a French expiry message (8.70)", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    expect(source).toContain("10 * 60 * 1000");
    expect(source).toContain("Session expirée");
    expect(source).not.toContain("Session Expired:");
  });
});
