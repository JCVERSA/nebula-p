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
vi.mock("../src/bot/services/animeChoices.js", () => ({
  getAnimeChoiceContext: vi.fn(() => null)
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
import { getAnimeChoiceContext } from "../src/bot/services/animeChoices.js";

const mAI = vi.mocked(generateTextWithFallback);
const mChoices = vi.mocked(getAnimeChoiceContext);
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

const mkExec = (over: Partial<{ ok: boolean; denied: boolean; hadError: boolean; lastText: string; vfFallbackHint: boolean }> = {}) =>
  vi.fn(async () => ({ ok: true, denied: false, hadError: false, lastText: "", vfFallbackHint: false, ...over }));

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

describe("8.94 — bascule de catalogue anime (hint « autre catalogue »)", () => {
  it("VF absente sur le catalogue courant (va par défaut) → offre déterministe .a as, puis OK exécute", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"anime","args":"tokyo ghoul s2 e1"}');
    const ctx = mk("tokyo ghoul saison 2 en français");
    const exec = mkExec({ vfFallbackHint: true, lastText: "🎬 Choix de la Résolution" });
    await run(ctx, exec);
    expect(exec).toHaveBeenCalledTimes(1); // la commande a tourné (VOSTFR listé)

    const offer = texts(ctx.sent).at(-1)!;
    expect(offer).toContain(".a as tokyo ghoul s2 e1");
    expect(offer).toContain("OK");
    expect(offer).toContain("VOSTFR"); // le bot a déjà proposé la suite

    await run(ctx, exec, "ok");
    expect(exec).toHaveBeenLastCalledWith("anime", ["as", "tokyo", "ghoul", "s2", "e1"], "agent");
  });

  it("lancé sur va explicite → le retry passe sur le catalogue complet (as)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"anime","args":"va tokyo ghoul vostfr"}');
    const ctx = mk("tokyo ghoul en vostfr");
    const exec = mkExec({ vfFallbackHint: true, hadError: true, lastText: "❌ Aucun VOSTFR pour ce titre sur ce catalogue." });
    await run(ctx, exec);
    const offer = texts(ctx.sent).at(-1)!;
    expect(offer).toContain(".a as tokyo ghoul vostfr");
    expect(mAI).toHaveBeenCalledTimes(1); // offre déterministe : aucun appel IA de plus
  });

  it("lancé sur as explicite → le retry revient au défaut nu (va)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"anime","args":"as tokyo ghoul"}');
    const ctx = mk("tokyo ghoul");
    const exec = mkExec({ vfFallbackHint: true, hadError: true, lastText: "❌ Aucun VF pour ce titre sur ce catalogue." });
    await run(ctx, exec);
    const offer = texts(ctx.sent).at(-1)!;
    expect(offer).toContain(".a tokyo ghoul");
    expect(offer).not.toContain(".a as tokyo ghoul");
    expect(offer).not.toContain(".a va tokyo ghoul");
  });

  it("hint sur une commande non-anime → ignoré (pas d'offre)", async () => {
    mAI.mockResolvedValueOnce('{"action":"execute","command":"song","args":"test"}');
    const ctx = mk("la musique de test");
    const exec = mkExec({ vfFallbackHint: true });
    await run(ctx, exec);
    expect(texts(ctx.sent).length).toBe(0); // rien de plus que le say (absent ici)
  });
});

describe("8.97 — mémoire des choix interactifs (injection agent)", () => {
  it("l'historique anime du chat part dans le prompt système de l'IA", async () => {
    mChoices.mockReturnValueOnce(
      "[Historique anime — dernier téléchargement de ce chat, il y a 3 h]\nTitre : Tokyo Ghoul · Langue : VOSTFR · dernier épisode : 7"
    );
    mAI.mockResolvedValueOnce('{"action":"reply","text":"ok"}');
    const ctx = mk("télécharge le même anime");
    await run(ctx, mkExec());
    expect(mAI).toHaveBeenCalledTimes(1);
    expect(mAI.mock.calls[0][1]).toContain("Historique anime");
    expect(mAI.mock.calls[0][1]).toContain("Tokyo Ghoul");
    expect(mAI.mock.calls[0][1]).toContain("dernier épisode : 7");
  });

  it("sans historique, le prompt reste sans bloc (pas de bruit)", async () => {
    mAI.mockResolvedValueOnce('{"action":"reply","text":"ok"}');
    const ctx = mk("bonjour");
    await run(ctx, mkExec());
    expect(mAI.mock.calls[0][1]).not.toContain("Historique anime");
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
