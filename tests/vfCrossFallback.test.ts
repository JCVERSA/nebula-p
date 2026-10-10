/**
 * 8.95 — Fallback croisé catalogue + ask-before-switch dans novabox.
 *
 * 1. exactEntryForLanguage (pur) : le candidat du fallback croisé doit être
 *    un match EXACT — jamais un titre approximatif — et, côté va, porter la
 *    langue demandée (langue structurelle des slugs).
 * 2. Wiring novabox : l'auto-continue 8.69 (« Je continue en… ») est
 *    remplacée par une question fail-closed (.a oui / .a non), le fallback
 *    croisé est branché sur les deux chemins (quick + interactif).
 * 3. Inter-régression : le wording de la question ne doit PAS déclencher
 *    l'offre de bascule côté agent (agentBrain) — sinon double suggestion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { exactEntryForLanguage } from "../src/bot/services/animeSources.js";
import { replySuggestsOtherCatalog } from "../src/bot/services/agentBrain.js";
import type { SourceSearchResult } from "../src/bot/services/animeSources.js";

function entry(partial: Partial<SourceSearchResult>): SourceSearchResult {
  return { title: "", subtitle: "", url: "", ...partial };
}

describe("exactEntryForLanguage (8.95 — candidat du fallback croisé)", () => {
  const vaResults = [
    entry({ title: "Tokyo Ghoul:re", url: "https://va/tg-re", language: "VF" }),
    entry({ title: "Tokyo Ghoul:re 2", url: "https://va/tg-re-2", language: "VF" }),
    entry({ title: "Tokyo Ghoul", url: "https://va/tg", language: "VOSTFR" })
  ];

  it("retourne l'entrée en match exact qui porte la langue demandée (va)", () => {
    const found = exactEntryForLanguage("Tokyo Ghoul", vaResults, "VOSTFR", "va");
    expect(found?.url).toBe("https://va/tg");
  });

  it("retourne null quand l'entrée exacte n'a PAS la langue demandée (va)", () => {
    // Tokyo Ghoul √A n'existe pas : la plus proche est :re — refusée.
    const found = exactEntryForLanguage("Tokyo Ghoul :re", [
      entry({ title: "Tokyo Ghoul:re", url: "https://va/tg-re", language: "VF" })
    ], "VOSTFR", "va");
    expect(found).toBeNull();
  });

  it("ne JAMAIS proposer un titre approximatif (pas de match exact → null)", () => {
    const found = exactEntryForLanguage("Tokyo Ghoul Root A", vaResults, "VF", "va");
    expect(found).toBeNull();
  });

  it("côté as, le match exact suffit (langue vérifiée ensuite via parseSeasons)", () => {
    const asResults = [
      entry({ title: "Tokyo Ghoul:re", url: "https://as/tg-re" }),
      entry({ title: "Tokyo Ghoul", url: "https://as/tg" })
    ];
    const found = exactEntryForLanguage("Tokyo Ghoul", asResults, "VF", "as");
    expect(found?.url).toBe("https://as/tg");
    expect(found?.language).toBeUndefined();
  });

  it("retourne null sur des résultats vides", () => {
    expect(exactEntryForLanguage("Naruto", [], "VF", "va")).toBeNull();
  });
});

describe("Wiring novabox 8.95 (fallback croisé + ask-first)", () => {
  const src = readFileSync(join(__dirname, "../src/bot/commands/novabox.ts"), "utf-8");

  it("l'auto-continue 8.69 « Je continue en … » a été supprimée", () => {
    expect(src).not.toContain("Je continue en");
  });

  it("le fallback croisé est branché (lookup + candidat exact)", () => {
    expect(src).toContain("crossCatalogLanguageLookup");
    expect(src).toContain("exactEntryForLanguage");
    expect(src).toContain("skipCross");
  });

  it("question fail-closed avant de changer de langue (.a oui / .a non)", () => {
    expect(src).toContain("pendingLanguageConfirm");
    expect(src).toContain('answer === "oui"');
    expect(src).toContain('answer === "non"');
    expect(src).toContain("Pas de ${effectiveWant} pour ce titre");
  });
});

describe("Inter-régression agent ↔ ask-first (8.95)", () => {
  it("la question ask-first ne déclenche PAS l'offre de bascule de l'agent", () => {
    const askFirst =
      "ℹ️ *Pas de VF pour ce titre* — j'ai vérifié les deux catalogues.\n\n" +
      "On continue en *VOSTFR* ?\n\n✅ `.a oui` — continuer en VOSTFR\n❌ `.a non` — annuler";
    expect(replySuggestsOtherCatalog(askFirst)).toBe(false);
  });

  it("le message d'échec de la policy déclenche toujours l'offre de l'agent", () => {
    const missing =
      "😢 *Aucun VF pour ce titre sur ce catalogue.*\n💡 Essaie avec l'autre catalogue : `.a va <titre>`";
    expect(replySuggestsOtherCatalog(missing)).toBe(true);
  });
});
