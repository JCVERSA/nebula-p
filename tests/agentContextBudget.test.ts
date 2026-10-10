/**
 * 8.98 — budget de contexte de l'agent (leçon hermes-agent, oct. 2026) :
 * une fiche qui gonfle fait « perdre le milieu » du prompt système —
 * Hermes a dû découper sa fiche de 38,7k chars parce que chaque session
 * perdait les règles du milieu. Ici on verrouille AVANT d'arriver là :
 *
 *  1. buildAgentKnowledge (fiche .a + règles + inventaire) < 6 000 chars ;
 *  2. le bloc historique anime (5 entrées) reste compact (< 900 chars) ;
 *  3. le prompt système TOTAL estimé (persona + fiche + mémoire + historique)
 *     reste sous 18 000 chars — bornes max de chaque composant.
 *
 * Si ce test échoue : ne pas juste augmenter le budget — découper/déplacer
 * la fiche (regarder ce que l'IA a VRAIMENT besoin de voir à chaque tour).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildAgentKnowledge } from "../src/bot/commandKnowledge.js";
import { getPersonaPrompt } from "../src/bot/persona.js";
import { getMemoryContext } from "../src/bot/services/aiMemory.js";
import {
  recordAnimeChoice,
  getAnimeChoiceContext,
  MAX_CONTEXT_BUDGET_EXPORT_FOR_TESTS
} from "../src/bot/services/animeChoices.js";

/** Le 8.97 référençait MAX_BLOCK_CHARS=4000 pour la mémoire de conversation. */
const AI_MEMORY_BLOCK_MAX = 4000;
/** Prompt système total : persona + mémoire + historique + fiche agent. */
const TOTAL_SYSTEM_PROMPT_BUDGET = 18000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-budget-"));
  process.env.NEBULA_DATA_DIR = dir;
  delete process.env.NEBULA_ANIME_CHOICES_TTL_HOURS;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

describe("8.98 — budget de contexte de l'agent (leçon hermes)", () => {
  it("la fiche agent reste sous 6 000 caractères", () => {
    const knowledge = buildAgentKnowledge(".");
    if (knowledge.length >= 6000) {
      throw new Error(
        `Fiche agent trop grosse : ${knowledge.length} chars (budget 6 000). ` +
          `Leçon hermes : une fiche qui gonfle fait perdre le MILIEU du prompt au modèle. ` +
          `Découpe/déplace plutôt que d'augmenter le budget.`
      );
    }
  });

  it("le bloc historique anime (5 entrées) reste compact", () => {
    const now = Date.now();
    // 5 téléchargements distincts, champs aux plafonds réalistes.
    for (let i = 0; i < 5; i++) {
      recordAnimeChoice(
        "chat-budget@s.whatsapp.net",
        {
          title: `Un Titre D Anime Assez Long Numero ${i}`,
          source: i % 2 === 0 ? "va" : "as",
          language: i % 2 === 0 ? "VF" : "VOSTFR",
          seasonName: `Saison ${(i % 4) + 1}`,
          quality: ["480P", "720P", "1080P"][i % 3],
          episodesSpec: `e${i + 1}-e${i + 3}`,
          lastEpisode: i + 3
        },
        now - i * 3 * 60 * 60 * 1000
      );
    }
    const block = getAnimeChoiceContext("chat-budget@s.whatsapp.net", now)!;
    expect(block).not.toBeNull();
    expect(block.length).toBeLessThan(900);
    expect(MAX_CONTEXT_BUDGET_EXPORT_FOR_TESTS).toBe(900);
  });

  it("le prompt système total estimé reste sous 18 000 caractères", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      recordAnimeChoice(
        "chat-total@s.whatsapp.net",
        {
          title: `Un Titre D Anime Assez Long Numero ${i}`,
          source: "va",
          language: "VF",
          seasonName: `Saison ${i + 1}`,
          quality: "1080P",
          episodesSpec: `e${i + 1}`,
          lastEpisode: i + 1
        },
        now - i * 60 * 60 * 1000
      );
    }
    // Mémoire de conversation PLEINE (factice, au plafond 8.97).
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ai_memory.json"),
      JSON.stringify({
        "chat-total@s.whatsapp.net": {
          turns: [],
          summary: "x".repeat(2000),
          lastTs: now
        }
      }),
      "utf-8"
    );

    const total =
      getPersonaPrompt("dm", "Nebula").length +
      (getMemoryContext("chat-total@s.whatsapp.net")?.length || 0) +
      (getAnimeChoiceContext("chat-total@s.whatsapp.net")?.length || 0) +
      buildAgentKnowledge(".").length;

    // Les composants individuels respectent leurs bornes…
    expect(getMemoryContext("chat-total@s.whatsapp.net")!.length).toBeLessThanOrEqual(AI_MEMORY_BLOCK_MAX);
    // …et l'ensemble tient le budget global.
    expect(total).toBeLessThan(TOTAL_SYSTEM_PROMPT_BUDGET);
  });
});
