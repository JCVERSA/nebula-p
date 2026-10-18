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

beforeEach(() => {
  axiosGetMock = vi.fn();
  vi.resetModules();
  vi.doMock("axios", () => ({ default: { post: vi.fn(), get: axiosGetMock } }));
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
