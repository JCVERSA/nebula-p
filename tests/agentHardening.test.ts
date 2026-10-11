/**
 * 8.99 — durcissement de l'agent (recherches hermes/OpenAI SDK/Mastra).
 *
 * 1. sanitizeAgentArgs (pur) : guardrail d'arguments — l'IA ne peut pas
 *    glisser URL/backticks/flags shell dans une commande autorisée.
 * 2. messageSuggestsAnimeHistory (pur) : le bloc historique n'est injecté
 *    que si le message parle d'anime (leçon Mastra — moins de bruit).
 * 3. Mode JSON natif : Gemini responseMimeType + NIM response_format,
 *    activé pour la décision de l'agent (parsing tolérant conservé).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { sanitizeAgentArgs } from "../src/bot/services/agentBrain.js";
import { messageSuggestsAnimeHistory } from "../src/bot/services/animeChoices.js";

describe("sanitizeAgentArgs — guardrail d'arguments (8.99)", () => {
  it("args propres → inchangés (changed=false)", () => {
    const r = sanitizeAgentArgs(["tokyo", "ghoul", "s1", "e5-7", "480p"]);
    expect(r.args).toEqual(["tokyo", "ghoul", "s1", "e5-7", "480p"]);
    expect(r.changed).toBe(false);
  });

  it("URL retirée intégralement", () => {
    const r = sanitizeAgentArgs(["https://evil.example/x", "naruto"]);
    expect(r.args).toEqual(["naruto"]);
    expect(r.changed).toBe(true);
  });

  it("www. retiré aussi", () => {
    const r = sanitizeAgentArgs(["www.evil.example", "s1"]);
    expect(r.args).toEqual(["s1"]);
  });

  it("backticks et quotes écorchés (injection de formatage)", () => {
    const r = sanitizeAgentArgs(["`tokyo`", '"ghoul"', "s1"]);
    expect(r.args).toEqual(["tokyo", "ghoul", "s1"]);
    expect(r.changed).toBe(true);
  });

  it("flags shell (--rf, --verbose) retirés", () => {
    const r = sanitizeAgentArgs(["purge", "--rf", "/"]);
    expect(r.args).toEqual(["purge", "/"]);
    expect(r.changed).toBe(true);
  });

  it("token démesuré coupé à 80 caractères", () => {
    const r = sanitizeAgentArgs(["A".repeat(300)]);
    expect(r.args[0].length).toBe(80);
  });

  it("budget total 200 caractères — coupe au dernier token complet", () => {
    const r = sanitizeAgentArgs(["x".repeat(60), "y".repeat(60), "z".repeat(60), "w".repeat(60)]);
    const total = r.args.join(" ").length;
    expect(total).toBeLessThanOrEqual(200);
    expect(r.args.length).toBe(3); // 3 tokens tiennent (60+1+60+1+60=182), le 4e non
    expect(r.changed).toBe(true);
  });

  it("args vides → vide, sans changement", () => {
    const r = sanitizeAgentArgs([]);
    expect(r.args).toEqual([]);
    expect(r.changed).toBe(false);
  });

  it("9.3b — allowUrls : l'URL est PRÉSERVÉE en place (ytv, sweb, fetch…)", () => {
    const url = "https://youtu.be/X28-dapCbSs?si=EkgHx3ZCBeu4T04g";
    const r = sanitizeAgentArgs([url, "360p"], { allowUrls: true });
    expect(r.args).toEqual([url, "360p"]); // ordre et URL intacts
    expect(r.changed).toBe(false);
  });

  it("9.3b — allowUrls : URL longue (>80) préservée, hors budget texte", () => {
    const longUrl = "https://www.youtube.com/watch?v=X28-dapCbSs&si=" + "a".repeat(90);
    const r = sanitizeAgentArgs([longUrl], { allowUrls: true });
    expect(r.args[0]).toBe(longUrl); // pas coupée à 80
    // Une URL de 500+ chars reste coupée au cap dédié.
    const huge = "https://example.com/" + "b".repeat(600);
    expect(sanitizeAgentArgs([huge], { allowUrls: true }).args[0].length).toBe(500);
  });

  it("9.3b — SANS allowUrls : le comportement 8.99 est inchangé (URL supprimée)", () => {
    const r = sanitizeAgentArgs(["https://youtu.be/x", "360p"]);
    expect(r.args).toEqual(["360p"]);
    expect(r.changed).toBe(true);
  });

  it("9.3b — ytvideo accepte la qualité écrite « 360p » (en plus de « 360 »)", () => {
    const src = readFileSync(join(__dirname, "../src/bot/commands/ytvideo.ts"), "utf-8");
    expect(src).toContain('lastArg?.replace(/p$/i, "")');
    expect(src).toContain("acceptsUrlArgs: true");
  });
});

describe("messageSuggestsAnimeHistory — injection sélective (8.99)", () => {
  it("messages anime/téléchargement → true", () => {
    for (const text of [
      "telecharge tokyo ghoul",
      "télécharge l'épisode 5",
      "le même anime mais en 720p",
      "l'épisode suivant",
      "la suite de naruto",
      "qu'est-ce qu'on avait pris avant ?",
      "je veux la saison 2 en vf",
      "mets-le en vostfr",
      ".a one piece",
      "encore le dernier en 1080p"
    ]) {
      expect(messageSuggestsAnimeHistory(text)).toBe(true);
    }
  });

  it("messages sans rapport → false (pas d'historique dans le prompt)", () => {
    for (const text of [
      "salut ça va ?",
      "merci bot",
      "quelle est la capitale du Japon",
      "raconte-moi une blague",
      "bonjour",
      "",
      "peux-tu m'expliquer les trous noirs"
    ]) {
      expect(messageSuggestsAnimeHistory(text)).toBe(false);
    }
  });
});

describe("Mode JSON natif + wiring (8.99)", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");

  it("Gemini : responseMimeType application/json quand jsonMode", () => {
    const src = read("../src/bot/geminiClient.ts");
    expect(src).toContain('responseMimeType: "application/json"');
  });

  it("NIM : response_format json_object quand jsonMode", () => {
    const src = read("../src/bot/nimClient.ts");
    expect(src).toContain('type: "json_object"');
  });

  it("l'agent décide en mode JSON (parsing tolérant conservé)", () => {
    const src = read("../src/bot/services/agentRunner.ts");
    expect(src).toContain("{ jsonMode: true }");
    expect(src).toContain("parseAgentDecision(raw)"); // fail-closed inchangé
  });

  it("le chat DM n'injecte l'historique QUE sur message anime", () => {
    const src = read("../src/bot/botEngine.ts");
    expect(src).toContain("messageSuggestsAnimeHistory(text)");
  });

  it("guardrail branché sur le chemin execute + audité", () => {
    const src = read("../src/bot/services/agentRunner.ts");
    expect(src).toContain("sanitizeAgentArgs(rawArgs"); // 9.3b : + { allowUrls } selon la commande
    expect(src).toContain("agent.args.sanitized");
  });
});
