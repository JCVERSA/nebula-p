/**
 * 9.18kk — chaîne TTS Gemini (naturel) → Edge Henri (repli gratuit).
 * pcmToWav pur + orchestration avec moteurs mockés (geminiClient, aiQuota,
 * msedge-tts, child_process) — aucun réseau, aucun binaire réel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../src/bot/geminiClient.js", () => ({
  getAIClient: vi.fn((): any => null),
}));
vi.mock("../src/bot/aiQuota.js", () => ({
  checkAIQuota: vi.fn(() => ({ allowed: true })),
  consumeAIQuota: vi.fn(() => ({ allowed: true })),
  checkTTSQuota: vi.fn(() => ({ allowed: true })),
  consumeTTSQuota: vi.fn(() => ({ allowed: true })),
}));
vi.mock("msedge-tts", () => ({
  MsEdgeTTS: vi.fn(() => ({
    setMetadata: async () => {},
    toStream: () => ({
      audioStream: {
        [Symbol.asyncIterator]() {
          let done = false;
          return { async next() { if (done) return { done: true as const, value: undefined }; done = true; return { done: false as const, value: Buffer.from("FAKE-MP3") }; } };
        }
      }
    }),
    close: () => {}
  })),
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: "audio-24khz-48kbitrate-mono-mp3" },
}));
vi.mock("child_process", () => ({ spawn: vi.fn() }));

import { getAIClient } from "../src/bot/geminiClient.js";
import { checkAIQuota, consumeAIQuota, checkTTSQuota, consumeTTSQuota } from "../src/bot/aiQuota.js";
import { spawn } from "child_process";
import { synthesizeVoiceNote, pcmToWav } from "../src/bot/services/ttsService.js";

const mGemini = vi.mocked(getAIClient);
const mQuota = vi.mocked(checkAIQuota);
const mConsume = vi.mocked(consumeAIQuota);
const mCheckTTS = vi.mocked(checkTTSQuota);
const mConsumeTTS = vi.mocked(consumeTTSQuota);
const mSpawn = vi.mocked(spawn);

/** Fake ffmpeg : rend des octets ogg puis ferme proprement (code 0). */
function fakeFfmpeg() {
  return vi.fn(((_cmd: string, _args: string[]) => {
    const stderrCbs: Array<(d: Buffer) => void> = [];
    const closeCbs: Array<(code: number) => void> = [];
    const proc: any = {
      stdout: { on: (_e: string, cb: (d: Buffer) => void) => setTimeout(() => cb(Buffer.from("OGG-BYTES")), 1) },
      stderr: { on: (_e: string, cb: (d: Buffer) => void) => { stderrCbs.push(cb); } },
      stdin: { on: () => {}, end: () => {} },
      on: (ev: string, cb: any) => { if (ev === "close") closeCbs.push(cb); },
      kill: () => {},
    };
    setTimeout(() => closeCbs.forEach((cb) => cb(0)), 5);
    return proc;
  }) as typeof spawn);
}

/** Fake client Gemini TTS : inlineData base64 PCM 24 kHz. */
function fakeGeminiClient(pcm: Buffer) {
  return {
    models: {
      generateContent: vi.fn(async () => ({
        candidates: [{
          content: {
            parts: [{ inlineData: { data: pcm.toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" } }]
          }
        }]
      }))
    }
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mQuota.mockReturnValue({ allowed: true } as any);
  mCheckTTS.mockReturnValue({ allowed: true, usedToday: 0, limit: 10 } as any);
  mGemini.mockReturnValue(null);
  mSpawn.mockImplementation(fakeFfmpeg());
});

describe("9.18kk — pcmToWav (pur)", () => {
  it("en-tête RIFF correct : tailles, PCM, mono 16 bits, 24 kHz", () => {
    const pcm = Buffer.alloc(48000); // 1 s de silence 24 kHz 16 bits
    const wav = pcmToWav(pcm, 24000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16); // bits
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("fréquence aberrante → repli 24 kHz", () => {
    const wav = pcmToWav(Buffer.alloc(10), NaN);
    expect(wav.readUInt32LE(24)).toBe(24000);
  });
});

describe("9.18kk — chaîne synthesizeVoiceNote (Gemini → Edge)", () => {
  it("clé Gemini + quota OK → voix GEMINI (pcm→wav→ogg), Edge jamais appelé, quota consommé après succès", async () => {
    mGemini.mockReturnValue(fakeGeminiClient(Buffer.alloc(2000, 1)));
    const ogg = await synthesizeVoiceNote("Salut, je suis la voix naturelle.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsume).toHaveBeenCalledTimes(1);
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).not.toHaveBeenCalled();
  });

  it("quota IA épuisé → GEMINI SAUTÉ, Edge Henri utilisé (voix gratuite garantie)", async () => {
    mGemini.mockReturnValue(fakeGeminiClient(Buffer.alloc(2000, 1)));
    mQuota.mockReturnValue({ allowed: false } as any);
    const ogg = await synthesizeVoiceNote("Réponse en voix gratuite.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsume).not.toHaveBeenCalled();
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled();
  });

  it("pas de clé Gemini → Edge directement", async () => {
    mGemini.mockReturnValue(null);
    const ogg = await synthesizeVoiceNote("Voix de repli.");
    expect(ogg.toString()).toBe("OGG-BYTES");
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled();
  });

  it("Gemini en erreur → repli Edge intégral (jamais de silence)", async () => {
    mGemini.mockReturnValue({ models: { generateContent: vi.fn(async () => { throw new Error("429 quota TTS"); }) } } as any);
    const ogg = await synthesizeVoiceNote("Toujours une voix.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsume).not.toHaveBeenCalled(); // échec → quota non consommé
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled();
  });

  it("réponse Gemini sans audio (forme invalide) → Edge", async () => {
    mGemini.mockReturnValue({ models: { generateContent: vi.fn(async () => ({ candidates: [{ content: { parts: [{ text: "pas d'audio" }] } }] })) } } as any);
    const ogg = await synthesizeVoiceNote("Vérification de forme.");
    expect(ogg.toString()).toBe("OGG-BYTES");
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled();
  });

  it("sans sender : Gemini utilisé, aucun appel de quota", async () => {
    mGemini.mockReturnValue(fakeGeminiClient(Buffer.alloc(2000, 1)));
    const ogg = await synthesizeVoiceNote("Pas de quota à consommer.");
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsume).not.toHaveBeenCalled();
    expect(mConsumeTTS).not.toHaveBeenCalled();
  });
});

describe("9.18ll — plafond TTS dédié par utilisateur (répartition de la voix Gemini)", () => {
  it("succès Gemini → les DEUX compteurs consommés (quota IA + plafond TTS)", async () => {
    mGemini.mockReturnValue(fakeGeminiClient(Buffer.alloc(2000, 1)));
    const ogg = await synthesizeVoiceNote("Voix naturelle comptée.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsume).toHaveBeenCalledTimes(1);
    expect(mConsumeTTS).toHaveBeenCalledTimes(1);
  });

  it("plafond TTS atteint (10/10) → Gemini JAMAIS appelé, Edge Henri, aucune consommation", async () => {
    const client = fakeGeminiClient(Buffer.alloc(2000, 1));
    mGemini.mockReturnValue(client);
    mQuota.mockReturnValue({ allowed: true } as any); // quota IA général intact
    mCheckTTS.mockReturnValue({ allowed: false, usedToday: 10, limit: 10 } as any);
    const ogg = await synthesizeVoiceNote("On m'a coupé la voix naturelle.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(client.models.generateContent).not.toHaveBeenCalled();
    expect(mConsume).not.toHaveBeenCalled();
    expect(mConsumeTTS).not.toHaveBeenCalled();
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled(); // voix gratuite garantie, pas de blocage
  });

  it("Gemini en erreur (429 Google) → plafond TTS NON consommé (compté après succès seulement)", async () => {
    mGemini.mockReturnValue({ models: { generateContent: vi.fn(async () => { throw new Error("429 RESOURCE_EXHAUSTED"); }) } } as any);
    const ogg = await synthesizeVoiceNote("Google dit non.", { sender: "u@s.whatsapp.net" });
    expect(ogg.toString()).toBe("OGG-BYTES");
    expect(mConsumeTTS).not.toHaveBeenCalled();
    const { MsEdgeTTS } = await import("msedge-tts");
    expect(MsEdgeTTS).toHaveBeenCalled();
  });

  it("wiring ttsService : les gardes checkTTSQuota/consumeTTSQuota sont branchés", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/ttsService.ts"), "utf-8");
    expect(src).toContain("checkTTSQuota(opts.sender)");
    expect(src).toContain("consumeTTSQuota(opts.sender)");
  });
});
