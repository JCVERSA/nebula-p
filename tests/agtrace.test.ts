import { beforeEach, describe, expect, it, vi } from "vitest";

/** 9.18eeee (A6) — .agtrace : trace de décision agent (owner, dry-run). */
vi.mock("../src/bot/geminiClient.js", () => ({
  generateTextWithFallback: vi.fn(),
  isAIConfigured: vi.fn(() => true),
}));

import agtraceCommand from "../src/bot/commands/agtrace.js";
import { generateTextWithFallback } from "../src/bot/geminiClient.js";
import { initRegistry } from "../src/bot/commandRegistry.js";
import { beforeAll } from "vitest";

const mAI = vi.mocked(generateTextWithFallback);

function mkCtx(over: Record<string, unknown> = {}) {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      isOwner: true,
      args: ["télécharge", "one", "piece"],
      prefix: ".",
      reply: async (t: string) => {
        replies.push(t);
      },
      react: vi.fn(async () => {}),
      ...over,
    },
  };
}

beforeAll(async () => {
  await initRegistry(); // résolution réelle des commandes pour le verdict
});

beforeEach(() => {
  vi.clearAllMocks();
  mAI.mockResolvedValue(JSON.stringify({ action: "execute", command: "anime", args: "one piece" }));
});

describe("9.18eeee (A6) — .agtrace (owner, dry-run)", () => {
  it("owner + décision valide → trace complète : brut, décision parsée, verdict, AUCUNE exécution", async () => {
    const { replies, ctx } = mkCtx();
    await agtraceCommand.execute!({} as any, { key: { remoteJid: "c@s.whatsapp.net" } } as any, ctx as any);
    expect(replies.length).toBe(1);
    const out = replies[0];
    expect(out).toContain("AGTRACE — dry-run, RIEN n'a été exécuté");
    expect(out).toContain("télécharge one piece");
    expect(out).toContain('"command":"anime"');
    expect(out).toContain("Nova exécuterait");
    expect(mAI).toHaveBeenCalledTimes(1);
  });

  it("réponse hors contrat → décision NULL documentée (pas d'exécution, pas de crash)", async () => {
    mAI.mockResolvedValue("désolé je ne sais pas");
    const { replies, ctx } = mkCtx();
    await agtraceCommand.execute!({} as any, { key: { remoteJid: "c@s.whatsapp.net" } } as any, ctx as any);
    expect(replies[0]).toContain("NULL");
  });

  it("non-owner → refus ; sans args → usage ; IA absente → honnête", async () => {
    const nonOwner = mkCtx({ isOwner: false });
    await agtraceCommand.execute!({} as any, { key: { remoteJid: "c@s.whatsapp.net" } } as any, nonOwner.ctx as any);
    expect(nonOwner.replies[0]).toContain("réservée à l'owner");

    const noArgs = mkCtx({ args: [] });
    await agtraceCommand.execute!({} as any, { key: { remoteJid: "c@s.whatsapp.net" } } as any, noArgs.ctx as any);
    expect(noArgs.replies[0]).toContain("agtrace");

    const { isAIConfigured } = await import("../src/bot/geminiClient.js");
    vi.mocked(isAIConfigured).mockReturnValueOnce(false);
    const noAI = mkCtx();
    await agtraceCommand.execute!({} as any, { key: { remoteJid: "c@s.whatsapp.net" } } as any, noAI.ctx as any);
    expect(noAI.replies[0]).toContain("IA n'est pas configurée");
  });
});
