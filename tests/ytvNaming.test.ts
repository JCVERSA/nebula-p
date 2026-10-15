/**
 * 9.18gg — safeVideoName (retour terrain 15/10 : les titres japonais donnaient
 * « -_Eve_MV.mp4 » ou « .mp4 » après nettoyage — bords non alphanumériques
 * nettoyés + fallback « video »).
 */
import { describe, it, expect } from "vitest";
import { safeVideoName } from "../src/bot/commands/ytvideo.js";

describe("9.18gg — safeVideoName (pur)", () => {
  it("titre japonais + partie latine : les bords nettoyés (l'ancien donnait « - Eve MV »)", () => {
    expect(safeVideoName("逃避行 - Eve MV")).toBe("Eve MV");
    expect(safeVideoName("アヴァン(Avant) - Eve MV")).toBe("Avant - Eve MV");
  });

  it("titre 100% japonais → fallback « video » (l'ancien donnait un nom vide)", () => {
    expect(safeVideoName("さよならエンドロール")).toBe("video");
    expect(safeVideoName("")).toBe("video");
  });

  it("titre ASCII inchangé, espaces normalisés", () => {
    expect(safeVideoName("lazy cat – Eve MV")).toBe("lazy cat Eve MV");
    expect(safeVideoName("Teenage Blue (Ao no Hako) SPECIAL MV")).toContain("Teenage Blue");
  });

  it("cap 60 caractères respecté", () => {
    expect(safeVideoName("a".repeat(80)).length).toBe(60);
  });
});
