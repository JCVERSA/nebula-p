import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 8.93 — orchestrateur agent : décision IA → exécution aux droits de
 * l'utilisateur, confirmations fail-closed, dégradation, rattrapage unique.
 * Toutes les dépendances (IA, quota, registre, mémoire) sont mockées.
 */
vi.mock("../src/bot/geminiClient.js", () => ({
  isAIConfigured: vi.fn(() => true),
  generateTextWithFallback: vi.fn(),
}));
vi.mock("../src/bot/commandRegistry.js", () => ({
  getCommand: vi.fn(),
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
vi.mock("../src/bot/services/aiMemory.js", () => ({
  getMemoryContext: vi.fn(() => null),
  recordExchange: vi.fn(),
  compactIfNeeded: vi.fn(async () => {}),
  defaultMemorySummarizer: vi.fn(),
}));
vi.mock("../src/bot/commandKnowledge.js", () => ({
  buildAgentKnowledge: vi.fn(() => "KNOWLEDGE"),
}));

import { handleAgentMessage } from "../src/bot/services/agentRunner.js";
import { generateTextWithFallback, isAIConfigured } from "../src/bot/geminiClient.js";
import { getCommand } from "../src/bot/commandRegistry.js";
import { checkAIQuota } from "../src/bot/aiQuota.js";
import { recordAgentExecution, __resetAgentStateForTests } from "../src/bot/services/agentBrain.js";

const mAI = vi.mocked(generateTextWithFallback);
const mConfigured = vi.mocked(isAIConfigured);
const mGetCommand = vi.mocked(getCommand);
const mQuota = vi.mocked(checkAIQuota);

const COMMANDS: Record<string, any> = {
  gce: { name: "gce", category: "Tools" },
  song: { name: "song" },
  anime: { name: "anime" },
  purge: { name: "purge" },
  watch: { name: "watch" },
  ai: { name: "ai" },
  menu: { name: "menu" },
};

const JID = "237999111222@s.whatsapp.net";

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
    actorNumber: "237999111222",
    senderName: "Tester",
    isOwner: false,
    text,
    botName: "Nebula",
    prefix: ".",
  };
  return { sock, msg, info, sent };
}

const mkExec = (over: Partial<{ ok: boolean; denied: boolean; hadError: boolean; lastText: string }> = {}) =>
  vi.fn(async () => ({ ok: true, denied: false, hadError: false, lastText: "", ...over }));

const texts = (sent: any[]) => sent.map((p) => p.text);
const run = (ctx: ReturnType<typeof mk>, exec: any, text?: string) =>
  handleAgentMessage(ctx.sock, ctx.msg, { ...ctx.info, text: text ?? ctx.info.text }, exec);

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentStateForTests();
  mConfigured.mockReturnValue(true);
  mQuota.mockReturnValue({ allowed: true } as any);
  mGetCommand.mockImplementation(((n: string) => COMMANDS[n]) as any);
});

describe("8.93 — décisions de l'agent", () => {
  it("execute léger : traduit, annonce puis exécute aux droits de l'utilisateur", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"gce","args":"a bio 2023 2","say":"📄 Je cherche ça…"}');
    const ctx = mk("passe-moi les annales de bio A/L 2023 papier 2");
    const exec = mkExec();
    const handled = await run(ctx, exec);
    expect(handled).toBe(true);
    expect(exec).toHaveBeenCalledWith("gce", ["a", "bio", "2023", "2"], "agent");
    expect(texts(ctx.sent)[0]).toContain("Je cherche ça");
  });

  it("ask : pose UNE question au lieu d'exécuter à l'aveugle", async () => {
    mAI.mockResolvedValueOnce('{"action":"ask","text":"Quelle année, et O/L ou A/L ?"}');
    const ctx = mk("passe-moi les annales de bio");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("Quelle année");
  });

  it("reply : conversation normale, aucune commande", async () => {
    mAI.mockResolvedValueOnce('{"action":"reply","text":"Salut ! Je vais bien et toi ?"}');
    const ctx = mk("salut ça va ?");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("Salut");
  });
});

describe("8.93 — commandes lourdes : confirmation fail-closed", () => {
  it("purge → demande OK avant d'exécuter, puis OK exécute", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"purge","args":"","say":"Je vais purger."}');
    const ctx = mk("purge l'espace disque");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    const confirmMsg = texts(ctx.sent)[0];
    expect(confirmMsg).toContain("OK");
    expect(confirmMsg).toContain(".purge");

    const handled = await run(ctx, exec, "OK");
    expect(handled).toBe(true);
    expect(exec).toHaveBeenCalledWith("purge", [], "agent");
  });

  it("anime multi-épisodes = lourd ; un refus implicite annule (fail-closed)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"anime","args":"jjk s3 1-5","say":"Big download."}');
    const ctx = mk("télécharge jjk s3 épisodes 1 à 5");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("OK");

    // « non » remplace la demande — rien ne s'exécute…
    await run(ctx, exec, "non");
    expect(exec).not.toHaveBeenCalled();
    // …et un OK tardif ne ressuscite pas la demande expirée
    await run(ctx, exec, "ok");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("8.93 — validation locale zéro confiance", () => {
  it("denylist : l'IA ne peut pas invoquer .ai (boucle)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"ai","args":"hello"}');
    const ctx = mk("demande à l'ia");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0].toLowerCase()).toContain("je ne peux pas");
  });

  it("commande inconnue : réponse honnête, pas d'invention", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"foobar","args":"x"}');
    const ctx = mk("traduis en wolof");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0].toLowerCase()).toContain("je n'ai pas de commande");
  });
});

describe("8.93 — dégradation (leçon Laudacode : degrades, never aborts)", () => {
  it("JSON invalide → relance en mode guidage classique, jamais de silence", async () => {
    mAI
      .mockResolvedValueOnce("Désolé je ne comprends pas le format JSON demandé.")
      .mockResolvedValueOnce("Tape `.gce a bio 2023 2` pour avoir tes annales 🙂");
    const ctx = mk("les annales de bio");
    const exec = mkExec();
    const handled = await run(ctx, exec);
    expect(handled).toBe(true);
    expect(mAI).toHaveBeenCalledTimes(2);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("Tape");
  });

  it("IA down → même message honnête que le chat DM actuel", async () => {
    mAI.mockRejectedValueOnce(new Error("both providers down"));
    const ctx = mk("coucou");
    const exec = mkExec();
    const handled = await run(ctx, exec);
    expect(handled).toBe(true);
    expect(texts(ctx.sent)[0]).toContain("indisponible");
  });

  it("IA non configurée → renvoie false (le chemin normal gère)", async () => {
    mConfigured.mockReturnValue(false);
    const ctx = mk("coucou");
    const exec = mkExec();
    const handled = await run(ctx, exec);
    expect(handled).toBe(false);
    expect(mAI).not.toHaveBeenCalled();
  });
});

describe("8.93 — rattrapage unique après erreur de commande", () => {
  it("erreur visible + explication IA + commande corrigée en attente d'OK", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"gce","args":"a bio 2023 9","say":"Je cherche."}');
    mAI.mockResolvedValueOnce('{"say":"Le papier 9 nexiste pas pour 2023.","offer":{"command":"gce","args":"a bio 2023 2"}}');
    const ctx = mk("les annales de bio 2023 papier 9");
    const exec = mkExec({ hadError: true, lastText: "❌ juin 2023 · Paper 9 : pas encore publié." });
    await run(ctx, exec);
    expect(exec).toHaveBeenCalledTimes(1);
    const recovery = texts(ctx.sent).at(-1)!;
    expect(recovery).toContain("Le papier 9 nexiste pas");
    expect(recovery).toContain("OK");

    // La commande corrigée attend elle aussi un OK explicite
    await run(ctx, exec, "ok");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenLastCalledWith("gce", ["a", "bio", "2023", "2"], "agent");
  });

  it("refus RoleGuard : aucun rattrapage (l'erreur ⛔ est déjà claire)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"purge","args":""}');
    const ctx = mk("purge");
    const exec = mkExec();
    await run(ctx, exec); // confirmation lourde
    await run(ctx, exec, "ok"); // exécution → refusée
    // exec a renvoyé denied via le mock ? Non : le mock renvoie ok — on
    // simule directement le cas denied :
    const execDenied = mkExec({ denied: true, hadError: true, lastText: "⛔ Access Denied." });
    mAI.mockResolvedValueOnce('{"action":"execute","command":"watch","args":"jjk"}');
    await run(ctx, execDenied); // watch = lourd → confirmation
    await run(ctx, execDenied, "oui");
    expect(execDenied).toHaveBeenCalledTimes(1);
    expect(mAI).toHaveBeenCalledTimes(2); // décision initiale seulement, pas de rattrapage
  });
});

describe("8.93 — quotas et plafonds", () => {
  it("quota IA dépassé → message, aucun appel IA", async () => {
    mQuota.mockReturnValue({ allowed: false, error: "Limite IA quotidienne atteinte (40)." } as any);
    const ctx = mk("les annales de bio");
    const exec = mkExec();
    const handled = await run(ctx, exec);
    expect(handled).toBe(true);
    expect(mAI).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("Limite IA");
  });

  it("plafond agent (10/h) dépassé → message, pas d'exécution", async () => {
    for (let i = 0; i < 10; i++) recordAgentExecution(JID);
    mAI.mockResolvedValueOnce('{"action":"execute","command":"gce","args":"a bio 2023 2"}');
    const ctx = mk("les annales de bio 2023");
    const exec = mkExec();
    await run(ctx, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(texts(ctx.sent)[0]).toContain("beaucoup d'actions");
  });
});
