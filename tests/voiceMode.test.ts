/**
 * 9.18ii (P6b) — mode vocal de l'agent : store par chat + éligibilité des
 * textes à la voix (décisions owner 15/10 : conversationnel, ≤ 500 chars,
 * jamais d'URL, voix Henri).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setVoiceMode, isVoiceModeEnabled } from "../src/bot/services/voiceModeStore.js";
import { isVoiceEligibleText, VOICE_REPLY_MAX_CHARS } from "../src/bot/services/agentVoice.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "voice-mode-"));
  process.env.NEBULA_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.18ii — voiceModeStore (JSON atomique, par chat)", () => {
  it(".on active, .off désactive, chats isolés", () => {
    expect(isVoiceModeEnabled("chat1")).toBe(false);
    setVoiceMode("chat1", true);
    expect(isVoiceModeEnabled("chat1")).toBe(true);
    expect(isVoiceModeEnabled("chat2")).toBe(false);
    setVoiceMode("chat1", false);
    expect(isVoiceModeEnabled("chat1")).toBe(false);
  });

  it("jid vide → false, pas de crash", () => {
    expect(isVoiceModeEnabled("")).toBe(false);
    expect(setVoiceMode("", true)).toBe(false);
  });
});

describe("9.18ii — isVoiceEligibleText (pur, règles UX)", () => {
  it("réponse conversationnelle courte → éligible", () => {
    expect(isVoiceEligibleText("Salut ! Ça va bien et toi ?")).toBe(true);
    expect(isVoiceEligibleText("Quel épisode veux-tu télécharger ?")).toBe(true);
  });

  it("trop long (> 500 chars) → texte", () => {
    expect(isVoiceEligibleText("a".repeat(VOICE_REPLY_MAX_CHARS))).toBe(true);
    expect(isVoiceEligibleText("a".repeat(VOICE_REPLY_MAX_CHARS + 1))).toBe(false);
  });

  it("URL → texte (un lien ne s'écoute pas)", () => {
    expect(isVoiceEligibleText("Voici le lien : https://dash.example/d/abc123")).toBe(false);
  });

  it("vide ou formatage seul → texte", () => {
    expect(isVoiceEligibleText("")).toBe(false);
    expect(isVoiceEligibleText("*_*~`")).toBe(false);
  });
});
