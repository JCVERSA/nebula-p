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
  extractToolCallLeak,
  extractCommandLineLeak,
  looksLikeLinkResendRequest,
  looksLikeRawJson,
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

  it("rejette commande invalide (vide, caractères) — le préfixe est toléré depuis 9.18xxxx", () => {
    // 9.18xxxx (terrain 25/10) : les tool-calls fuient avec le préfixe utilisateur
    // (".ytv") — il est désormais STRIPPÉ au parsing. Vide/espaces restent rejetés.
    expect(parseAgentDecision('{"action":"execute","command":".gce","args":"x"}')).toMatchObject({
      action: "execute",
      command: "gce",
    });
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

  it("« la saison suivante » → null (mot « saison » hors vocabulaire → IA) ; « suivant » nu et « le 2e » aussi", () => {
    // 9.18eeee (A2) : « la suite » est DÉSORMAIS déterministe (l'intention la
    // plus courante après un épisode) — l'ambiguïté « saison suivante » reste
    // protégée : le mot « saison » n'est pas dans le vocabulaire → chemin IA.
    expect(deterministicNextEpisodeDecision("la suite", LAST)?.action).toBe("execute");
    expect(deterministicNextEpisodeDecision("la saison suivante", LAST)).toBeNull();
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

describe("9.18eeee (A2) — continuation nue déterministe : « la suite », « continue », « encore un »", () => {
  const LAST = { title: "mushoku tensei", source: "va", seasonName: "Saison 1", quality: "480P", lastEpisode: 5 };
  const argsOf = (t: string) => {
    const d = deterministicNextEpisodeDecision(t, LAST as NextEpisodeContext);
    return d && d.action === "execute" ? d.args : null;
  };

  it("« la suite », « continue », « encore un épisode » → épisode suivant, zéro token", () => {
    expect(argsOf("la suite")).toBe("va mushoku tensei s1 e6 480p");
    expect(argsOf("la suite stp")).toContain("e6");
    expect(argsOf("continue")).toContain("e6");
    expect(argsOf("tu peux continuer")).toContain("e6");
    expect(argsOf("encore un épisode")).toContain("e6");
    expect(argsOf("encore un stp")).toContain("e6");
  });

  it("fail-open préservé : question, titre mentionné, gratitude, hors sujet", () => {
    expect(argsOf("tu peux continuer ?")).toBeNull(); // question ≠ instruction
    expect(argsOf("la suite de one piece")).toBeNull(); // titre désigné → IA
    expect(argsOf("encore merci")).toBeNull(); // gratitude → IA
    expect(argsOf("la suite de la chanson")).toBeNull(); // pas un anime
    expect(argsOf("continue à m'expliquer le théorème de Pythagore")).toBeNull();
  });
});

describe("9.18eeee (A3) — « renvoie le lien » : reconnaissance stricte (pur)", () => {
  it("variantes de renvoi/perte + « le lien » nu → vrai", () => {
    expect(looksLikeLinkResendRequest("renvoie le lien")).toBe(true);
    expect(looksLikeLinkResendRequest("renvoie-moi le lien stp")).toBe(true);
    expect(looksLikeLinkResendRequest("redonne le lien")).toBe(true);
    expect(looksLikeLinkResendRequest("j'ai perdu le lien")).toBe(true);
    expect(looksLikeLinkResendRequest("le lien s'il te plaît")).toBe(true);
    expect(looksLikeLinkResendRequest("peux-tu me retrouver le lien du film")).toBe(true);
  });

  it("tout le reste → faux (chemin IA normal, on ne devine pas)", () => {
    expect(looksLikeLinkResendRequest("un lien pour youtube")).toBe(false);
    expect(looksLikeLinkResendRequest("renvoie le message")).toBe(false);
    expect(looksLikeLinkResendRequest("")).toBe(false);
    expect(looksLikeLinkResendRequest(`renvoie le lien\n${"x".repeat(150)}`)).toBe(false); // multiligne/long
    expect(looksLikeLinkResendRequest("le li")).toBe(false);
  });
});

describe("9.18bbbb — filet « commande écrite au lieu d'exécutée » (terrain 25/10 : .search / 31/10 : .img)", () => {
  it("ligne de commande complète → intention execute (préfixe strippé, args préservés)", () => {
    expect(extractCommandLineLeak(".search Nebula Bot actus", ".")).toEqual({
      command: "search",
      args: "Nebula Bot actus",
    });
    expect(extractCommandLineLeak("  .ytv https://youtu.be/x 720p  ", ".")).toEqual({
      command: "ytv",
      args: "https://youtu.be/x 720p",
    });
    expect(extractCommandLineLeak(".a", ".")).toEqual({ command: "a", args: "" });
    // préfixe non-point échappé correctement
    expect(extractCommandLineLeak("!trad en Hello", "!")).toEqual({ command: "trad", args: "en Hello" });
  });

  it("outil interne img sans préfixe reconnu ; prose et multi-lignes rejetées", () => {
    expect(extractCommandLineLeak("img attack on titan", ".")).toEqual({ command: "img", args: "attack on titan" });
    expect(extractCommandLineLeak("IMG chat mignon", ".")).toEqual({ command: "img", args: "chat mignon" });
    // prose (jamais de devine) : null
    expect(extractCommandLineLeak("Voici la recherche que tu peux lancer : .search x", ".")).toBeNull();
    expect(extractCommandLineLeak("search actus", ".")).toBeNull();
    expect(extractCommandLineLeak(".search a\n.deuxième ligne", ".")).toBeNull();
    expect(extractCommandLineLeak("", ".")).toBeNull();
    expect(extractCommandLineLeak(`.search ${"x".repeat(250)}`, ".")).toBeNull();
  });
});

describe("9.18xxxx — tolérance tool-call {cmd, args} (terrain 25/10 : fuite .ytv/.a)", () => {
  it("un tool-call fuité devient une décision execute valide (préfixe stripped)", () => {
    const d = parseAgentDecision('{"cmd": ".ytv", "args": "https://youtu.be/x 720p"}');
    expect(d).toMatchObject({ action: "execute", command: "ytv", args: "https://youtu.be/x 720p" });
  });

  it("cmd sans préfixe et command classique restent admis", () => {
    expect(parseAgentDecision('{"cmd": "search", "args": "actus"}')).toMatchObject({ action: "execute", command: "search" });
    expect(parseAgentDecision('{"command": ".a", "args": "naruto s1"}')).toMatchObject({ action: "execute", command: "a" });
  });

  it("action explicite prime toujours ; cmd invalide → null", () => {
    expect(parseAgentDecision('{"action": "reply", "text": "ok", "cmd": ".ytv"}')).toMatchObject({ action: "reply", text: "ok" });
    expect(parseAgentDecision('{"cmd": "pas une commande !!"}')).toBeNull();
    expect(parseAgentDecision('{"cmd": ""}')).toBeNull();
  });
});

describe("9.18vvvv — anti-fuite tool-call (terrain 25/10 : JSON brut affiché)", () => {
  it("looksLikeRawJson : objets et tableaux oui, prose non", () => {
    expect(looksLikeRawJson('{"query": "x"}')).toBe(true);
    expect(looksLikeRawJson('  [1, 2]  ')).toBe(true);
    expect(looksLikeRawJson("Tape `.gce a bio` 🙂")).toBe(false);
    expect(looksLikeRawJson("{ moitié de JSON")).toBe(false);
    expect(looksLikeRawJson("")).toBe(false);
  });

  it("extrait la query d'une fuite reconnaissable (cas terrain exact)", () => {
    const leak = extractToolCallLeak('{"query": "The Witch of Mongolia anime titre correct", "recency_days": 365}');
    expect(leak).toEqual({ query: "The Witch of Mongolia anime titre correct" });
  });

  it("contrat de décision (action) → pas une fuite ; prose → null ; JSON cassé → null", () => {
    expect(extractToolCallLeak('{"action": "execute", "command": "search", "args": "x"}')).toBeNull();
    expect(extractToolCallLeak("Réponse en prose normale.")).toBeNull();
    expect(extractToolCallLeak('{"query": }')).toBeNull();
    expect(extractToolCallLeak('{"foo": "bar"}')).toBeNull();
    expect(extractToolCallLeak('["array"]')).toBeNull();
  });

  it("query tronquée à 200 caractères (garde-fou)", () => {
    const leak = extractToolCallLeak(JSON.stringify({ query: "x".repeat(500) }));
    expect(leak!.query.length).toBe(200);
  });
});
