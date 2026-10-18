/**
 * 9.18kkk — retry à variantes sur recherche anime (retour terrain 18/10).
 *
 * « the rampart of ice s1 ep 9-10 en 480 » : voir-anime répondait 0 résultat
 * — le titre réel est « The Ramparts of Ice » (un « s » de différence).
 * searchAnimeBySource réessaie maintenant le MÊME catalogue avec des
 * variantes normalisées (article / singulier / pluriel), bornées à 4.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/bot/services/voiranimeClient.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/bot/services/voiranimeClient.js")>();
  return { ...orig, voiranimeSearch: vi.fn() };
});

import { voiranimeSearch } from "../src/bot/services/voiranimeClient.js";
import { searchAnimeBySource, searchQueryVariants } from "../src/bot/services/animeSources.js";

const mSearch = vi.mocked(voiranimeSearch);

beforeEach(() => {
  mSearch.mockReset();
});

describe("9.18kkk — searchQueryVariants (pur)", () => {
  it("le cas terrain : « the rampart of ice » produit la variante plurielle « ramparts of ice »", () => {
    const v = searchQueryVariants("the rampart of ice");
    expect(v[0]).toBe("the rampart of ice"); // l'originale toujours en premier
    expect(v).toContain("rampart of ice"); // sans article
    expect(v).toContain("ramparts of ice"); // singulier → pluriel (le « s » manquant)
    expect(v.length).toBeLessThanOrEqual(4);
  });

  it("pluriel → singulier : « the ramparts of ice » produit « rampart of ice »", () => {
    const v = searchQueryVariants("the ramparts of ice");
    expect(v).toContain("rampart of ice");
    expect(v).toContain("ramparts of ice");
  });

  it("mots courts et mots vides jamais fléchis : « zzz » n'a qu'UNE variante", () => {
    expect(searchQueryVariants("zzz")).toEqual(["zzz"]);
  });

  it("requête vide → aucune variante ; doublons dédupliqués", () => {
    expect(searchQueryVariants("")).toEqual([]);
    expect(searchQueryVariants("   ")).toEqual([]);
    // "le titan" : sans article = "titan" ; fléchi = "titans" (pas de doublon de l'originale)
    const v = searchQueryVariants("le titan");
    expect(new Set(v).size).toBe(v.length);
    expect(v).toContain("titan");
    expect(v).toContain("titans");
  });
});

describe("9.18kkk — searchAnimeBySource : retry sur le MÊME catalogue", () => {
  it("0 résultat sur l'originale → la variante plurielle trouve (cas terrain)", async () => {
    mSearch
      .mockResolvedValueOnce([]) // "the rampart of ice"
      .mockResolvedValueOnce([]) // "rampart of ice"
      .mockResolvedValueOnce([
        { title: "The Ramparts of Ice VF", url: "https://voir-anime.to/anime/the-ramparts-of-ice-vf/", slug: "the-ramparts-of-ice-vf", isVf: true },
      ]);
    const results = await searchAnimeBySource("the rampart of ice", "va");
    expect(results).toHaveLength(1);
    expect(results[0].title).toContain("Ramparts");
    expect(mSearch).toHaveBeenCalledTimes(3);
    expect(mSearch).toHaveBeenNthCalledWith(3, "ramparts of ice");
  });

  it("résultat dès la première requête → UNE seule recherche (pas de coût additionnel)", async () => {
    mSearch.mockResolvedValueOnce([
      { title: "Naruto VF", url: "https://voir-anime.to/anime/naruto-vf/", slug: "naruto-vf", isVf: true },
    ]);
    const results = await searchAnimeBySource("naruto", "va");
    expect(results).toHaveLength(1);
    expect(mSearch).toHaveBeenCalledTimes(1);
  });

  it("toutes les variantes vides → réponse vide honnête (toujours pas de fallback catalogue)", async () => {
    mSearch.mockResolvedValue([]);
    const results = await searchAnimeBySource("zzzz inexistzz", "va");
    expect(results).toEqual([]);
    expect(mSearch.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mSearch.mock.calls.length).toBeLessThanOrEqual(4); // borné
  });
});
