import { beforeEach, describe, expect, it } from "vitest";
import { buildCommandKnowledge } from "../src/bot/commandKnowledge.js";
import { getPersonaPrompt } from "../src/bot/persona.js";
import { registerCommand, removeCommand } from "../src/bot/commandRegistry.js";
import type { BotCommand } from "../src/bot/types.js";

/**
 * 8.79 — connaissance des commandes dans le harnais IA.
 *
 * Décisions owner : (1) construction hybride — fiche .a rédigée à la main +
 * liste auto-générée depuis le registre (synchro à vie, commandes du panneau
 * incluses) ; (2) IA proactive — elle oriente vers la commande exacte ;
 * (3) fiche .a complète (flux pas-à-pas + astuces) ; (4) le bloc est
 * TOUJOURS injecté, même avec un persona personnalisé.
 */

beforeEach(() => {
  delete process.env.NEBULA_AI_PERSONALITY;
});

describe("commandKnowledge — fiche .a (statique)", () => {
  it("décrit le flux interactif complet avec la vraie syntaxe", () => {
    const k = buildCommandKnowledge(".");
    for (const expected of [
      "# Tes commandes",
      ".a solo leveling",
      ".a 1",
      ".a <titre> vostfr",
      ".a s1",
      ".a s1 d-",
      ".a e2,e5,e9",
      ".a 1-5",
      ".a r <numéro>",
      ".a jjk s3 ep6 r2",
      ".a jjk s3 all r2",
      ".a va <titre>",
      "12 épisodes",
      "Tout télécharger",
      "2 h",
      ".w <titre>",
      "alias .anime, .nv",
    ]) {
      expect(k).toContain(expected);
    }
  });

  it("raconte des règles de guidage proactives mais honnêtes", () => {
    const k = buildCommandKnowledge(".");
    expect(k).toContain("Tu ne peux pas agir toi-même");
    expect(k).toContain("Détecte l'intention");
    expect(k).toContain("Ne promets jamais une capacité qui n'existe pas");
    expect(k).toContain("Que sais-tu faire ?");
  });

  it("utilise le préfixe demandé partout (pas de « . » codé dur)", () => {
    const k = buildCommandKnowledge("!");
    expect(k).toContain("!a solo leveling");
    expect(k).toContain("!a s1 d-");
    expect(k).toContain("alias !anime, !nv");
    expect(k).not.toContain(".a ");
  });

  it("reste compact (budget de prompt système)", () => {
    expect(buildCommandKnowledge(".").length).toBeLessThan(4500);
  });

  it("survit à un registre vide (boot très tôt / contexte panneau)", () => {
    // Avant initRegistry(), commandsMap est vide : la fiche .a doit
    // quand même être livrée, sans lever, sans section inventaire.
    const k = buildCommandKnowledge(".");
    expect(k).toContain(".a solo leveling");
    expect(k).not.toContain("## Toutes les commandes");
  });
});

describe("commandKnowledge — inventaire dynamique (registre)", () => {
  const fake: BotCommand = {
    name: "ztestguide",
    category: "Category Z",
    description: "Commande factice pour le test du harnais IA.",
    usage: "ztestguide",
    execute: async () => {},
  };

  beforeEach(() => {
    removeCommand("ztestguide");
  });

  it("inclut une commande enregistrée au runtime (ex. commande panneau)", () => {
    registerCommand(fake);
    const k = buildCommandKnowledge(".");
    expect(k).toContain("## Toutes les commandes");
    expect(k).toContain("### Category Z");
    expect(k).toContain("- `.ztestguide` — Commande factice pour le test du harnais IA.");
  });

  it("liste les alias de la commande quand ils existent", () => {
    registerCommand({ ...fake, aliases: ["zt", "guidez"] });
    const k = buildCommandKnowledge(".");
    expect(k).toContain("(alias .zt, .guidez)");
  });

  it("retire la commande quand elle est désenregistrée", () => {
    registerCommand(fake);
    removeCommand("ztestguide");
    const k = buildCommandKnowledge(".");
    expect(k).not.toContain("ztestguide");
  });
});

describe("commandKnowledge — injection dans le persona", () => {
  it("getPersonaPrompt embarque la connaissance des commandes (les deux surfaces)", () => {
    expect(getPersonaPrompt("command", "Nebula")).toContain("# Tes commandes");
    expect(getPersonaPrompt("dm", "Nebula")).toContain("# Tes commandes");
  });

  it("reste injectée avec un persona personnalisé (NEBULA_AI_PERSONALITY)", () => {
    process.env.NEBULA_AI_PERSONALITY = "Tu es VEGA, une IA test. Réponds en une phrase.";
    const p = getPersonaPrompt("dm");
    expect(p).toContain("Tu es VEGA, une IA test. Réponds en une phrase.");
    expect(p).toContain("# Tes commandes");
    expect(p).toContain(".a solo leveling");
    expect(p).not.toContain("# Identity");
  });

  it("ne casse pas le persona de base (voix inchangée)", () => {
    const p = getPersonaPrompt("command", "Nebula");
    expect(p).toContain("# Identity");
    expect(p).toContain("Jcversa — Dark Neon");
    expect(p.indexOf("# Identity")).toBeLessThan(p.indexOf("# Tes commandes"));
  });
});
