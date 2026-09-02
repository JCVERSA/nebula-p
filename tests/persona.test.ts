import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import { getPersonaPrompt } from "../src/bot/persona.js";

/**
 * Nebula AI persona (audit 8.37): sober/professional voice, mirrors the
 * user's language (FR default), WhatsApp-specific delivery rules, original
 * content. Applied to chat surfaces (.ai + DM); NEBULA_AI_PERSONALITY can
 * replace the whole persona without a deploy.
 */

beforeEach(() => {
  delete process.env.NEBULA_AI_PERSONALITY;
});

describe("persona — base prompt", () => {
  it("carries the identity, voice, language, WhatsApp-formatting and boundary sections", () => {
    const p = getPersonaPrompt("command", "Nebula");
    for (const expected of [
      "# Identity",
      "You are Nebula, the AI assistant",
      "Never invent facts",
      "default to French",
      "Do NOT use markdown headers, tables or double asterisks",
      "under ~120 words",
      "Never claim to be human"
    ]) {
      expect(p).toContain(expected);
    }
  });

  it("replaces the {{BOT}} placeholder with the configured bot name", () => {
    const p = getPersonaPrompt("command", "DarkStar");
    expect(p).toContain("You are DarkStar, the AI assistant");
    expect(p).not.toContain("{{BOT}}");
  });

  it("adapts the context suffix to the surface (command vs dm)", () => {
    const command = getPersonaPrompt("command");
    const dm = getPersonaPrompt("dm");
    expect(command).toContain(".ai command");
    expect(dm).toContain("1-on-1 private WhatsApp conversation");
    expect(command).not.toBe(dm);
  });

  it("stays compact enough for a system prompt (< 6000 chars)", () => {
    expect(getPersonaPrompt("dm").length).toBeLessThan(6000);
  });
});

describe("persona — operator override", () => {
  it("NEBULA_AI_PERSONALITY replaces the whole persona", () => {
    process.env.NEBULA_AI_PERSONALITY = "Tu es VEGA, une IA test. Réponds en une phrase.";
    const p = getPersonaPrompt("dm");
    expect(p).toBe("Tu es VEGA, une IA test. Réponds en une phrase.");
  });

  it("a whitespace-only override is ignored (falls back to the base)", () => {
    process.env.NEBULA_AI_PERSONALITY = "   ";
    expect(getPersonaPrompt("command")).toContain("# Identity");
  });
});

describe("persona — wiring of the chat surfaces", () => {
  it(".ai and both DM call sites use getPersonaPrompt", () => {
    const ai = fs.readFileSync("src/bot/commands/ai.ts", "utf-8");
    const engine = fs.readFileSync("src/bot/botEngine.ts", "utf-8");
    expect(ai).toContain('getPersonaPrompt("command"');
    // two DM surfaces: the direct-chat handler and the simulator path
    expect(engine.match(/getPersonaPrompt\("dm"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
