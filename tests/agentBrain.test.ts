import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_DENYLIST,
  checkAgentBudget,
  clearPendingConfirmation,
  isAgentDeniedCommand,
  isConfirmationAffirmative,
  deterministicNextEpisodeDecision,
  type NextEpisodeContext,
  isHeavyAgentCommand,
  messageSuggestsMultiIntent,
  keepHeadAndTail,
  parseAgentDecision,
  parseAgentFix,
  replySuggestsOtherCatalog,
  toggleCatalogFlag,
  peekPendingConfirmation,
  recordAgentExecution,
  restoreAgentState,
  setAgentStateSink,
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
    // 9.11 (audit B2) : playlist YouTube = lourde (25 vidéos possibles)
    expect(isHeavyAgentCommand({ name: "ytvideo" }, ["https://youtu.be/x?list=PL1", "playlist"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "ytvideo" }, ["<lien>", "pl"])).toBe(true);
    expect(isHeavyAgentCommand({ name: "ytvideo" }, ["https://youtu.be/x"])).toBe(false);
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

describe("8.94 — hint « autre catalogue » (politique langue anime)", () => {
  it("détecte les messages stables de applyLanguagePolicy", () => {
    expect(replySuggestsOtherCatalog("ℹ️ *Aucune VF pour ce titre sur ce catalogue* — saisons VOSTFR disponibles :")).toBe(true);
    expect(replySuggestsOtherCatalog("❌ *Aucun VOSTFR pour ce titre sur ce catalogue.*")).toBe(true);
    expect(replySuggestsOtherCatalog("_(Tu peux aussi essayer l'autre catalogue : `.a va <titre>`)_")).toBe(true);
  });

  it("ignore les réponses normales", () => {
    expect(replySuggestsOtherCatalog("🎬 Novabox - Choix de la Résolution")).toBe(false);
    expect(replySuggestsOtherCatalog("✅ Téléchargement terminé")).toBe(false);
    expect(replySuggestsOtherCatalog("")).toBe(false);
  });

  it("toggleCatalogFlag (8.96, défaut = va) : nu → as ; va → as ; as → nu", () => {
    expect(toggleCatalogFlag(["tokyo", "ghoul", "s2", "e1"], "va")).toEqual(["as", "tokyo", "ghoul", "s2", "e1"]);
    expect(toggleCatalogFlag(["va", "tokyo", "ghoul"], "va")).toEqual(["as", "tokyo", "ghoul"]);
    expect(toggleCatalogFlag(["as", "tokyo", "ghoul"], "va")).toEqual(["tokyo", "ghoul"]);
    // Rétro-compat : avec l'ancien défaut as, le comportement 8.94 tient.
    expect(toggleCatalogFlag(["tokyo", "ghoul"], "as")).toEqual(["va", "tokyo", "ghoul"]);
    expect(toggleCatalogFlag(["va", "tokyo", "ghoul"], "as")).toEqual(["tokyo", "ghoul"]);
    expect(toggleCatalogFlag(["as", "tokyo", "ghoul"], "as")).toEqual(["va", "tokyo", "ghoul"]);
    expect(toggleCatalogFlag([], "va")).toEqual(["as"]);
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

describe("9.18w — keepHeadAndTail (l'observation garde la consigne de fin)", () => {
  it("texte sous budget → inchangé", () => {
    expect(keepHeadAndTail("court", 100)).toBe("court");
  });

  it("texte long → tête + marqueur + queue dans le budget", () => {
    const t = "B".repeat(2000) + "👉 Réponds avec .a 2 pour choisir";
    const r = keepHeadAndTail(t, 600);
    expect(r.length).toBeLessThanOrEqual(600);
    expect(r).toContain("[…]");
    expect(r.startsWith("BBB")).toBe(true);
    expect(r.endsWith("👉 Réponds avec .a 2 pour choisir")).toBe(true);
  });

  it("la queue garde les dernières entrées de liste, pas le milieu", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `${i + 1}. anime ${i + 1}`).join("\n");
    const t = `Résultats :\n${lines}\n👉 Réponds avec .a <numéro>`;
    const r = keepHeadAndTail(t, 500);
    expect(r).toContain("👉 Réponds avec .a <numéro>");
    expect(r).toContain("60. anime 60"); // dernière entrée conservée
    expect(r).not.toContain("30. anime 30"); // le milieu est coupé
  });

  it("budget dégénéré → coupe simple sans crash", () => {
    expect(keepHeadAndTail("abcdef", 3)).toBe("abc");
    expect(keepHeadAndTail("abcdef", 0)).toBe("");
  });
});

describe("9.18w — persistance de l'état (restore + sink)", () => {
  it("restoreAgentState jette expirées et hors-fenêtre, garde le reste", () => {
    const now = Date.now();
    restoreAgentState({
      pending: [
        ["u", { command: "anime", args: ["x", "s1"], expiresAt: now - 1000 }],
        ["v", { command: "song", args: ["y"], expiresAt: now + 60000 }]
      ],
      execLog: [
        ["u", [now - 2 * 60 * 60 * 1000, now - 5000]],
        ["w", [now - 99 * 24 * 60 * 60 * 1000]]
      ]
    });
    expect(peekPendingConfirmation("u")).toBeNull();
    expect(peekPendingConfirmation("v")?.command).toBe("song");
    expect(checkAgentBudget("u")).toBe(true); // 1 entrée récente sur 10
    expect(checkAgentBudget("w")).toBe(true); // tout était obsolète → vide
  });

  it("formes invalides ignorées sans crash", () => {
    restoreAgentState({ pending: [["z", { command: 5, args: [], expiresAt: "x" } as unknown as never]], execLog: [] });
    expect(peekPendingConfirmation("z")).toBeNull();
  });

  it("le sink est appelé à chaque mutation, take() vide l'état", () => {
    const saved: Array<{ pending: unknown[]; execLog: unknown[] }> = [];
    setAgentStateSink((st) => saved.push({ pending: st.pending, execLog: st.execLog }));
    setPendingConfirmation("u", { command: "anime", args: ["a"] });
    expect(saved.length).toBe(1);
    expect(saved[0].pending.length).toBe(1);
    recordAgentExecution("u");
    expect(saved.length).toBe(2);
    expect(saved[1].execLog.length).toBe(1);
    takePendingConfirmation("u");
    expect(saved.length).toBe(3);
    expect(saved[2].pending.length).toBe(0);
    setAgentStateSink(null);
    setPendingConfirmation("v", { command: "trad", args: [] }); // sans sink : no-op silencieux
    expect(saved.length).toBe(3);
  });
});

describe("9.18x (P1) — « épisode suivant » déterministe (zéro token)", () => {
  const LAST = { title: "mushoku tensei", source: "va", seasonName: "Saison 1", quality: "480P", lastEpisode: 5 };

  /** Narrowing typé : args de la décision execute, null sinon. */
  const argsOf = (t: string, last: NextEpisodeContext): string | null => {
    const d = deterministicNextEpisodeDecision(t, last);
    return d && d.action === "execute" ? d.args : null;
  };

  it("phrase simple → exécution anime construite localement", () => {
    const d = deterministicNextEpisodeDecision("l'épisode suivant", LAST);
    expect(d).toEqual({ action: "execute", command: "anime", args: "va mushoku tensei s1 e6 480p", say: "⚡ La suite — épisode 6 !" });
  });

  it("9.18rrr (audit) : la langue du dernier téléchargement survit — VOSTFR → flag vostfr", () => {
    // Après un téléchargement VOSTFR, « l'épisode suivant » restait sur le
    // défaut VF : bascule de langue silencieuse (interdite, politique 8.69).
    const vostfrLast = { ...LAST, language: "VOSTFR" as const };
    expect(argsOf("l'épisode suivant", vostfrLast)).toContain("vostfr");
    const vfLast = { ...LAST, language: "VF" as const };
    expect(argsOf("l'épisode suivant", vfLast)).not.toContain("vostfr");
    // Langue inconnue → fail-open, pas de flag (comportement par défaut).
    expect(argsOf("l'épisode suivant", { ...LAST, language: "???" })).not.toContain("vostfr");
  });

  it("variantes : prochain épisode / next episode / ép d'après / politesse", () => {
    for (const t of [
      "donne moi le prochain épisode stp",
      "next episode please",
      "l'ép d'après",
      "vas-y, épisode suivant",
      "ép suivant"
    ]) {
      expect(deterministicNextEpisodeDecision(t, LAST)?.action).toBe("execute");
    }
  });

  it("source as → flag as ; qualité absente → pas de token qualité", () => {
    expect(argsOf("épisode suivant", { ...LAST, source: "as" })).toBe("as mushoku tensei s1 e6 480p");
    expect(argsOf("épisode suivant", { ...LAST, quality: "" })).toBe("va mushoku tensei s1 e6");
  });

  it("batch dernier épisode 7 → e8", () => {
    expect(argsOf("épisode suivant", { ...LAST, lastEpisode: 7 })).toContain("e8");
  });

  it("titre mentionné dans le message → null (fail-open vers l'IA)", () => {
    expect(deterministicNextEpisodeDecision("l'épisode suivant de one piece", LAST)).toBeNull();
  });

  it("autre qualité demandée → null (intention différente)", () => {
    expect(deterministicNextEpisodeDecision("l'épisode suivant en 720p", LAST)).toBeNull();
  });

  it("« la suite » seule → null (ambigu : saison suivante possible)", () => {
    expect(deterministicNextEpisodeDecision("la suite", LAST)).toBeNull();
    expect(deterministicNextEpisodeDecision("suivant", LAST)).toBeNull();
    expect(deterministicNextEpisodeDecision("le 2e", LAST)).toBeNull();
  });

  it("historique incomplet ou invalide → null", () => {
    expect(deterministicNextEpisodeDecision("épisode suivant", null)).toBeNull();
    expect(deterministicNextEpisodeDecision("épisode suivant", { ...LAST, lastEpisode: null })).toBeNull();
    expect(deterministicNextEpisodeDecision("épisode suivant", { ...LAST, seasonName: "Film" })).toBeNull();
    expect(deterministicNextEpisodeDecision("épisode suivant", { ...LAST, source: "xx" })).toBeNull();
    expect(deterministicNextEpisodeDecision("épisode suivant", { ...LAST, title: "" })).toBeNull();
    expect(deterministicNextEpisodeDecision("épisode suivant", { ...LAST, lastEpisode: 999 })).toBeNull();
  });
});

describe("9.18cc (P8) — messageSuggestsMultiIntent (pur)", () => {
  it("deux familles + liaison → true", () => {
    expect(messageSuggestsMultiIntent("télécharge l'épisode 1 de mushoku et la chanson du générique")).toBe(true);
    expect(messageSuggestsMultiIntent("résume cet article puis traduis le titre")).toBe(true);
    expect(messageSuggestsMultiIntent("la vidéo youtube et aussi le reel instagram")).toBe(true);
  });

  it("une seule famille (même avec « et ») → false — éco tokens", () => {
    expect(messageSuggestsMultiIntent("mushoku tensei s1 e5 et e6")).toBe(false);
    expect(messageSuggestsMultiIntent("l'épisode 1 et l'épisode 2 de naruto")).toBe(false);
  });

  it("deux familles sans liaison → false ; texte vide → false", () => {
    expect(messageSuggestsMultiIntent("télécharge l'épisode 1. la chanson du générique aussi")).toBe(true); // « aussi » = liaison
    expect(messageSuggestsMultiIntent("l'épisode 1 la chanson")).toBe(false);
    expect(messageSuggestsMultiIntent("")).toBe(false);
  });
});
