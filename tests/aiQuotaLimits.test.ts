import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  checkAIQuota,
  consumeAIQuota,
  getAIQuotaUsage,
  resetAIQuota,
  setAIQuotaOverrideGetter,
} from "../src/bot/aiQuota.js";

/**
 * 9.18 (M/B) — limite IA personnalisée par utilisateur + lecture d'usage.
 *
 * Le résolveur est injecté (setAIQuotaOverrideGetter) pour éviter une
 * dépendance circulaire aiQuota→userDirectory : ici on teste le mécanisme
 * avec un faux résolveur — bornes, repli sur la limite globale, et
 * cohérence check/consume/usage.
 */

const DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nebula-aiq-test-")), "database");
const USER = "237600000030@s.whatsapp.net";
const OTHER = "237600000031@s.whatsapp.net";

beforeEach(() => {
  process.env.NEBULA_DATA_DIR = DATA_DIR;
});

afterEach(() => {
  resetAIQuota(USER);
  resetAIQuota(OTHER);
  setAIQuotaOverrideGetter(() => null);
  delete process.env.NEBULA_DATA_DIR;
  delete process.env.OWNER_NUMBER;
});

describe("9.18 — aiQuota : limite personnalisée et usage", () => {
  it("sans résolveur : limite globale, comportement inchangé", () => {
    const q = checkAIQuota(USER);
    expect(q.allowed).toBe(true);
    expect(q.limit).toBeGreaterThan(0);
    expect(q.usedToday).toBe(0);
  });

  it("override par utilisateur : check et consume respectent la limite personnalisée", () => {
    setAIQuotaOverrideGetter((jid) => (jid === USER ? 2 : null));
    expect(checkAIQuota(USER).limit).toBe(2);
    expect(consumeAIQuota(USER).allowed).toBe(true); // 1/2
    expect(consumeAIQuota(USER).allowed).toBe(true); // 2/2
    const blocked = consumeAIQuota(USER);
    expect(blocked.allowed).toBe(false);
    expect(blocked.usedToday).toBe(2);
    expect(blocked.limit).toBe(2);
    // Les autres utilisateurs gardent la limite globale
    expect(checkAIQuota(OTHER).limit).toBeGreaterThan(2);
  });

  it("bornes de l'override : plafonné à 500, valeurs non positives ignorées", () => {
    setAIQuotaOverrideGetter(() => 99999);
    expect(checkAIQuota(USER).limit).toBe(500);
    setAIQuotaOverrideGetter(() => 0);
    expect(checkAIQuota(USER).limit).toBeGreaterThan(0); // repli global
    setAIQuotaOverrideGetter(() => Number.NaN);
    expect(checkAIQuota(USER).limit).toBeGreaterThan(0); // repli global
  });

  it("résolveur qui jette : repli silencieux sur la limite globale (jamais de crash quota)", () => {
    setAIQuotaOverrideGetter(() => {
      throw new Error("répertoire indisponible");
    });
    const q = checkAIQuota(USER);
    expect(q.allowed).toBe(true);
    expect(q.limit).toBeGreaterThan(0);
  });

  it("getAIQuotaUsage : usage du jour sans consommation (affichage dashboard)", () => {
    setAIQuotaOverrideGetter((jid) => (jid === USER ? 10 : null));
    resetAIQuota(USER);
    expect(getAIQuotaUsage(USER)).toEqual({ used: 0, limit: 10 });
    consumeAIQuota(USER);
    consumeAIQuota(USER);
    expect(getAIQuotaUsage(USER)).toEqual({ used: 2, limit: 10 });
  });

  it("wiring app.ts : le résolveur est branché sur le répertoire utilisateurs", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "app.ts"), "utf-8");
    expect(src).toContain("setAIQuotaOverrideGetter((jid) => getUserAILimit(jid))");
  });

  it("wiring agentRunner/ai.ts : la sourdine IA est vérifiée avant tout tour IA", () => {
    const runner = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/agentRunner.ts"), "utf-8");
    expect(runner).toContain('isMutedUser(String(info.actorJid || ""))');
    const ai = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/ai.ts"), "utf-8");
    expect(ai).toContain("isMutedUser(context.sender)");
  });
});

describe("9.18gg — owner illimité (décision owner 15/10 : mon bot, mes clés)", () => {
  it("le numéro owner échappe au quota quotidien, même après 45 appels", () => {
    process.env.OWNER_NUMBER = "237600000099";
    const owner = "237600000099@s.whatsapp.net";
    for (let i = 0; i < 45; i++) consumeAIQuota(owner);
    const q = checkAIQuota(owner);
    expect(q.allowed).toBe(true);
    expect(q.limit).toBe(1_000_000);
    resetAIQuota(owner);
  });

  it("les autres numéros restent limités (limite globale intacte)", () => {
    process.env.OWNER_NUMBER = "237600000099";
    for (let i = 0; i < 40; i++) consumeAIQuota(USER);
    expect(checkAIQuota(USER).allowed).toBe(false);
    resetAIQuota(USER);
  });
});
