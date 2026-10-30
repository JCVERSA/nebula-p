import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  buildBatchAdviceMessage,
  buildBatchLimitMessage,
  isBatchConfirmAffirmative,
  isBatchConfirmNegative,
} from "../src/bot/commands/novabox.js";

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
 *     Fix tttt : demander le lien. Puis « envoie moi une photo de lui »
 *     (conversation Jungkook 24/10) → « je ne peux pas envoyer d'images »
 *     alors que le bot SAIT envoyer des images (cards pppp). Fix uuuu :
 *     outil interne Nova `img` — recherche UNIVERSELLE (Wikipédia + images
 *     web Tavily, toute source, Pinterest compris), 6 images par demande.
 *
 *  4. (uuuu, retour owner 25/10) trop de batch anime d'un coup = échecs
 *     partiels : au-delà de 5 épisodes on AVERTIT et on suggère « 5 à la
 *     fois », avec « go » pour forcer et « non » pour annuler (fail-closed
 *     sur le modèle 8.95), sur l'écran interactif ET le pipeline rapide.
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

describe("9.18uuuu — photo/image sans lien : outil interne Nova img (recherche universelle)", () => {
  it("la connaissance IA route « envoie-moi une photo de X » vers img (jamais de génération)", () => {
    expect(knowledge).toContain("« une photo/image de X » (même « de Pinterest »)");
    expect(knowledge).toContain("img X");
    expect(knowledge).toContain("outil interne, jamais de génération");
  });

  it(".dl reste le chemin pour un LIEN direct ; img couvre le sans-lien (6 images web)", () => {
    expect(knowledge).toContain("photo/image SANS lien → outil interne");
    expect(knowledge).toContain("jusqu'à 6 images web universelles");
    expect(knowledge).toContain("= lien FB/X/Pinterest/Reddit");
  });
});

describe("9.18uuuu — conseil batch « 5 à la fois » (retour owner 25/10)", () => {
  it("le message d'avertissement dit le risque, la suggestion 5, go et non", () => {
    const msg = buildBatchAdviceMessage(12);
    expect(msg).toContain("12 épisodes d'un coup");
    expect(msg).toContain("risquent d'échouer");
    expect(msg).toContain("5 épisodes à la fois");
    expect(msg).toContain("*go*");
    expect(msg).toContain("*non*");
  });

  it("la limite dure (> plafond) porte aussi le conseil 5", () => {
    const msg = buildBatchLimitMessage(13, 12);
    expect(msg).toContain("Trop d'épisodes d'un coup (13)");
    expect(msg).toContain("12 épisodes par demande");
    expect(msg).toContain("1 à 5");
  });

  it("sémantique de confirmation : go/ok/oui/tout/vas-y forcent ; 5/go4/non-like non", () => {
    expect(isBatchConfirmAffirmative("go")).toBe(true);
    expect(isBatchConfirmAffirmative("GO")).toBe(true);
    expect(isBatchConfirmAffirmative("ok")).toBe(true);
    expect(isBatchConfirmAffirmative("oui")).toBe(true);
    expect(isBatchConfirmAffirmative("tout")).toBe(true);
    expect(isBatchConfirmAffirmative("vas-y")).toBe(true);
    expect(isBatchConfirmAffirmative("5")).toBe(false);
    expect(isBatchConfirmAffirmative("go4")).toBe(false);
    expect(isBatchConfirmAffirmative("gonogo")).toBe(false);
    expect(isBatchConfirmNegative("non")).toBe(true);
    expect(isBatchConfirmNegative("annule")).toBe(true);
    expect(isBatchConfirmNegative("stop")).toBe(true);
    expect(isBatchConfirmNegative("oui")).toBe(false);
  });

  it("la porte interactive est câblée APRÈS la validation de sélection (stash + retour)", () => {
    const gateIdx = src.indexOf("session.pendingBatchConfirm = { indices: selectedIndices };");
    const invalidIdx = src.indexOf("Invalid Episode Selection");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(invalidIdx);
  });

  it("la porte du pipeline rapide est câblée avec le repli skipBatchAdvice", () => {
    expect(src).toContain("session.pendingBatchConfirm = {");
    expect(src).toContain("quick: { chosen: chosenAnime, quickParams }");
    expect(src).toContain("!quickParams.skipBatchAdvice && resolvedIndices.length > BATCH_ADVICE_THRESHOLD");
    expect(src).toContain("{ ...pending.quick.quickParams, skipBatchAdvice: true }, true");
  });

  it("« go » est intercepté AVANT le dispatch des étapes (comme 8.95)", () => {
    const confirmIdx = src.indexOf("pendingBatchConfirm!;");
    const dispatchIdx = src.indexOf("// Step-by-step handler if there's an active session");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(confirmIdx);
  });

  it("le seuil de conseil et le plafond restent génériques (env, défauts 5/12)", () => {
    expect(src).toContain("NEBULA_NOVABOX_BATCH_ADVICE || 5");
    expect(src).toContain("NEBULA_NOVABOX_MAX_EPISODES || 12");
  });
});
