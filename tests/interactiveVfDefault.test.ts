import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/bot/services/voiranimeClient.js", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, voiranimeSearch: vi.fn(), voiranimeEpisodes: vi.fn() };
});

import { voiranimeSearch } from "../src/bot/services/voiranimeClient.js";
import { seasonScreenLanguageHint, wireVoiranimeVfSeasons } from "../src/bot/commands/novabox.js";

const mockedSearch = vi.mocked(voiranimeSearch);

/**
 * Audit 8.17 — the INTERACTIVE flow must default to VF (voiranime source)
 * exactly like the quick pipeline, and the season-screen hint must always
 * offer the OPPOSITE language (the old screen said "switch to VOSTFR" while
 * VOSTFR was already the default) or honestly say VF does not exist.
 */
describe("seasonScreenLanguageHint (audit 8.17)", () => {
  it("VF default offers the VOSTFR switch", () => {
    const hint = seasonScreenLanguageHint("VF", true);
    expect(hint).toContain("`.a vostfr`");
    expect(hint).not.toContain("non disponible");
  });

  it("VOSTFR default with VF available offers the VF switch", () => {
    const hint = seasonScreenLanguageHint("VOSTFR", true);
    expect(hint).toContain("`.a vf`");
    expect(hint).not.toContain("non disponible");
  });

  it("VOSTFR default without VF honestly says VF is unavailable", () => {
    const hint = seasonScreenLanguageHint("VOSTFR", false);
    expect(hint).toContain("VF non disponible");
    expect(hint).not.toContain("`.a vf`");
    expect(hint).not.toContain("`.a vostfr`");
  });
});

describe("wireVoiranimeVfSeasons (audit 8.17)", () => {
  const baseSession: any = () => ({
    animeTitle: "Tomb Raider King",
    animeUrl: "https://nakanime.to/anime/tomb-raider-king/",
    languages: ["VOSTFR"],
    selectedLanguage: "VOSTFR",
    seasons: [{ name: "Saison 1", subPath: "s1/vostfr", url: "https://nakanime.to/anime/tomb-raider-king/vostfr/s1/" }]
  });

  beforeEach(() => {
    mockedSearch.mockReset();
    delete process.env.NEBULA_VOIRANIME_DISABLED;
  });
  afterEach(() => {
    delete process.env.NEBULA_VOIRANIME_DISABLED;
  });

  it("wires the session to voiranime VF seasons (VF default) and keeps the nakanime URL", async () => {
    mockedSearch.mockResolvedValue([
      { title: "Tomb Raider King", url: "https://voir-anime.to/anime/tomb-raider-king-vostfr/", isVf: false },
      { title: "Tomb Raider King VF", url: "https://voir-anime.to/anime/tomb-raider-king-vf/", isVf: true },
      { title: "Tomb Raider King Saison 2 VF", url: "https://voir-anime.to/anime/tomb-raider-king-saison-2-vf/", isVf: true }
    ] as any);

    const session = baseSession();
    const wired = await wireVoiranimeVfSeasons(session, "Tomb Raider King");

    expect(wired).toBe(true);
    expect(session.seasons).toHaveLength(2); // VOSTFR entry excluded
    expect(session.seasons.every((s: any) => s.isVoiranime === true)).toBe(true);
    expect(session.selectedLanguage).toBe("VF");
    expect(session.languages).toEqual(["VF", "VOSTFR"]);
    expect(session.voiranimeAnimeUrl).toBe("https://voir-anime.to/anime/tomb-raider-king-vf/");
    expect(session.animeUrl).toBe("https://nakanime.to/anime/tomb-raider-king/"); // untouched for `.a vostfr` rebuild
  });

  it("returns false (session untouched) when voiranime has no VF entry", async () => {
    mockedSearch.mockResolvedValue([
      { title: "X", url: "https://voir-anime.to/anime/x-vostfr/", isVf: false }
    ] as any);

    const session = baseSession();
    const before = JSON.stringify(session);
    expect(await wireVoiranimeVfSeasons(session, "X")).toBe(false);
    expect(JSON.stringify(session)).toBe(before);
  });

  it("returns false when the voiranime probe throws", async () => {
    mockedSearch.mockRejectedValue(new Error("boom"));
    const session = baseSession();
    expect(await wireVoiranimeVfSeasons(session, "X")).toBe(false);
    expect(session.selectedLanguage).toBe("VOSTFR");
  });

  it("is a no-op when voiranime is disabled via env", async () => {
    process.env.NEBULA_VOIRANIME_DISABLED = "1";
    const session = baseSession();
    expect(await wireVoiranimeVfSeasons(session, "X")).toBe(false);
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});

/**
 * Audit 8.54 — production evidence `.a hana-kimi`: voir-anime.to lists its
 * entries in SEARCH-RELEVANCE order, so "Hana-Kimi 2" was offered as s1 of
 * "Hana-Kimi" (typing `.a s1` would have downloaded season 2!). Entries must
 * be sorted by their real season number. Also: a transient Cloudflare
 * challenge on the probe silently demoted sessions to VOSTFR even though the
 * VF entry existed — the probe now retries once.
 */
describe("wireVoiranimeVfSeasons (audit 8.54: season order + retry)", () => {
  const newSession: any = () => ({
    animeTitle: "Hana-Kimi",
    animeUrl: "https://nakanime.tv/anime/37/hana-kimi",
    languages: ["VOSTFR"],
    selectedLanguage: "VOSTFR",
    seasons: [{ name: "Saison 1", subPath: "s1/vostfr", url: "https://nakanime.tv/anime/37/hana-kimi/vostfr/s1/" }]
  });

  beforeEach(() => {
    mockedSearch.mockReset();
    delete process.env.NEBULA_VOIRANIME_DISABLED;
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEBULA_VOIRANIME_DISABLED;
  });

  it("sorts VF entries by real season number (Hana-Kimi 2 listed after Hana-Kimi)", async () => {
    mockedSearch.mockResolvedValue([
      { title: "Hana-Kimi 2", url: "https://voir-anime.to/anime/hana-kimi-2-vf/", slug: "hana-kimi-2-vf", isVf: true },
      { title: "Hana-Kimi", url: "https://voir-anime.to/anime/hana-kimi-vf/", slug: "hana-kimi-vf", isVf: true }
    ]);
    const session = newSession();
    const wired = await wireVoiranimeVfSeasons(session, "Hana-Kimi");
    expect(wired).toBe(true);
    expect(session.seasons.map((s: any) => s.name)).toEqual(["Hana-Kimi", "Hana-Kimi 2"]);
    expect(session.voiranimeAnimeUrl).toContain("hana-kimi-vf"); // season 1 entry first
  });

  it("sorts explicit 'Saison N' markers too", async () => {
    mockedSearch.mockResolvedValue([
      { title: "Truc Saison 3", url: "https://voir-anime.to/anime/truc-saison-3-vf/", slug: "truc-saison-3-vf", isVf: true },
      { title: "Truc Saison 1", url: "https://voir-anime.to/anime/truc-saison-1-vf/", slug: "truc-saison-1-vf", isVf: true },
      { title: "Truc Saison 2", url: "https://voir-anime.to/anime/truc-saison-2-vf/", slug: "truc-saison-2-vf", isVf: true }
    ]);
    const session = newSession();
    await wireVoiranimeVfSeasons(session, "Truc");
    expect(session.seasons.map((s: any) => s.name)).toEqual(["Truc Saison 1", "Truc Saison 2", "Truc Saison 3"]);
  });

  it("retries once on a transient probe failure and still wires VF", async () => {
    mockedSearch
      .mockRejectedValueOnce(Object.assign(new Error("cf challenge"), { response: { status: 503 } }))
      .mockResolvedValue([
        { title: "Hana-Kimi", url: "https://voir-anime.to/anime/hana-kimi-vf/", slug: "hana-kimi-vf", isVf: true }
      ]);
    vi.useFakeTimers();
    const session = newSession();
    const pending = wireVoiranimeVfSeasons(session, "Hana-Kimi");
    await vi.advanceTimersByTimeAsync(1600); // let the 1.5 s back-off elapse
    const wired = await pending;
    expect(wired).toBe(true);
    expect(session.selectedLanguage).toBe("VF");
  });

  it("gives up after two failures and falls back to the catalogue path", async () => {
    mockedSearch.mockRejectedValue(Object.assign(new Error("blocked"), { response: { status: 403 } }));
    vi.useFakeTimers();
    const session = newSession();
    const pending = wireVoiranimeVfSeasons(session, "Hana-Kimi");
    await vi.advanceTimersByTimeAsync(1600);
    const wired = await pending;
    expect(wired).toBe(false);
    expect(session.selectedLanguage).toBe("VOSTFR"); // untouched
  });
});
