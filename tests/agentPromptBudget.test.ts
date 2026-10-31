import { beforeAll, describe, expect, it } from "vitest";
import { initRegistry } from "../src/bot/commandRegistry.js";
import { buildCommandKnowledge, buildAgentKnowledge } from "../src/bot/commandKnowledge.js";

/**
 * 9.18eeee (audit A4) — les budgets historiques (4500/6000) mesuraient la
 * fiche SANS registre initialisé : l'inventaire des commandes (commandInventory)
 * était vide dans les tests, jamais en production. Le prompt réel faisait
 * ~11 000 caractères sans qu'aucune garde ne le voie.
 *
 * Ce test mesure la VRAIE taille (registre initialisé) et échoue bruyamment
 * si l'inventaire disparaît (le piège « registre vide = budget vert » ne
 * reviendra plus).
 */
describe("9.18eeee — budget de contexte RÉEL (registre initialisé)", () => {
  beforeAll(async () => {
    await initRegistry();
  });

  it("l'inventaire est bien présent (garde anti faux-vert)", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("## Toutes les commandes");
    expect(k).toContain("`.");
  });

  it("la fiche persona (guidage) reste sous 10 000 caractères réels", () => {
    expect(buildCommandKnowledge(".").length).toBeLessThan(10000);
  });

  it("la fiche agent complète reste sous 11 500 caractères réels", () => {
    expect(buildAgentKnowledge(".").length).toBeLessThan(11500);
  });
});
