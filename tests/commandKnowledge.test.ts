import { beforeEach, describe, expect, it } from "vitest";
import { buildCommandKnowledge, buildAgentKnowledge } from "../src/bot/commandKnowledge.js";
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
      // 8.95b : exemples en qualité ÉCRITE (l'agent ne doit plus deviner
      // les flags r — r2=360p a coûté une mauvaise commande en réel).
      ".a jjk s3 ep6 480p",
      ".a jjk s3 all 720p",
      ".a jjk s3 1-5 1080p",
      "r1`=480p",
      "r2`=360p",
      ".a as <titre>",
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
    // 9.18o : règle réécrite — l'ancienne « Tu ne peux pas télécharger »
    // contredisait le pilotage autonome 9.1 dans le même prompt.
    expect(k).toContain("Rien ne sert sa demande");
    expect(k).toContain("exécute-la (pilotage autonome)");
  expect(k).toContain("RECHERCHE D'INFO (9.0)");
  // 9.3 — leçons du retour terrain (hallucination d'actualité, cible
  // absente des args, titres français vs internationaux)
  expect(k).toContain("ACTUALITÉ (règle absolue)");
  expect(k).toContain("ne prétends jamais avoir cherché");
  expect(k).toContain("CIBLE DANS LES ARGS");
  expect(k).toContain("INTERNATIONAUX");
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
    expect(p).not.toContain("Jcversa");
    expect(p).not.toContain("Dark Neon");
    expect(p.indexOf("# Identity")).toBeLessThan(p.indexOf("# Tes commandes"));
  });
});

describe("9.18ff — contrat agent : chaîne générique + continuité (retour terrain 15/10)", () => {
  it("l'agent sait télécharger un générique sans demander le lien", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("générique/opening/ending de X");
    expect(k).toContain("ne demande JAMAIS un lien YouTube à l'utilisateur");
  });

  it("les réponses aux questions de l'agent complètent la demande en cours", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("COMPLETE la demande en cours");
    expect(k).toContain("ne redemande JAMAIS une information déjà donnée");
    expect(k).toContain("n'est JAMAIS un titre d'anime");
    expect(k).toContain("UNIQUEMENT sur un écran de sélection Novabox");
  });
});

describe("9.18kkk — titre exact trouvé par recherche web (retour terrain 18/10)", () => {
  it("l'agent relance .a avec le titre exact et ne traite jamais .search comme un catalogue", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("CE titre exact");
    expect(k).toContain("JAMIS un catalogue");
  });
});

describe("9.18rrr — la VOSTFR vit sur le catalogue par défaut (connaissance agent à jour)", () => {
  it("la fiche décrit l'écran mixte, l'écran VOSTFR et as = dépannage", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("VOSTFR étiquetées à la suite");
    expect(k).toContain("écran VOSTFR seul");
    expect(k).toContain("un numéro VOSTFR charge cette version");
    expect(k).toContain("l'autre catalogue, en dépannage");
    expect(k).not.toContain("catalogue complet"); // l'ancienne étiquette de as, trompeuse
  });
});

describe("9.18sss — l'agent comprend `.a vostfr` seul (bascule d'écran)", () => {
  it("la règle agent et la fiche documentent la bascule seule", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("SEUL : bascule l'écran affiché ou la dernière recherche");
    expect(k).toContain("ou la dernière recherche");
  });
});

describe("9.18ttt — l'agent ne refuse plus sur une date du web, et suit le titre de la conversation", () => {
  it("web ≠ catalogue : « pas encore sorti » → essayer quand même .a avec le titre exact", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("EXÉCUTE quand même");
    expect(k).toContain("seul le catalogue décide");
    expect(k).toContain("Refus fondé sur une date du web : INTERDIT, même une fois");
    expect(k).toContain("compare à la date du jour");
  });

  it("sans titre, l'anime dont on PARLE dans le chat prime sur l'historique", () => {
    const k = buildAgentKnowledge(".");
    expect(k).toContain("PRIME sur l'historique");
    expect(k).toContain("jamais le dernier téléchargé");
  });
});
