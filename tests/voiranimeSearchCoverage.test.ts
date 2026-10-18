/**
 * 9.18nnn — couverture réelle de la recherche voir-anime (retour terrain 18/10).
 *
 * « .a rezero » ne remontait que 2 entrées (le catalogue en a ~6) et des
 * animes existants répondaient « aucun résultat » :
 *  - on n'interrogeait pas la vraie recherche du site (formulaire Madara =
 *    ?s=…&post_type=wp-manga) mais la recherche WordPress générique, qui
 *    ne matche pas « Re:Zero » avec la requête « rezero » (les deux-points) ;
 *  - l'écran VF masquait les entrées VOSTFR sans le dire ;
 *  - tout titre « Re:… » se groupait sous la base « re » (colon trop permissif).
 *
 * 9.18ooo (terrain 18/10 04:22 « ça n'a pas changé ») : la recherche trouvait
 * bien 5 entrées mais 3 (VOSTFR) restaient invisibles à l'écran VF par défaut
 * → écran MIXTE : VF d'abord, VOSTFR ensuite, tout numéroté ; slug nu du site
 * = page VOSTFR ; la sélection auto garde la préférence VF (pickVaQuickAutoChoice).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

let axiosGetMock: ReturnType<typeof vi.fn>;
let axiosPostMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  axiosGetMock = vi.fn();
  axiosPostMock = vi.fn();
  vi.resetModules();
  vi.doMock("axios", () => ({ default: { post: axiosPostMock, get: axiosGetMock } }));
  vi.doMock("../src/bot/urlSafety.js", async (importOriginal) => {
    const orig = await importOriginal<Record<string, unknown>>();
    return { ...orig, isSafeDownloadUrl: vi.fn(async () => true) };
  });
});

afterEach(() => {
  vi.doUnmock("axios");
  vi.doUnmock("../src/bot/urlSafety.js");
});

async function loadClient() {
  return await import("../src/bot/services/voiranimeClient.js");
}

const cards = (slugs: string[]) =>
  slugs
    .map(
      (s) =>
        `<div class="page-item-detail"><h3><a href="https://voir-anime.to/anime/${s}/">${s}</a></h3></div>`,
    )
    .join("\n");

const S1 = "rezero-kara-hajimeru-isekai-seikatsu-vf";
const S2 = "rezero-kara-hajimeru-isekai-seikatsu-s2-vf";
const S3 = "rezero-kara-hajimeru-isekai-seikatsu-s3-vf";

describe("9.18nnn — voiranimeSearch : union des deux modes de recherche du site", () => {
  it("fusionne le formulaire du site (post_type=wp-manga) et la recherche générique, dédupliquée", async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      if (url.includes("post_type=wp-manga")) return { status: 200, data: cards([S1, S2]) };
      return { status: 200, data: cards([S1, S3]) }; // S1 en commun, S3 en plus
    });
    const { voiranimeSearch } = await loadClient();
    const results = await voiranimeSearch("rezero");
    expect(results.map((r: { slug: string }) => r.slug)).toEqual([S1, S2, S3]);
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
    const urls = axiosGetMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u) => u.includes("post_type=wp-manga"))).toBe(true);
    expect(urls.every((u) => u.includes("s=rezero"))).toBe(true);
  });

  it("un endpoint en échec réseau, l'autre répond → on rend ses résultats", async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      if (url.includes("post_type=wp-manga")) throw new Error("timeout");
      return { status: 200, data: cards([S2]) };
    });
    const { voiranimeSearch } = await loadClient();
    const results = await voiranimeSearch("rezero");
    expect(results.map((r: { slug: string }) => r.slug)).toEqual([S2]);
  });

  it("les DEUX en échec réseau → erreur honnête (pas un faux « aucun résultat »)", async () => {
    axiosGetMock.mockRejectedValue(new Error("network down"));
    const { voiranimeSearch } = await loadClient();
    await expect(voiranimeSearch("rezero")).rejects.toThrow("network down");
  });

  it("les deux répondent mais 0 entrée → liste vide (vraie absence)", async () => {
    axiosGetMock.mockResolvedValue({ status: 200, data: "<html>rien</html>" });
    const { voiranimeSearch } = await loadClient();
    const results = await voiranimeSearch("zzzzz");
    expect(results).toEqual([]);
  });
});

describe("9.18nnn — parseVoiranimeSearch : liens relatifs acceptés", () => {
  it("un href /anime/<slug>/ (sans domaine) est extrait comme les absolus", async () => {
    const { parseVoiranimeSearch } = await loadClient();
    const out = parseVoiranimeSearch(
      `<h3><a href="/anime/${S1}/">Re:Zero kara Hajimeru Isekai Seikatsu</a></h3>`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe(S1);
    expect(out[0].url).toBe(`https://voir-anime.to/anime/${S1}/`);
  });
});

describe("9.18nnn — organizeVfSelection : « Re:… » ne se coupe plus sur les deux-points", () => {
  it("les saisons d'un même « Re:Zero » se groupent, le Re-Edit est un groupe à part", async () => {
    const { organizeVfSelection } = await loadClient();
    const entries = [
      { title: "Re:Zero kara Hajimeru Isekai Seikatsu", url: "u1", slug: S1, isVf: true },
      { title: "Re:Zero kara Hajimeru Isekai Seikatsu S2", url: "u2", slug: S2, isVf: true },
      { title: "Re:ZERO -Starting Life in Another World- (Re-Edit)", url: "u3", slug: "rezero-re-edit-vf", isVf: true },
    ];
    const out = organizeVfSelection(entries);
    const base = (slug: string) => out.find((o) => o.result.slug === slug)!.baseTitle;
    expect(base(S1)).toBe(base(S2)); // même anime, même base
    expect(base("rezero-re-edit-vf")).not.toBe(base(S1)); // œuvre distincte
    expect(out.find((o) => o.result.slug === S1)!.label).toContain("Saison 1");
    expect(out.find((o) => o.result.slug === S2)!.label).toContain("Saison 2");
  });
});

describe("9.18ooo — organizeVfScreen : écran mixte, rien de trouvé n'est masqué", () => {
  it("2 VF + 2 VOSTFR → les 4 entrées, VF d'abord, étiquettes bilingues, note d'orientation", async () => {
    const { organizeVfScreen } = await import("../src/bot/commands/novabox.js");
    const mixed = [
      { title: "X S1", url: "https://voir-anime.to/anime/x-vf/", slug: "x-vf", isVf: true, language: "VF" },
      { title: "X S2", url: "https://voir-anime.to/anime/x-s2-vf/", slug: "x-s2-vf", isVf: true, language: "VF" },
      { title: "X S1", url: "https://voir-anime.to/anime/x/", slug: "x", isVf: false, language: "VOSTFR" },
      { title: "X S2", url: "https://voir-anime.to/anime/x-s2/", slug: "x-s2", isVf: false, language: "VOSTFR" },
    ] as never[];
    const screen = organizeVfScreen(mixed);
    expect(screen.results).toHaveLength(4); // TOUT est montré (terrain 18/10 : « ça n'a pas changé »)
    expect(screen.results.slice(0, 2).every((r: { language?: string | null }) => r.language === "VF")).toBe(true);
    expect(screen.results.slice(2).every((r: { language?: string | null }) => r.language === "VOSTFR")).toBe(true);
    const allLabels = Array.from(screen.labels!.values());
    expect(allLabels).toHaveLength(4);
    expect(allLabels.slice(0, 2).every((l: string) => l.includes("(VF)"))).toBe(true);
    expect(allLabels.slice(2).every((l: string) => l.includes("(VOSTFR)"))).toBe(true);
    expect(screen.note).toContain("2");
    expect(screen.note).toContain("VOSTFR");
  });

  it("tout VF → étiquettes sans marque de langue, pas de note (rendu 9.9 inchangé)", async () => {
    const { organizeVfScreen } = await import("../src/bot/commands/novabox.js");
    const allVf = [
      { title: "X Saison 1", url: "u1", slug: "x-vf", isVf: true, language: "VF" },
      { title: "X Saison 2", url: "u2", slug: "x-s2-vf", isVf: true, language: "VF" },
    ] as never[];
    const screen = organizeVfScreen(allVf);
    expect(screen.results).toHaveLength(2);
    expect(screen.note).toBeNull();
    expect(Array.from(screen.labels!.values()).every((l: string) => !l.includes("("))).toBe(true);
  });

  it("aucune VF → tout ce que le catalogue propose, organisé (saisons regroupées)", async () => {
    const { organizeVfScreen } = await import("../src/bot/commands/novabox.js");
    const noVf = [
      { title: "X Saison 2", url: "u2", slug: "x-2", isVf: false, language: "VOSTFR" },
      { title: "X Saison 1", url: "u1", slug: "x", isVf: false, language: "VOSTFR" },
    ] as never[];
    const screen = organizeVfScreen(noVf);
    expect(screen.results).toHaveLength(2); // rien n'est masqué
    expect(screen.results[0]).toMatchObject({ slug: "x" }); // Saison 1 avant Saison 2
    expect(screen.labels!.get(screen.results[0] as never)).toContain("Saison 1");
    expect(screen.note).toContain("Aucune entrée VF");
  });
});

describe("9.18nnn — la note vit aussi dans l'écran standard (source)", () => {
  it("les DEUX écrans (rapide et standard) rendent vfScreen?.note", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");
    const hits = src.split("vfScreen?.note").length - 1;
    expect(hits).toBeGreaterThanOrEqual(2);
  });
});

describe("9.18ppp — complétion de franchise : les saisons ratées par la recherche sont retrouvées", () => {
  const S1VF = S1; // rezero-kara-hajimeru-isekai-seikatsu-vf
  const S2VF = S2;
  const S3VF = S3;
  const S4VF = "rezero-kara-hajimeru-isekai-seikatsu-s4-vf"; // LE lien de l'owner
  const BARE = "rezero-kara-hajimeru-isekai-seikatsu"; // S1 VOSTFR (slug nu)
  const S2V = "rezero-kara-hajimeru-isekai-seikatsu-s2";
  const S3V = "rezero-kara-hajimeru-isekai-seikatsu-s3";
  const S4V = "rezero-kara-hajimeru-isekai-seikatsu-s4";
  const REEDIT_VF = "rezero-re-edit-vf";
  const REEDIT = "rezero-re-edit";

  /** Les 5 entrées du terrain 04:41 (union incomplète de la recherche du site). */
  const TERRAIN = [
    { title: "Re:Zero kara Hajimeru Isekai Seikatsu S2", url: `https://voir-anime.to/anime/${S2VF}/`, slug: S2VF, isVf: true },
    { title: "Re:ZERO -Starting Life in Another World- (Re-Edit)", url: `https://voir-anime.to/anime/${REEDIT_VF}/`, slug: REEDIT_VF, isVf: true },
    { title: "Re:Zero kara Hajimeru Isekai Seikatsu", url: `https://voir-anime.to/anime/${BARE}/`, slug: BARE, isVf: false },
    { title: "Re:Zero kara Hajimeru Isekai Seikatsu S2", url: `https://voir-anime.to/anime/${S2V}/`, slug: S2V, isVf: false },
    { title: "Re:ZERO -Starting Life in Another World- (Re-Edit)", url: `https://voir-anime.to/anime/${REEDIT}/`, slug: REEDIT, isVf: false },
  ];

  it("LE CAS TERRAIN : S1/S3/S4 VF (lien owner …-s4-vf) et S3/S4 VOSTFR retrouvées via le titre de base", async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      const s = decodeURIComponent((url.match(/[?&]s=([^&]*)/) || [])[1] || "");
      if (s.toLowerCase() === "rezero") {
        return { status: 200, data: cards([S2VF, REEDIT_VF, BARE, S2V, REEDIT]) };
      }
      // Recherche par titre de franchise (complétion) — avec du bruit.
      return { status: 200, data: cards([S1VF, S2VF, S3VF, S4VF, BARE, S2V, S3V, S4V, "one-piece-vf"]) };
    });
    const { completeVoiranimeFranchises } = await loadClient();

    const out = await completeVoiranimeFranchises(TERRAIN);

    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain(S1VF); // Saison 1 VF — invisible avant
    expect(slugs).toContain(S3VF); // Saison 3 VF — invisible avant
    expect(slugs).toContain(S4VF); // LE lien de l'owner
    expect(slugs).toContain(S3V); // VOSTFR complétées aussi
    expect(slugs).toContain(S4V);
    expect(slugs).not.toContain("one-piece-vf"); // bruit filtré (base ≠ franchise)
    expect(slugs).toHaveLength(10); // 5 terrain + 5 retrouvées, dédupliquées
  });

  it("échec réseau de la complétion → liste inchangée (jamais de régression)", async () => {
    axiosGetMock.mockRejectedValue(new Error("network down"));
    const { completeVoiranimeFranchises } = await loadClient();
    await expect(completeVoiranimeFranchises(TERRAIN)).resolves.toHaveLength(5);
  });

  it("INTÉGRATION : searchAnimeBySource(« rezero », « va ») → les 4 saisons VF avec leur langue structurelle", async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      const s = decodeURIComponent((url.match(/[?&]s=([^&]*)/) || [])[1] || "");
      if (s.toLowerCase() === "rezero") return { status: 200, data: cards([S2VF, BARE]) };
      return { status: 200, data: cards([S1VF, S2VF, S3VF, S4VF, BARE, S2V, S3V, S4V]) };
    });
    const { searchAnimeBySource } = await import("../src/bot/services/animeSources.js");

    const results = await searchAnimeBySource("rezero", "va");

    expect(results.map((r) => r.slug)).toContain(S4VF);
    expect(results.find((r) => r.slug === S4VF)!.language).toBe("VF");
    expect(results.find((r) => r.slug === S4VF)!.subtitle).toBe("VF");
    expect(results.find((r) => r.slug === BARE)!.language).toBe("VOSTFR"); // slug nu (9.18ooo)
    expect(results[0].language).toBe("VF"); // VF-first inchangé
  });
});

describe("9.18rrr — la VOSTFR vient du catalogue par défaut (voir-anime)", () => {
  it("le détour 9.9 (VOSTFR → autre catalogue) est retiré : la VOSTFR suit le défaut", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");
    expect(src).not.toContain('quickParams.language === "VOSTFR" ? "as"');
    expect(src).toContain("quickParams.source || effectiveDefaultSource()");
  });

  it("organizeVfScreen(explicitVostfr) : entrées VOSTFR organisées, SANS la note « Aucune entrée VF »", async () => {
    const { organizeVfScreen } = await import("../src/bot/commands/novabox.js");
    const vostfrOnly = [
      { title: "X Saison 2", url: "u2", slug: "x-2", isVf: false, language: "VOSTFR" },
      { title: "X Saison 1", url: "u1", slug: "x", isVf: false, language: "VOSTFR" },
    ] as never[];
    const screen = organizeVfScreen(vostfrOnly, { explicitVostfr: true });
    expect(screen.results).toHaveLength(2);
    expect(screen.results[0]).toMatchObject({ slug: "x" }); // saisons triées
    expect(screen.note).toBeNull(); // la VOSTFR était DEMANDÉE : pas de note VF
    expect(screen.labels!.get(screen.results[1] as never)).toContain("Saison 2");
    // Sans l'option (écran par défaut), la note honnête reste là.
    expect(organizeVfScreen(vostfrOnly).note).toContain("Aucune entrée VF");
  });

  it("resolveVostfrRequest : des VOSTFR sur le catalogue par défaut → results, l'autre jamais interrogé", async () => {
    const { resolveVostfrRequest } = await import("../src/bot/commands/novabox.js");
    const va = [
      { title: "X", url: "u1", slug: "x-vf", isVf: true, language: "VF" },
      { title: "X", url: "u2", slug: "x", isVf: false, language: "VOSTFR" }
    ] as never[];
    const r: any = await resolveVostfrRequest("x", va);
    expect(r.kind).toBe("results");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].language).toBe("VOSTFR");
    expect(axiosPostMock).not.toHaveBeenCalled(); // pas de coût réseau inutile
  });

  it("resolveVostfrRequest (owner : bascule AUTO) : aucune VOSTFR → l'autre catalogue est cherché et adopté", async () => {
    axiosPostMock.mockResolvedValue({
      data: `<a class="asn-search-result" href="https://anime-sama.to/catalogue/tokyo-ghoul/">
        <div class="asn-search-result-title">Tokyo Ghoul</div>
        <div class="asn-search-result-subtitle">VOSTFR/VF</div></a>`
    });
    const { resolveVostfrRequest } = await import("../src/bot/commands/novabox.js");
    const va = [{ title: "Tokyo Ghoul", url: "u1", slug: "tokyo-ghoul-vf", isVf: true, language: "VF" }] as never[];
    const r: any = await resolveVostfrRequest("tokyo ghoul", va);
    expect(r.kind).toBe("switched");
    expect(r.results[0].url).toContain("anime-sama.to");
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it("resolveVostfrRequest : VOSTFR absente des DEUX catalogues → message honnête (+ note VF)", async () => {
    axiosPostMock.mockResolvedValue({ data: "<html>no results</html>" });
    const { resolveVostfrRequest } = await import("../src/bot/commands/novabox.js");
    const va = [{ title: "X", url: "u1", slug: "x-vf", isVf: true, language: "VF" }] as never[];
    const r: any = await resolveVostfrRequest("x", va);
    expect(r.kind).toBe("missing");
    expect(r.message).toContain("Aucune VOSTFR trouvée");
    expect(r.message).toContain("deux catalogues");
    expect(r.message).toContain("existe en VF"); // le consoler : la VF existe
  });

  it("resolveVostfrRequest : l'autre catalogue injoignable → message dédié, pas d'échec brut", async () => {
    axiosPostMock.mockRejectedValue(new Error("network down"));
    const { resolveVostfrRequest, vostfrAutoMissingMessage } = await import("../src/bot/commands/novabox.js");
    const va = [] as never[];
    const r: any = await resolveVostfrRequest("x", va);
    expect(r.kind).toBe("missing");
    expect(r.message).toContain("injoignable");
    expect(vostfrAutoMissingMessage("x", false, false)).not.toContain("existe en VF");
  });

  it("écran VOSTFR filtré : le wiring garde la liste complète (bascule .a vf retrouve la VF)", async () => {
    const { wireSessionSeasons } = await import("../src/bot/commands/novabox.js");
    const vf = { title: "X Saison 1", url: "https://voir-anime.to/anime/x-vf/", slug: "x-vf", isVf: true, language: "VF" };
    const vostfr = { title: "X Saison 1", url: "https://voir-anime.to/anime/x/", slug: "x", isVf: false, language: "VOSTFR" };
    const session: any = {
      source: "va",
      searchResults: [vostfr], // l'écran n'a montré que la VOSTFR
      fullVaResults: [vf, vostfr], // la liste complète part en session (9.18rrr)
      animeTitle: "X",
      animeUrl: vostfr.url,
      languages: [],
      seasons: []
    };
    const r1: any = await wireSessionSeasons(session, vostfr, "VOSTFR");
    expect(r1.status).toBe("ok");
    expect(r1.language).toBe("VOSTFR");
    expect(session.seasons).toHaveLength(1);
    // Bascule `.a vf` : la saison VF est retrouvée grâce à la liste complète.
    const r2: any = await wireSessionSeasons(session, vf, "VF");
    expect(r2.status).toBe("ok");
    expect(r2.language).toBe("VF");
    expect(session.seasons[0].url).toContain("-vf/");
  });
});

describe("9.18sss — `.a vostfr` / `.a vf` seul : bascule d'écran + mémoire de recherche", () => {
  it("rememberVaSearch / getLastVaSearch : mémoire par utilisateur, TTL = session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T05:00:00Z"));
    try {
      const { rememberVaSearch, getLastVaSearch } = await import("../src/bot/commands/novabox.js");
      const entries = [
        { title: "X S1", url: "u1", slug: "x-vf", isVf: true, language: "VF" },
        { title: "X S1", url: "u2", slug: "x", isVf: false, language: "VOSTFR" }
      ] as never[];
      rememberVaSearch("chatA", "x", entries);
      expect(getLastVaSearch("chatA")?.query).toBe("x");
      expect(getLastVaSearch("chatA")?.results).toHaveLength(2);
      expect(getLastVaSearch("chatB")).toBeNull(); // mémoire par chat
      vi.setSystemTime(new Date("2026-10-18T05:12:00Z")); // +12 min > TTL 10 min
      expect(getLastVaSearch("chatA")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("le handler est branché : mot seul bascule l'écran, la recherche littérale « vostfr » est morte", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");
    expect(src).toContain('firstArg === "vostfr" || firstArg === "vf"');
    expect(src).toContain("getLastVaSearch(sender)");
    expect(src).toContain("rememberVaSearch(sender, matchedQuery");
    expect(src).toContain("bascule vostfr automatique"); // log terrain
  });
});
