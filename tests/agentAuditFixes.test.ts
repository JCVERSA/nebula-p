import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.19n — correctifs de l'audit agent+commandes du 08/11 (lots A+B+C) :
 *  - #2 : try/catch PAR MESSAGE dans la boucle messages.upsert (un message
 *    qui jette ne tue plus le reste du lot) ;
 *  - #3 : plus AUCUN envoi agent sur le socket capturé (sendMuted,
 *    offerCatalogRetry) ;
 *  - #4 : quota IA consommé au SUCCÈS de l'appel (pane fournisseur ≠ quota) ;
 *  - #5 : .img en préfixe passe par le RoleGuard (politique de groupe) ;
 *  - #8 : trace.moe — élagage propre des cooldowns expirés (plus de clear()) ;
 *  - #9 : agtrace en denylist agent + tag ownerOnly (#7).
 */

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "auditfix-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;

vi.mock("../src/bot/botEngine.js", () => ({
  addLog: vi.fn(),
  bufferFromDataUri: vi.fn(() => null),
  getCachedGroupMetadata: vi.fn(async () => null),
  maskLogNumber: vi.fn((s: string) => s),
}));
vi.mock("../src/bot/services/imageFinder.js", () => ({
  findImageCandidates: vi.fn(),
  downloadImageCandidate: vi.fn(),
  IMAGE_SEND_LIMIT: 6,
}));
vi.mock("../src/bot/webQuota.js", () => ({
  checkWebQuota: vi.fn(() => ({ allowed: true, limit: 25 })),
  consumeWebQuota: vi.fn(),
}));
vi.mock("../src/bot/auditTrail.js", () => ({
  recordAudit: vi.fn(),
}));

import { isAgentDeniedCommand, AGENT_DENYLIST } from "../src/bot/services/agentBrain.js";
import { dispatchBotCommand } from "../src/bot/commandDispatch.js";
import { setGroupPolicy, replaceAllPolicies } from "../src/bot/groupAccessStore.js";
import { initRegistry } from "../src/bot/commandRegistry.js";
import { findImageCandidates } from "../src/bot/services/imageFinder.js";

const GID = "120363000000000000@g.us";
const MEMBER = "1555600000040@s.whatsapp.net";

const mFind = vi.mocked(findImageCandidates);

function groupInfo() {
  return {
    senderJid: GID,
    actorJid: MEMBER,
    senderName: "Tester",
    senderNumber: "1555600000040",
    isOwner: false,
    isAdmin: false,
    isGroup: true,
    prefix: ".",
    text: ".img ciel",
    messageContent: {},
  };
}

function groupMsg() {
  return {
    key: { remoteJid: GID, fromMe: false, id: "AUDITFIX1", participant: MEMBER },
    message: { conversation: ".img ciel" },
    pushName: "Tester",
  };
}

beforeEach(async () => {
  mFind.mockClear();
  mFind.mockResolvedValue({ candidates: [], engines: [] });
  replaceAllPolicies({});
  await initRegistry();
});

afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.19n #9/#7 — agtrace hors agent + taggé ownerOnly", () => {
  it("la denylist agent contient agtrace (l'agent n'a rien à déboguer)", () => {
    expect(isAgentDeniedCommand("agtrace")).toBe(true);
    expect(AGENT_DENYLIST.has("agent")).toBe(true);
    expect(AGENT_DENYLIST.has("ai")).toBe(true);
  });

  it("la commande porte le tag ownerOnly (double filet avec la porte inline)", () => {
    const src = fs.readFileSync("src/bot/commands/agtrace.ts", "utf-8");
    expect(src).toContain("ownerOnly: true");
  });
});

describe("9.19n #2/#3/#4/#8 — pins de câblage (leçon 8.49b)", () => {
  const read = (p: string) => fs.readFileSync(p, "utf-8");

  it("botEngine : la boucle messages.upsert est protégée par try/catch PAR MESSAGE", () => {
    const src = read("src/bot/botEngine.ts");
    expect(src).toContain("for (const msg of m.messages) {");
    expect(src).toContain("try {");
    expect(src).toContain("Échec du traitement d'un message");
    expect(src).toContain("le reste du lot continue");
  });

  it("agentRunner : plus AUCUN envoi direct sur le socket capturé", () => {
    const src = read("src/bot/services/agentRunner.ts");
    expect(src).not.toMatch(/await sock\.sendMessage\(/); // tout passe par resolveLiveSocket
    expect(src).toContain("resolveLiveSocket(sock).sendMessage");
  });

  it("agentRunner : le quota IA est consommé APRÈS le premier appel réussi (jamais avant)", () => {
    const src = read("src/bot/services/agentRunner.ts");
    const firstConsume = src.indexOf("consumeAIQuota(info.actorJid);");
    const afterRaw = src.indexOf("rawLatencyMs = Date.now() - tStart;");
    expect(firstConsume).toBeGreaterThan(-1);
    expect(afterRaw).toBeGreaterThan(-1);
    expect(firstConsume).toBeGreaterThan(afterRaw); // au SUCCÈS de l'appel
  });

  it("botEngine (DM) et ai.ts : quota consommé après la réponse obtenue", () => {
    const engine = read("src/bot/botEngine.ts");
    expect(engine.indexOf("consumeAIQuota(actualSenderJid);")).toBeGreaterThan(
      engine.indexOf('const answer = await withAIConcurrency')
    );
    const ai = read("src/bot/commands/ai.ts");
    expect(ai.indexOf("consumeAIQuota(context.sender);")).toBeGreaterThan(
      ai.indexOf("const answer = await withAIConcurrency")
    );
  });

  it("trace : élagage des cooldowns expirés (le clear() brutal est parti)", () => {
    const src = read("src/bot/commands/trace.ts");
    expect(src).not.toContain("lastCallByUser.clear()");
    expect(src).toContain("lastCallByUser.delete(k)");
  });
});

describe("9.19n #5 — .img en préfixe passe par le RoleGuard", () => {
  it("politique de groupe memberDeny img → refusé, SANS recherche d'image", async () => {
    setGroupPolicy(GID, { memberDeny: ["img"] });
    const sock = { sendMessage: vi.fn(async (_jid: string, _payload: any) => ({})) };

    const out = await dispatchBotCommand(sock, groupMsg(), groupInfo(), "img", ["ciel"], "prefix");

    expect(out.denied).toBe(true);
    expect(mFind).not.toHaveBeenCalled(); // aucune recherche lancée
    const sent = String(sock.sendMessage.mock.calls[0]?.[1]?.text || "");
    expect(sent).toContain("Access Denied");
  });

  it("sans politique restrictive → la recherche part normalement (pas de régression)", async () => {
    const sock = { sendMessage: vi.fn(async (_jid: string, _payload: any) => ({})) };
    const out = await dispatchBotCommand(sock, groupMsg(), groupInfo(), "img", ["ciel"], "prefix");
    expect(out.denied).toBe(false);
    expect(mFind).toHaveBeenCalledTimes(1);
  });

  it("l'owner n'est jamais bloqué par une politique de groupe", async () => {
    setGroupPolicy(GID, { memberDeny: ["img"] });
    const info = { ...groupInfo(), isOwner: true };
    const sock = { sendMessage: vi.fn(async (_jid: string, _payload: any) => ({})) };
    const out = await dispatchBotCommand(sock, groupMsg(), info, "img", ["ciel"], "prefix");
    expect(out.denied).toBe(false);
    expect(mFind).toHaveBeenCalledTimes(1);
  });
});
