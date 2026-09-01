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
