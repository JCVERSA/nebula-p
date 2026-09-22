import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * 8.69 (refonte sources choisies) — session wiring per chosen catalog with
 * STRUCTURAL languages. Replaces the 8.17 wireVoiranimeVfSeasons tests: the
 * VF truth now comes from the catalog structure itself (sub-paths / slugs),
 * not from a cross-catalog probe.
 */

vi.mock("../src/bot/services/voiranimeClient.js", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, voiranimeSearch: vi.fn(), voiranimeEpisodes: vi.fn() };
});

import { foldTitleDiacritics, seasonScreenLanguageHint } from "../src/bot/commands/novabox.js";

/** seasonScreenLanguageHint (audit 8.17) — unchanged behavior. */
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

describe("wireSessionSeasons — as catalog (structural sub-path languages, 8.69)", () => {
  let axiosGetMock: ReturnType<typeof vi.fn>;
  let wireSessionSeasons: any;

  const CATALOG_URL = "https://anime-sama.to/catalogue/vinland-saga/";
  const HTML_BOTH_LANGS = `<html><script>
    panneauAnime("Saison 1", "saison1/vostfr");
    panneauAnime("Saison 1", "saison1/vf");
    panneauAnime("Saison 2", "saison2/vostfr");
  </script></html>`;
  const HTML_VOSTFR_ONLY = `<html><script>
    panneauAnime("Saison 1", "saison1/vostfr");
  </script></html>`;

  const baseSession = (): any => ({
    source: "as" as const,
    searchResults: [{ title: "Vinland Saga", subtitle: "VOSTFR/VF", url: CATALOG_URL }],
    animeTitle: "Vinland Saga",
    animeUrl: CATALOG_URL,
    languages: [] as string[],
    seasons: [] as Array<Record<string, unknown>>
  });

  beforeEach(async () => {
    axiosGetMock = vi.fn();
    vi.resetModules();
    vi.doMock("axios", () => ({ default: { post: vi.fn(), get: axiosGetMock } }));
    // SSRF guard: keep the wiring test offline (no DNS for the fake catalog URL)
    vi.doMock("../src/bot/urlSafety.js", async (importOriginal) => {
      const orig = await importOriginal<Record<string, unknown>>();
      return { ...orig, isSafeDownloadUrl: vi.fn(async () => true) };
    });
    const mod = await import("../src/bot/commands/novabox.js");
    wireSessionSeasons = (mod as Record<string, unknown>).wireSessionSeasons;
  });
  afterEach(() => {
    vi.doUnmock("axios");
    vi.doUnmock("../src/bot/urlSafety.js");
  });

  it("VF default: wires ONLY the vf sub-path seasons, keeps all langs in sourceSeasons", async () => {
    axiosGetMock.mockResolvedValue({ data: HTML_BOTH_LANGS });
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Vinland Saga", url: CATALOG_URL }, "VF");

    expect(r.status).toBe("ok");
    expect(r.language).toBe("VF");
    expect(session.seasons).toHaveLength(1);
    expect(session.seasons[0].subPath).toBe("saison1/vf");
    expect(session.selectedLanguage).toBe("VF");
    expect(session.languages).toEqual(["VF", "VOSTFR"]);
    expect(session.sourceSeasons).toHaveLength(3); // both languages stored for `.a vostfr`
    expect(axiosGetMock).toHaveBeenCalledTimes(1); // one catalog fetch, no HEAD guessing
  });

  it("no VF on the catalog: VOSTFR seasons are LISTED with the honest header", async () => {
    axiosGetMock.mockResolvedValue({ data: HTML_VOSTFR_ONLY });
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Vinland Saga", url: CATALOG_URL }, "VF");

    expect(r.status).toBe("ok");
    expect(r.language).toBe("VOSTFR");
    expect(r.header).toContain("Aucune VF");
    expect(r.guideHint).toContain("`.a va <titre>`");
    expect(session.seasons).toHaveLength(1);
    expect(session.seasons[0].subPath).toBe("saison1/vostfr");
  });

  it("VOSTFR requested with no VOSTFR seasons: honest failure + other-flag guide", async () => {
    axiosGetMock.mockResolvedValue({ data: `<html><script>panneauAnime("Saison 1", "saison1/vf");</script></html>` });
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Vinland Saga", url: CATALOG_URL }, "VOSTFR");

    expect(r.status).toBe("missing");
    expect(r.message).toContain("Aucun VOSTFR");
    expect(r.message).toContain("`.a va <titre> vostfr`");
  });

  it("empty catalog page: honest failure", async () => {
    axiosGetMock.mockResolvedValue({ data: "<html>nothing</html>" });
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Vinland Saga", url: CATALOG_URL }, "VF");

    expect(r.status).toBe("missing");
    expect(r.message).toContain("Aucune saison");
  });
});

describe("wireSessionSeasons — va catalog (structural slug languages, 8.69)", () => {
  let axiosGetMock: ReturnType<typeof vi.fn>;
  let wireSessionSeasons: any;

  const VA_ENTRIES = [
    { title: "Solo Leveling VF", subtitle: "VF", url: "https://voir-anime.to/anime/solo-leveling-vf/", slug: "solo-leveling-vf", language: "VF" as const },
    { title: "Solo Leveling VOSTFR", subtitle: "VOSTFR", url: "https://voir-anime.to/anime/solo-leveling-vostfr/", slug: "solo-leveling-vostfr", language: "VOSTFR" as const }
  ];

  const baseSession = (): any => ({
    source: "va" as const,
    searchResults: VA_ENTRIES,
    animeTitle: "Solo Leveling",
    animeUrl: VA_ENTRIES[0].url,
    languages: [] as string[],
    seasons: [] as Array<Record<string, unknown>>
  });

  beforeEach(async () => {
    axiosGetMock = vi.fn();
    vi.resetModules();
    vi.doMock("axios", () => ({ default: { post: vi.fn(), get: axiosGetMock } }));
    const mod = await import("../src/bot/commands/novabox.js");
    wireSessionSeasons = (mod as Record<string, unknown>).wireSessionSeasons;
  });
  afterEach(() => {
    vi.doUnmock("axios");
  });

  it("VF default: wires the VF entries as seasons — NO catalog fetch (never parseSeasons on a va URL)", async () => {
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Solo Leveling", url: VA_ENTRIES[0].url }, "VF");

    expect(r.status).toBe("ok");
    expect(r.language).toBe("VF");
    expect(session.seasons).toHaveLength(1);
    expect(session.seasons[0].isVoiranime).toBe(true);
    expect(session.seasons[0].url).toContain("-vf");
    expect(session.selectedLanguage).toBe("VF");
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it("VOSTFR request on va: wires the vostfr entries when they exist", async () => {
    const session = baseSession();

    const r = await wireSessionSeasons(session, { title: "Solo Leveling", url: VA_ENTRIES[1].url }, "VOSTFR");

    expect(r.status).toBe("ok");
    expect(r.language).toBe("VOSTFR");
    expect(session.seasons[0].url).toContain("-vostfr");
  });

  it("VF request with no VF entry on va: VOSTFR listed with header + guide to as", async () => {
    const session = baseSession();
    session.searchResults = [VA_ENTRIES[1]];

    const r = await wireSessionSeasons(session, { title: "Solo Leveling", url: VA_ENTRIES[1].url }, "VF");

    expect(r.status).toBe("ok");
    expect(r.language).toBe("VOSTFR");
    expect(r.header).toContain("Aucune VF");
    expect(r.guideHint).toContain("`.a as <titre>`");
  });
});

describe("foldTitleDiacritics re-export (moved 8.69)", () => {
  it("still folds macrons to Hepburn", () => {
    expect(foldTitleDiacritics("Komyushō")).toBe("Komyushou");
  });
});
