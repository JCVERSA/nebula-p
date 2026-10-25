import fs from "fs";
import { describe, expect, it } from "vitest";

/**
 * 9.18tttt — gardes d'écran Novabox (retour terrain 24/10, conversation
 * « Re:Zero » de Jor Orange) :
 *
 *  1. « .a s4 » sur l'écran ÉPISODES partait en RECHERCHE LITTÉRALE « s4 »
 *     (résultats absurdes : « Stratos 4 », « Zero no Tsukaima »), remplaçait
 *     la session, et le « .a e4 » suivant cherchait « e4 » à son tour
 *     (« aucun résultat ») — toute la suite déraillait jusqu'à l'arrêt honnête
 *     de l'agent.
 *     Fix : le token s<N> est re-routé vers le handler SAISON (changement de
 *     saison légitime depuis l'écran épisodes).
 *
 *  2. « .a e4 » sur l'écran de SÉLECTION partait en recherche littérale
 *     « e4 ». Fix : guidance honnête (format d'épisode sur le mauvais écran).
 *
 *  3. « Télécharge moi une bonne image Pinterest » (terrain 25/10, Dark Neon) :
 *     l'agent lançait une recherche web inutile au lieu de demander le lien.
 *     Fix : la connaissance IA dit de demander le lien (.dl le télécharge,
 *     pas de recherche d'images — capacité inexistante, interdiction d'en
 *     promettre une).
 */

const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
const knowledge = fs.readFileSync("src/bot/commandKnowledge.ts", "utf-8");

describe("9.18tttt — .a s<N> sur l'écran épisodes = changement de saison, PAS une recherche", () => {
  it("le token s<N> est accepté comme action d'étape sur l'écran épisodes", () => {
    expect(src).toContain('|| /^s\\d+$/i.test(firstArg) || fullArgStr.includes(",")');
  });

  it("le re-route vers le handler saison est câblé AVANT le dispatch des étapes", () => {
    const rerouteIdx = src.indexOf('if (session.step === "episode" && /^s\\d+$/i.test(firstArg)) {');
    const dispatchIdx = src.indexOf("// Handle anime selection step");
    expect(rerouteIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(rerouteIdx);
    expect(src).toContain('session.step = "season";');
  });

  it("sémantique : s4 matche, saisons4/e4/4s non (tokens de saison exacts)", () => {
    expect(/^s\d+$/i.test("s4")).toBe(true);
    expect(/^s\d+$/i.test("S12")).toBe(true);
    expect(/^s\d+$/i.test("saisons4")).toBe(false);
    expect(/^s\d+$/i.test("e4")).toBe(false);
    expect(/^s\d+$/i.test("4s")).toBe(false);
  });
});

describe("9.18tttt — .a e<N> sur l'écran sélection = guidance honnête, PAS une recherche", () => {
  it("le token épisode est accepté comme action d'étape sur l'écran sélection", () => {
    expect(src).toContain('|| /^(?:ep|e)\\d+$/i.test(firstArg);\n      } else if (step === "language")');
  });

  it("la guidance honnête est câblée dans le handler de sélection", () => {
    expect(src).toContain("est un format d'*épisode* — l'écran affiché est la *sélection d'animes*");
  });

  it("sémantique : e4/ep4 matchent, ep45 oui, eps4/explicit non", () => {
    expect(/^(?:ep|e)\d+$/i.test("e4")).toBe(true);
    expect(/^(?:ep|e)\d+$/i.test("ep4")).toBe(true);
    expect(/^(?:ep|e)\d+$/i.test("EP45")).toBe(true);
    expect(/^(?:ep|e)\d+$/i.test("eps4")).toBe(false);
    expect(/^(?:ep|e)\d+$/i.test("episode")).toBe(false);
  });
});

describe("9.18tttt — image Pinterest sans lien : demander le lien, pas une recherche web", () => {
  it("la connaissance IA guide vers la demande de lien (.dl télécharge)", () => {
    expect(knowledge).toContain("« image Pinterest » SANS lien → demande le lien");
    expect(knowledge).toContain("pas de recherche d'images");
  });
});
