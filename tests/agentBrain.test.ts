import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_DENYLIST,
  checkAgentBudget,
  clearPendingConfirmation,
  isAgentDeniedCommand,
  isConfirmationAffirmative,
  isHeavyAgentCommand,
  parseAgentDecision,
  parseAgentFix,
  peekPendingConfirmation,
  recordAgentExecution,
  __resetAgentStateForTests,
  setPendingConfirmation,
  takePendingConfirmation
} from "../src/bot/services/agentBrain.js";

/**
 * 8.93 — cerveau agent : parsing zéro confiance, denylist, table de risque,
 * budget 10/h, confirmations fail-closed. Tout est pur (aucun réseau).
 */

beforeEach(() => {
  __resetAgentStateForTests();
});

describe("8.93 — parseAgentDecision (contrat JSON strict)", () => {
  it("accepte un JSON propre", () => {
    const d = parseAgentDecision('{"action":"execute","command":"gce","args":"a bio 2023 2","say":"Je cherche."}');
    expect(d).toEqual({ action: "execute", command: "gce", args: "a bio 2023 2", say: "Je cherche." });
  });

  it("tolère les fences ```json et le texte parasite", () => {
    const d = parseAgentDecision('Voici ma décision :\n```json\n{"action":"reply","text":"Salut !"}\n```\nBonne journée');
    expect(d).toEqual({ action: "reply", text: "Salut !" });
  });

  it("demandes ask/reply exigent un texte", () => {
    expect(parseAgentDecision('{"action":"ask","text":"Quelle année ?"}')).toEqual({ action: "ask", text: "Quelle année ?" });
    expect(parseAgentDecision('{"action":"ask"}')).toBeNull();
    expect(parseAgentDecision('{"action":"reply","text":""}')).toBeNull();
  });

  it("rejette commande invalide (préfixe, vide, caractères)", () => {
    expect(parseAgentDecision('{"action":"execute","command":".gce","args":"x"}')).toBeNull();
    expect(parseAgentDecision('{"action":"execute","command":"","args":"x"}')).toBeNull();
    expect(parseAgentDecision('{"action":"execute","command":"gc e","args":"x"}')).toBeNull();
  });

  it("rejette action inconnue et JSON cassé", () => {
    expect(parseAgentDecision('{"action":"delete","command":"gce"}')).toBeNull();
    expect(parseAgentDecision("je ne peux pas faire ça désolé")).toBeNull();
    expect(parseAgentDecision('{"action":"execute","command":"gce"')).toBeNull();
    expect(parseAgentDecision("")).toBeNull();
  });

  it("args non-chaîne → chaîne vide ; say optionnel", () => {
    const d = parseAgentDecision('{"action":"execute","command":"menu","args":123}');
    expect(d).toEqual({ action: "execute", command: "menu", args: "", say: undefined });
  });
});

describe("8.93 — denylist (l'IA ne s'invoque jamais)", () => {
  it("agent et ai sont interdits, gce non", () => {
    expect(isAgentDeniedCommand("agent")).toBe(true);
    expect(isAgentDeniedCommand("ai")).toBe(true);
    expect(AGENT_DENYLIST.has("gce")).toBe(false);
    expect(isAgentDeniedCommand("GCE")).toBe(false);
  });
});

describe("8.93 — table de risque (léger direct, lourd confirmé)", () => {
  it("purge et watch sont toujours lourdes", () => {
    expect(isHeavyAgentCommand({ name: "purge" }, [])).toBe(true);
    expect(isHeavyAgentCommand({ name: "watch" }, ["jjk"])).toBe(true);
  });

  it("commandes owner-only/admin-only = lourdes", () => {
    expect(isHeavyAgentCommand({ name: "reset", ownerOnly: true }, [])).toBe(true);
    expect(isHeavyAgentCommand({ name: "promote", adminOnly: true }, [])).toBe(true);
  });

  it("anime multi-épisodes = lourd ; épisode unique = léger", () => {
    expect(isHeavyAgentCommand({ name: "anime" }, ["jjk", "s3", "all"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "anime" }, ["jjk", "s3", "1-5"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "anime" }, ["jjk", "s3", "2,5"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "anime" }, ["jjk", "s3", "d-"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "anime" }, ["jjk", "s3", "ep6"])).toBe(false);
  });

  it("commandes usuelles = légères", () => {
    expect(isHeavyAgentCommand({ name: "gce" }, ["a", "bio", "2023", "1,3"])).toBe(false);
    expect(isHeavyAgentCommand({ name: "song" }, ["test"])).toBe(false);
    expect(isHeavyAgentCommand({ name: "define" }, ["xénophile"])).toBe(false);
  });
});

describe("8.93 — budget d'exécutions (10/heure)", () => {
  it("libre jusqu'à 10 puis refusé ; la fenêtre glisse", () => {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) recordAgentExecution("u1", t0);
    expect(checkAgentBudget("u1", t0)).toBe(false);
    expect(checkAgentBudget("u2", t0)).toBe(true); // par utilisateur
    expect(checkAgentBudget("u1", t0 + 61 * 60 * 1000)).toBe(true); // 1 h plus tard
  });
});

describe("8.93 — confirmations en attente (fail-closed, TTL 2 min)", () => {
  it("set / peek / take", () => {
    setPendingConfirmation("u1", { command: "purge", args: [] });
    expect(peekPendingConfirmation("u1")?.command).toBe("purge");
    const taken = takePendingConfirmation("u1");
    expect(taken?.command).toBe("purge");
    expect(peekPendingConfirmation("u1")).toBeNull(); // consommée
  });

  it("expirée après 2 minutes", () => {
    const t0 = Date.now();
    setPendingConfirmation("u1", { command: "purge", args: [] }, t0);
    expect(peekPendingConfirmation("u1", t0 + 119_000)).not.toBeNull();
    expect(peekPendingConfirmation("u1", t0 + 121_000)).toBeNull();
  });

  it("clear explicite", () => {
    setPendingConfirmation("u1", { command: "watch", args: ["jjk"] });
    clearPendingConfirmation("u1");
    expect(peekPendingConfirmation("u1")).toBeNull();
  });
});

describe("8.93 — isConfirmationAffirmative (seul un OK explicite exécute)", () => {
  it("accepte les formes affirmatives", () => {
    for (const t of ["ok", "OK !", "Ok.", "oui", "OUI", "yes", "go", "vas-y", "confirme", "exécute", "fais-le", "c'est parti"]) {
      expect(isConfirmationAffirmative(t), t).toBe(true);
    }
  });

  it("refuse tout le reste (fail-closed)", () => {
    for (const t of ["non", "peut-être", "ok mais attends", "pourquoi ?", "a bio 2023", "", "okkkk"]) {
      expect(isConfirmationAffirmative(t), t).toBe(false);
    }
  });
});

describe("8.93 — parseAgentFix (rattrapage)", () => {
  it("accepte say + offer, et offer null", () => {
    const f = parseAgentFix('{"say":"Le site est down.","offer":{"command":"gce","args":"a bio 2023 2"}}');
    expect(f).toEqual({ say: "Le site est down.", offer: { command: "gce", args: "a bio 2023 2" } });
    expect(parseAgentFix('{"say":"Rien à proposer.","offer":null}')?.offer).toBeNull();
  });

  it("rejette sans say, ou JSON cassé (l'erreur reste visible, pas de bruit)", () => {
    expect(parseAgentFix('{"offer":null}')).toBeNull();
    expect(parseAgentFix("désolé je ne sais pas")).toBeNull();
  });
});
