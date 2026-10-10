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
} from "../src/bot/services/agentObservation.js";

const JID = "237999111222@s.whatsapp.net";

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
