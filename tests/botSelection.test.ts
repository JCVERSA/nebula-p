import { describe, it, expect } from "vitest";
import { withBotParam, isPerBotUrl } from "../src/lib/botSelection.js";

/**
 * Multi-bots (8.77) — routage des URL vers le bot sélectionné.
 *
 * Invariants :
 *  - sans sélection (null) : AUCUNE URL n'est modifiée (compat totale du
 *    comportement historique — le test UI existant en dépend) ;
 *  - seules les routes par-bot reçoivent ?bot= ; les routes du panneau
 *    (/api/auth, /api/bots, /api/health, /d/) et les URL externes ne bougent
 *    jamais (sinon le mock du test UI et le panneau superviseur casseraient) ;
 *  - un query existant reçoit &bot=, pas un second « ? ».
 */

describe("isPerBotUrl", () => {
  it("accepte les routes moteur", () => {
    for (const url of [
      "/api/bot/status",
      "/api/bot/qr",
      "/api/bot/pair-code",
      "/api/bot/audit?limit=60",
      "/api/bot",
      "/api/gemini/transcribe",
      "/api/batch-downloads",
      "/api/batch-downloads/retry/42",
    ]) {
      expect(isPerBotUrl(url), url).toBe(true);
    }
  });

  it("refuse les routes panneau et externes", () => {
    for (const url of [
      "/api/bots", // route superviseur — pas un moteur !
      "/api/bots/nebula/start",
      "/api/auth/login",
      "/api/health",
      "/d/abc123",
      "/api/media/download/tok",
      "https://example.com/api/bot/status",
      "/",
    ]) {
      expect(isPerBotUrl(url), url).toBe(false);
    }
  });
});

describe("withBotParam", () => {
  it("ne modifie rien sans bot sélectionné", () => {
    expect(withBotParam("/api/bot/status", null)).toBe("/api/bot/status");
    expect(withBotParam("/api/bot/status", undefined)).toBe("/api/bot/status");
    expect(withBotParam("/api/bot/status", "")).toBe("/api/bot/status");
  });

  it("ajoute ?bot= aux routes par-bot", () => {
    expect(withBotParam("/api/bot/status", "bot2")).toBe("/api/bot/status?bot=bot2");
    expect(withBotParam("/api/batch-downloads", "bot2")).toBe("/api/batch-downloads?bot=bot2");
  });

  it("complète un query existant avec &bot=", () => {
    expect(withBotParam("/api/bot/audit?limit=60", "bot2")).toBe("/api/bot/audit?limit=60&bot=bot2");
  });

  it("n'encode pas les ids simples mais encode les spéciaux", () => {
    expect(withBotParam("/api/bot/status", "nebula")).toBe("/api/bot/status?bot=nebula");
    expect(withBotParam("/api/bot/status", "bo t&2")).toBe("/api/bot/status?bot=bo%20t%262");
  });

  it("ne touche jamais les routes du panneau, même avec un bot sélectionné", () => {
    for (const url of ["/api/bots", "/api/auth/me", "/api/health", "/d/tok", "https://ext.example/x"]) {
      expect(withBotParam(url, "bot2"), url).toBe(url);
    }
  });
});
