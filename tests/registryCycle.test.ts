import { describe, expect, it } from "vitest";
// ORDRE VOLONTAIRE (audit harnais 8.79, F1) : importer commands/ai.ts AVANT
// le registre reproduit l'ordre d'entrée qui exposait le cycle
// registry -> ai -> persona -> commandKnowledge -> registry. Avant le fix
// 8.80, l'évaluation du module levait « ReferenceError: Cannot access
// 'aiCommand' before initialization » (TDZ) — ce fichier doit simplement
// charger et fonctionner, quel que soit l'ordre d'import.
import aiCommand from "../src/bot/commands/ai.js";
import { initRegistry, getCommand, isRegistryReady } from "../src/bot/commandRegistry.js";

describe("registry — résistance au cycle de modules (audit F1)", () => {
  it("charge commands/ai.ts importé en premier puis initialise le registre", async () => {
    expect(aiCommand?.name).toBe("ai");
    if (!isRegistryReady()) await initRegistry();
    expect(getCommand("ai")?.name).toBe("ai");
    expect(getCommand("a")?.name).toBe("anime");
  });
});
