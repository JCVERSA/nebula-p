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
import { bareLanguageAnswer } from "../src/bot/commands/novabox.js";
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

  it("8.96 : le défaut de catalogue est effectif (va, sauf désactivation opérateur)", () => {
    expect(src).toContain("quickParams.source || effectiveDefaultSource()");
  });

  it("le fallback croisé est branché (lookup + candidat exact)", () => {
    expect(src).toContain("crossCatalogLanguageLookup");
    expect(src).toContain("exactEntryForLanguage");
    expect(src).toContain("skipCross");
  });

  it("question fail-closed avant de changer de langue (.a oui / .a non)", () => {
    expect(src).toContain("pendingLanguageConfirm");
    expect(src).toContain("bareLanguageAnswer");
    expect(src).toContain("Pas de ${effectiveWant} pour ce titre");
  });

  it("qualité « nearest » annoncée honnêtement (plus de changement silencieux)", () => {
    expect(src).toContain("indisponible sur cette source");
  });
});

describe("Inter-régression agent ↔ ask-first (8.95)", () => {
  it("la question ask-first ne déclenche PAS l'offre de bascule de l'agent", () => {
    const askFirst =
      "ℹ️ *Pas de VF pour ce titre* — j'ai vérifié les deux catalogues.\n\n" +
      "On continue en *VOSTFR* ?\n\n✅ Réponds *oui* — continuer en VOSTFR\n❌ Réponds *non* — annuler\n\n_(en groupe : `.a oui` / `.a non`)_";
    expect(replySuggestsOtherCatalog(askFirst)).toBe(false);
  });

  it("le message d'échec de la policy déclenche toujours l'offre de l'agent", () => {
    const missing =
      "😢 *Aucun VF pour ce titre sur ce catalogue.*\n💡 Essaie avec l'autre catalogue : `.a va <titre>`";
    expect(replySuggestsOtherCatalog(missing)).toBe(true);
  });
});

describe("8.95b — « oui » nu routé vers la question novabox (pas l'agent)", () => {
  it("bareLanguageAnswer : vocabulaire oui/non strict, mot unique", () => {
    expect(bareLanguageAnswer("oui")).toBe("oui");
    expect(bareLanguageAnswer(" OK ")).toBe("oui");
    expect(bareLanguageAnswer("Yes")).toBe("oui");
    expect(bareLanguageAnswer("go")).toBe("oui");
    expect(bareLanguageAnswer("non")).toBe("non");
    expect(bareLanguageAnswer("annuler")).toBe("non");
    expect(bareLanguageAnswer("cancel")).toBe("non");
    // Tout le reste (phrases, autres mots) ne doit PAS être intercepté.
    expect(bareLanguageAnswer("oui je veux")).toBeNull();
    expect(bareLanguageAnswer("telecharge naruto")).toBeNull();
    expect(bareLanguageAnswer("s1")).toBeNull();
    expect(bareLanguageAnswer("")).toBeNull();
  });

  it("botEngine route le oui/non nu AVANT l'agent, sauf confirmation agent en attente", () => {
    const engine = readFileSync(join(__dirname, "../src/bot/botEngine.ts"), "utf-8");
    expect(engine).toContain("bareLanguageAnswer(text)");
    expect(engine).toContain("hasPendingLanguageConfirm(senderJid)");
    expect(engine).toContain("!peekPendingConfirmation(actualSenderJid)");
    // Le routage doit précéder handleAgentMessage (le « oui » nu ne doit pas
    // partir dans une nouvelle conversation agent).
    const gatePos = engine.indexOf("const bareAnswer = bareLanguageAnswer(text);");
    const agentPos = engine.indexOf("await handleAgentMessage(");
    expect(gatePos).toBeGreaterThan(-1);
    expect(agentPos).toBeGreaterThan(-1);
    expect(gatePos).toBeLessThan(agentPos);
  });
});

describe("8.95b — fiche agent : qualité explicite, say sans langue/qualité", () => {
  it("la fiche documente le mapping des flags ET recommande la qualité écrite", () => {
    const knowledge = readFileSync(join(__dirname, "../src/bot/commandKnowledge.ts"), "utf-8");
    // Source brute (backticks échappés) : on cible des sous-chaînes stables —
    // r1=480p · r2=360p · r3=720p · r4=1080p + exemples en qualité écrite.
    expect(knowledge).toContain("=480p ·");
    expect(knowledge).toContain("=360p ·");
    expect(knowledge).toContain("=720p ·");
    expect(knowledge).toContain("=1080p —");
    expect(knowledge).toContain("ep6 480p");
    expect(knowledge).toContain("pas l'ordre croissant");
  });

  it("la règle say interdit langue, disponibilité ET qualité, avec exemple ✗", () => {
    const knowledge = readFileSync(join(__dirname, "../src/bot/commandKnowledge.ts"), "utf-8");
    expect(knowledge).toContain("jamais la langue, la disponibilité ni la qualité");
    expect(knowledge).toContain("Voici X en VF en 480p");
  });
});
