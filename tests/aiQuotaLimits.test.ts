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
  checkTTSQuota,
  consumeTTSQuota,
  resetTTSQuota,
  __setTtsDailyLimitForTests,
} from "../src/bot/aiQuota.js";
import { resolveOwnerIdentity, __resetOwnerLidsForTests } from "../src/bot/ownerIdentity.js";

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
  __resetOwnerLidsForTests(); // 9.18nn — mémoire LID owner par process
  resetAIQuota(USER);
  resetAIQuota(OTHER);
  resetTTSQuota(USER);
  resetTTSQuota(OTHER);
  __setTtsDailyLimitForTests(10);
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

describe("9.18ll — plafond TTS dédié (répartition de la voix Gemini entre users)", () => {
  it("non-owner : 10 synthèses Gemini/jour par défaut, puis refus (service → Edge Henri)", () => {
    expect(checkTTSQuota(USER).limit).toBe(10);
    for (let i = 0; i < 10; i++) expect(consumeTTSQuota(USER).allowed).toBe(true);
    const blocked = checkTTSQuota(USER);
    expect(blocked.allowed).toBe(false);
    expect(blocked.usedToday).toBe(10);
    expect(consumeTTSQuota(USER).allowed).toBe(false); // pas de 11e
  });

  it("owner : échappe au plafond TTS (même règle que le quota IA 9.18gg)", () => {
    process.env.OWNER_NUMBER = "237600000099";
    const owner = "237600000099@s.whatsapp.net";
    for (let i = 0; i < 30; i++) consumeTTSQuota(owner);
    const q = checkTTSQuota(owner);
    expect(q.allowed).toBe(true);
    expect(q.limit).toBe(1_000_000);
    resetTTSQuota(owner);
  });

  it("indépendant du quota IA général : consommer l'un ne touche pas l'autre", () => {
    for (let i = 0; i < 10; i++) consumeTTSQuota(USER);
    expect(checkTTSQuota(USER).allowed).toBe(false); // TTS plein
    expect(consumeAIQuota(USER).allowed).toBe(true); // 40/j intacts
    resetTTSQuota(USER);
    for (let i = 0; i < 5; i++) consumeAIQuota(USER);
    expect(checkTTSQuota(USER).allowed).toBe(true); // TTS remis à neuf
    expect(checkTTSQuota(USER).usedToday).toBe(0);
  });

  it("NEBULA_TTS_DAILY_LIMIT=0 → voix Gemini désactivée pour les non-owner (tout Edge)", () => {
    __setTtsDailyLimitForTests(0);
    const q = checkTTSQuota(USER);
    expect(q.allowed).toBe(false);
    expect(q.limit).toBe(0);
    expect(consumeTTSQuota(USER).allowed).toBe(false);
  });

  it("resetTTSQuota : remise à zéro propre (dashboard/tests)", () => {
    consumeTTSQuota(USER);
    consumeTTSQuota(USER);
    expect(resetTTSQuota(USER)).toBe(true);
    expect(checkTTSQuota(USER).usedToday).toBe(0);
    expect(resetTTSQuota(OTHER)).toBe(false); // jamais consommé → rien à reset
  });
});

describe("9.18nn — owner via LID (numéro masqué) : les quotas le reconnaissent enfin", () => {
  // Retour terrain 16/10 : l'owner écrit via un jid @lid (ex. …5378) alors
  // que OWNER_NUMBER est son numéro réel (…3760). Le moteur le reconnaît
  // (8.89 : .purge OK, budget agent illimité) mais aiQuota comparait le LID
  // au numéro → JAMAIS owner → quotalé comme un invité depuis 9.18gg.
  const LID = "9876543210@lid";
  const OWNER_PN = "237640143760";
  const fakeSock: any = {
    signalRepository: {
      lidMapping: { getPNForLID: async () => `${OWNER_PN}:0@s.whatsapp.net` },
    },
  };

  it("le moteur reconnaît le LID owner (8.89) → quotas IA et TTS illimités", async () => {
    process.env.OWNER_NUMBER = OWNER_PN;
    const id = await resolveOwnerIdentity(fakeSock, LID, OWNER_PN);
    expect(id.isOwner).toBe(true);
    expect(id.resolvedNumber).toBe(OWNER_PN);
    // mémoire 9.16b chaude → aiQuota doit échapper aux DEUX plafonds
    for (let i = 0; i < 45; i++) expect(consumeAIQuota(LID).allowed).toBe(true);
    for (let i = 0; i < 30; i++) expect(consumeTTSQuota(LID).allowed).toBe(true);
    expect(checkAIQuota(LID).limit).toBe(1_000_000);
    expect(checkTTSQuota(LID).limit).toBe(1_000_000);
    resetAIQuota(LID);
    resetTTSQuota(LID);
  });

  it("LID non résolu (process froid, jamais vu) → quotas normaux, pas de trou", async () => {
    process.env.OWNER_NUMBER = OWNER_PN;
    expect(checkAIQuota(LID).limit).toBe(40);
    expect(checkTTSQuota(LID).limit).toBe(10);
    expect(checkTTSQuota(LID).allowed).toBe(true);
  });

  it("un jid téléphone matchant OWNER_NUMBER reste direct (régression 9.18gg)", () => {
    process.env.OWNER_NUMBER = OWNER_PN;
    expect(checkAIQuota(`${OWNER_PN}@s.whatsapp.net`).limit).toBe(1_000_000);
  });
});
