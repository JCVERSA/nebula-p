import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.18uuuu — outil interne Nova `img` (agentRunner) : interception AVANT le
 * lookup registre (pas une commande utilisateur), envoi jusqu'à 6 images,
 * quota web partagé, repli honnête « donne un lien → .dl ». Toutes les
 * dépendances (IA, registre, quota, imageFinder) sont mockées.
 */

vi.mock("../src/bot/geminiClient.js", () => ({
  isAIConfigured: vi.fn(() => true),
  generateTextWithFallback: vi.fn(),
  getPrimaryAIEngine: vi.fn(() => "nim"),
}));
vi.mock("../src/bot/services/agentMetrics.js", () => ({
  recordAgentTurn: vi.fn(),
}));
vi.mock("../src/bot/commandRegistry.js", () => ({
  getCommand: vi.fn(),
  suggestClosestCommand: vi.fn(() => null),
}));
vi.mock("../src/bot/persona.js", () => ({
  getPersonaPrompt: vi.fn(() => "PERSONA"),
}));
vi.mock("../src/bot/aiQuota.js", () => ({
  checkAIQuota: vi.fn((): any => ({ allowed: true })),
  consumeAIQuota: vi.fn(),
  withAIConcurrency: vi.fn((fn: () => any) => fn()),
}));
vi.mock("../src/bot/auditTrail.js", () => ({
  recordAudit: vi.fn(),
}));
vi.mock("../src/bot/services/animeChoices.js", () => ({
  getAnimeChoiceContext: vi.fn(() => null),
  messageSuggestsAnimeHistory: vi.fn(() => false),
  getAnimeChoice: vi.fn(() => null),
}));
vi.mock("../src/bot/services/ttsService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/services/ttsService.js")>();
  return { ...actual, synthesizeVoiceNote: vi.fn(async () => Buffer.from("OGG-AUDIO")) };
});
vi.mock("../src/bot/services/voiceModeStore.js", () => ({
  isVoiceModeEnabled: vi.fn(() => false),
  setVoiceMode: vi.fn(),
}));
vi.mock("../src/bot/services/userPreferences.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/services/userPreferences.js")>();
  return {
    ...actual,
    getChatPreference: vi.fn(() => null),
    setChatPreference: vi.fn(() => true),
    clearChatPreference: vi.fn(() => true),
  };
});
vi.mock("../src/bot/services/aiMemory.js", () => ({
  getMemoryContext: vi.fn(() => null),
  recordExchange: vi.fn(),
  compactIfNeeded: vi.fn(async () => {}),
  defaultMemorySummarizer: vi.fn(),
}));
vi.mock("../src/bot/commandKnowledge.js", () => ({
  buildAgentKnowledge: vi.fn(() => "KNOWLEDGE"),
}));
// 9.18uuuu : le chercheur d'images est mocké (réseau absent du sandbox).
vi.mock("../src/bot/services/imageFinder.js", () => ({
  findImageCandidates: vi.fn(),
  downloadImageCandidate: vi.fn(),
  IMAGE_SEND_LIMIT: 6,
}));
vi.mock("../src/bot/webQuota.js", () => ({
  checkWebQuota: vi.fn((): any => ({ allowed: true, limit: 20 })),
  consumeWebQuota: vi.fn(),
  getWebQuotaUsage: vi.fn(() => ({ used: 0, limit: 20 })),
  resetWebQuota: vi.fn(() => false),
}));

import { handleAgentMessage } from "../src/bot/services/agentRunner.js";
import { generateTextWithFallback } from "../src/bot/geminiClient.js";
import { findImageCandidates, downloadImageCandidate } from "../src/bot/services/imageFinder.js";
import { consumeWebQuota, checkWebQuota } from "../src/bot/webQuota.js";
import { __resetAgentStateForTests } from "../src/bot/services/agentBrain.js";
import { __resetObservationsForTests, getLastObservation } from "../src/bot/services/agentObservation.js";

const mAI = vi.mocked(generateTextWithFallback);
const mFind = vi.mocked(findImageCandidates);
const mDownload = vi.mocked(downloadImageCandidate);
const mConsume = vi.mocked(consumeWebQuota);
const mWebQuota = vi.mocked(checkWebQuota);

const JID = "1555999111222@s.whatsapp.net";

function mk(text: string) {
  const sent: any[] = [];
  const sock = {
    sendMessage: vi.fn(async (_to: string, payload: any) => {
      sent.push(payload);
      return {};
    }),
    sendPresenceUpdate: vi.fn(async () => {}),
  };
  const msg = { key: { remoteJid: JID } };
  const info = {
    senderJid: JID,
    actorJid: JID,
    actorNumber: "1555999111222",
    senderName: "Tester",
    isOwner: false,
    text,
    botName: "Nebula",
    prefix: ".",
  };
  return { sock, msg, info, sent };
}

const run = (ctx: ReturnType<typeof mk>, exec: any, text?: string) =>
  handleAgentMessage(ctx.sock, ctx.msg, { ...ctx.info, text: text ?? ctx.info.text }, exec);

const mkExec = () => vi.fn(async () => ({ ok: true, denied: false, hadError: false, lastText: "", vfFallbackHint: false, texts: [] as string[] }));

const IMG_DECISION = JSON.stringify({ action: "execute", command: "img", args: "Jungkook", say: "🔎 Je cherche des photos de Jungkook…" });

beforeEach(() => {
  vi.clearAllMocks();
  mWebQuota.mockReturnValue({ allowed: true, limit: 20 } as any);
  __resetAgentStateForTests();
  __resetObservationsForTests();
});

describe("9.18uuuu — outil interne img : interception, envoi, honnêteté", () => {
  it("« envoie-moi une photo de Jungkook » → images envoyées avec légende source (sans commande registre)", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockResolvedValueOnce({
      candidates: [
        { url: "https://upload.wikimedia.org/jk.jpg", source: "wikipedia", attribution: "Wikipédia" },
        { url: "https://cdn.pinimg.com/jk.jpg", source: "web", attribution: "pinimg.com" },
      ],
      engines: ["wikipédia", "images web"],
    });
    mDownload.mockImplementation(async (url: string) =>
      url.includes("wikimedia") ? { buffer: Buffer.from("JPEG1"), ext: "jpg" } : { buffer: Buffer.from("JPEG2"), ext: "jpg" });
    const ctx = mk("envoie moi une photo de Jungkook stp");
    await run(ctx, mkExec());

    const images = ctx.sent.filter((p) => p.image);
    expect(images).toHaveLength(2);
    expect(images[0].image).toEqual(Buffer.from("JPEG1"));
    expect(images[0].caption).toContain("Jungkook");
    expect(images[0].caption).toContain("Wikipédia");
    expect(images[1].caption).toContain("pinimg.com");
    expect(images[1].caption).toContain("2/2");
    // Le quota web (partagé .search/.fetch/.wiki) est consommé UNE fois, au succès.
    expect(mConsume).toHaveBeenCalledTimes(1);
    // L'observation du tour est enregistrée (le tour suivant saura).
    expect(getLastObservation(JID)?.command).toBe("img");
  });

  it("plafonne à IMAGE_SEND_LIMIT (6) même si le moteur en propose plus", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockResolvedValueOnce({
      candidates: Array.from({ length: 10 }, (_, i) => ({
        url: `https://x.org/${i}.jpg`,
        source: "web" as const,
        attribution: "x.org",
      })),
      engines: ["images web"],
    });
    mDownload.mockResolvedValue({ buffer: Buffer.from("J"), ext: "jpg" });
    const ctx = mk("photo de Jungkook");
    await run(ctx, mkExec());
    expect(ctx.sent.filter((p) => p.image)).toHaveLength(6);
    expect(mDownload).toHaveBeenCalledTimes(6);
  });

  it("zéro candidat → message honnête avec le repli .dl, aucune image", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockResolvedValueOnce({ candidates: [], engines: [] });
    const ctx = mk("envoie moi une photo de Jungkook");
    await run(ctx, mkExec());
    const texts = ctx.sent.map((p) => p.text).filter(Boolean).join("\n");
    expect(ctx.sent.filter((p) => p.image)).toHaveLength(0);
    expect(texts).toContain("Aucune image trouvée");
    expect(texts).toContain(".dl");
    expect(mConsume).not.toHaveBeenCalled();
  });

  it("images trouvées mais introuvables au téléchargement → honnête, pas d'envoi vide", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockResolvedValueOnce({
      candidates: [{ url: "https://x.org/dead.jpg", source: "web", attribution: "x.org" }],
      engines: ["images web"],
    });
    mDownload.mockResolvedValue(null);
    const ctx = mk("photo de Jungkook");
    await run(ctx, mkExec());
    const texts = ctx.sent.map((p) => p.text).filter(Boolean).join("\n");
    expect(ctx.sent.filter((p) => p.image)).toHaveLength(0);
    expect(texts).toContain("n'ont pas pu être téléchargées");
    expect(texts).toContain(".dl");
  });

  it("une image ratée n'arrête pas les autres (envoi partiel OK)", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockResolvedValueOnce({
      candidates: [
        { url: "https://x.org/a.jpg", source: "web", attribution: "x.org" },
        { url: "https://x.org/b.jpg", source: "web", attribution: "x.org" },
        { url: "https://x.org/c.jpg", source: "web", attribution: "x.org" },
      ],
      engines: ["images web"],
    });
    mDownload.mockImplementation(async (url: string) => (url.includes("b.jpg") ? null : { buffer: Buffer.from("J"), ext: "jpg" }));
    const ctx = mk("photo de Jungkook");
    const sockSend = vi.fn(async (_to: string, payload: any) => {
      ctx.sent.push(payload);
      return {};
    });
    ctx.sock.sendMessage = sockSend;
    await run(ctx, mkExec());
    const payloads = sockSend.mock.calls.map((c) => c[1]);
    expect(payloads.filter((p) => p.image)).toHaveLength(2);
  });

  it("args vides → rappel d'usage, aucune recherche", async () => {
    mAI.mockResolvedValueOnce(JSON.stringify({ action: "execute", command: "img", args: "" }));
    const ctx = mk("envoie une photo");
    await run(ctx, mkExec());
    const texts = ctx.sent.map((p) => p.text).filter(Boolean).join("\n");
    expect(texts).toContain("Donne-moi un sujet");
    expect(mFind).not.toHaveBeenCalled();
  });

  it("quota web épuisé → refus honnête AVANT la recherche", async () => {
    mWebQuota.mockReturnValue({ allowed: false, limit: 20 } as any);
    mAI.mockResolvedValueOnce(IMG_DECISION);
    const ctx = mk("photo de Jungkook");
    await run(ctx, mkExec());
    const texts = ctx.sent.map((p) => p.text).filter(Boolean).join("\n");
    expect(texts).toContain("Limite web du jour atteinte");
    expect(mFind).not.toHaveBeenCalled();
  });

  it("findImageCandidates en panne → dégradation honnête, jamais de crash", async () => {
    mAI.mockResolvedValueOnce(IMG_DECISION);
    mFind.mockRejectedValueOnce(new Error("boom réseau"));
    const ctx = mk("photo de Jungkook");
    await run(ctx, mkExec());
    const texts = ctx.sent.map((p) => p.text).filter(Boolean).join("\n");
    expect(texts).toContain("La recherche d'images a échoué");
    expect(texts).toContain(".dl");
  });
});
