/**
 * 9.1 — mémoire d'observation : unitaire (TTL, cap, heuristique
 * d'interactivité, format du bloc injecté).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setLastObservation,
  getLastObservation,
  outputLooksInteractive,
  observationContext,
  __resetObservationsForTests,
  compactObservationTexts
} from "../src/bot/services/agentObservation.js";

const JID = "1555999111222@s.whatsapp.net";

beforeEach(() => {
  __resetObservationsForTests();
});

describe("outputLooksInteractive (heuristique 9.1)", () => {
  it("reconnaît les écrans novabox qui attendent un choix", () => {
    expect(outputLooksInteractive(["👉 Répondez avec: `.a [numéro]` (ex: `.a 1`)"])).toBe(true);
    expect(outputLooksInteractive(["👉 Réponds avec : `.a s[numéro]`"])).toBe(true);
    expect(outputLooksInteractive(["🎬 *Novabox - Sélectionnez l'Anime* 🎬"])).toBe(true);
  });

  it("lien final, erreurs et questions de langue ne déclenchent PAS la boucle", () => {
    expect(outputLooksInteractive(["🔗 https://exemple.com/ep12.html"])).toBe(false);
    expect(outputLooksInteractive(["❌ Aucun résultat"])).toBe(false);
    // La question VF/VOSTFR est une préférence utilisateur : l'agent ne
    // doit JAMAIS y répondre à sa place (elle n'est pas « pilotable »).
    expect(outputLooksInteractive(["Aucune VF disponible. Continuer en VOSTFR ?"])).toBe(false);
  });
});

describe("mémoire par chat (TTL, cap)", () => {
  it("stocke et restitue la dernière observation", () => {
    setLastObservation(JID, "anime", ["liste 1", "liste 2"]);
    const obs = getLastObservation(JID);
    expect(obs?.command).toBe("anime");
    expect(obs?.texts).toEqual(["liste 1", "liste 2"]);
  });

  it("textes vides → rien n'est stocké", () => {
    setLastObservation(JID, "gce", []);
    expect(getLastObservation(JID)).toBeNull();
  });

  it("cap 2400 chars : on garde les DERNIERS textes (le choix est en fin)", () => {
    setLastObservation(JID, "anime", ["x".repeat(2000), "y".repeat(2000), "👉 choisis"]);
    const obs = getLastObservation(JID)!;
    expect(obs.texts.length).toBeLessThan(3);
    expect(obs.texts[obs.texts.length - 1]).toBe("👉 choisis");
  });

  it("le bloc de contexte mentionne l'écran en attente et la commande", () => {
    setLastObservation(JID, "anime", ["1. Mushoku Tensei 3 (VF)\n👉 Répondez avec: `.a 1`"]);
    const block = observationContext(JID);
    expect(block).toContain("Écran en attente dans ce chat");
    expect(block).toContain("commande .anime");
    expect(block).toContain("Mushoku Tensei 3");
    expect(block).toContain("ex. `.a 2`");
  });

  it("sans observation récente → null (pas de bruit dans le prompt)", () => {
    expect(observationContext(JID)).toBeNull();
  });
});

// ── 9.13 : éco tokens — compactage des sorties répétitives ────────────────
describe("9.13 — compactObservationTexts (éco tokens)", () => {
  it("une progression répétitive est compactée en 5 lignes honnêtes", () => {
    const progress = Array.from({ length: 12 }, (_, i) => `⏳ Épisode ${i + 1}/12 — 42.1 Mo · 480P · 88%`);
    const out = compactObservationTexts([progress.join("\n")])[0];
    const lines = out.split("\n");
    expect(lines.length).toBe(5);
    expect(lines[2]).toContain("lignes similaires compactées");
    expect(lines[0]).toContain("Épisode 1/12");
    expect(lines[4]).toContain("Épisode 12/12");
  });

  it("les écrans interactifs (courts ou non répétitifs) passent INTACTS", () => {
    const screen = "🎬 Novabox - Sélection\n1. Jujutsu Kaisen S2\n2. One Piece\n3. Demon Slayer";
    expect(compactObservationTexts([screen])[0]).toBe(screen);
    // 10 lignes aux formes réellement différentes → intact (les listes de
    // sélection ont des titres distincts, pas seulement un numéro qui change)
    const titles = ["Jujutsu Kaisen", "One Piece", "Demon Slayer", "Spy x Family", "Vinland Saga",
      "Mob Psycho", "Blue Lock", "Frieren", "Cyberpunk", "Dandadan"];
    const varied = titles.map((t, i) => `${i + 1}. ${t}`);
    expect(compactObservationTexts([varied.join("\n")])[0]).toBe(varied.join("\n"));
  });

  it("setLastObservation stocke la version compactée (intégration)", () => {
    __resetObservationsForTests();
    const progress = Array.from({ length: 15 }, (_, i) => `⏳ Épisode ${i + 1}/15 — 40 Mo`);
    setLastObservation("c@g.us", "a", [progress.join("\n")]);
    const obs = getLastObservation("c@g.us");
    expect(obs).not.toBeNull();
    expect(obs!.texts[0].split("\n").length).toBe(5);
    expect(obs!.texts[0]).toContain("compactées");
  });
});

describe("9.18kkk — observationContext à deux niveaux (retour terrain 18/10)", () => {
  it("sortie INFORMATIONNELLE (résultats .search) → PAS un écran de choix, jamais de numéro demandé", () => {
    setLastObservation(JID, "search", [
      "🔍 *Recherche — the rampart of ice*\n\n1. *The Ramparts of Ice - Wikipedia*\n2. *Netflix*\n3. *MyAnimeList*",
    ]);
    const block = observationContext(JID)!;
    expect(block).toContain("Contexte informationnel");
    expect(block).toContain("PAS un écran de choix");
    expect(block).toContain("Ne demande JAMAIS un numéro");
    expect(block).not.toContain("exécute la commande qui choisit");
    expect(block).not.toContain("attend une réponse");
  });

  it("écran Novabox réel → bloc fort inchangé (pilotage par numéro)", () => {
    setLastObservation(JID, "anime", ["1. Mushoku Tensei\n👉 Répondez avec: `.a 1`"]);
    const block = observationContext(JID)!;
    expect(block).toContain("Écran en attente dans ce chat");
    expect(block).toContain("exécute la commande qui choisit");
  });
});
