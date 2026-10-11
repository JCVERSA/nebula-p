import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  ASR_DEFAULT_MODEL,
  ASR_HOURLY_LIMIT,
  ASR_MAX_INPUT_BYTES,
  ASR_MAX_WAV_BYTES,
  __resetAsrForTests,
  checkAsrBudget,
  chargeAsrBudget,
  getAsrModel,
  isAsrEnabled,
  transcribeVoiceNote,
  type AsrParts
} from "../src/bot/services/voiceTranscribe.js";

beforeEach(() => {
  __resetAsrForTests();
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.NEBULA_ASR_ENABLED;
  delete process.env.NEBULA_ASR_MODEL;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.NEBULA_ASR_ENABLED;
  delete process.env.NEBULA_ASR_MODEL;
});

// ── Pure : activation, modèle, budget ───────────────────────────────────────
describe("9.15d — voiceTranscribe (pur)", () => {
  it("isAsrEnabled : activé avec clé Gemini, coupé par NEBULA_ASR_ENABLED=0 ou sans clé", () => {
    expect(isAsrEnabled()).toBe(true);
    process.env.NEBULA_ASR_ENABLED = "0";
    expect(isAsrEnabled()).toBe(false);
    process.env.NEBULA_ASR_ENABLED = "1";
    delete process.env.GEMINI_API_KEY;
    expect(isAsrEnabled()).toBe(false); // l'audio est Gemini-only
  });

  it("getAsrModel : défaut gemini-3.7-flash, overridable", () => {
    expect(getAsrModel()).toBe(ASR_DEFAULT_MODEL);
    expect(ASR_DEFAULT_MODEL).toBe("gemini-3.7-flash");
    process.env.NEBULA_ASR_MODEL = "gemini-3.5-flash";
    expect(getAsrModel()).toBe("gemini-3.5-flash");
  });

  it("budget : 10/heure/utilisateur, échec non facturé, fenêtre glissante", () => {
    const u = "u@s.whatsapp.net";
    for (let i = 0; i < ASR_HOURLY_LIMIT; i++) {
      expect(checkAsrBudget(u).allowed).toBe(true);
      chargeAsrBudget(u);
    }
    const blocked = checkAsrBudget(u);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMin).toBeGreaterThan(0);
    expect(checkAsrBudget("v@s.whatsapp.net").allowed).toBe(true);
    const later = Date.now() + 61 * 60 * 1000;
    expect(checkAsrBudget(u, later).allowed).toBe(true);
  });
});

// ── Intégration avec injection (generate + ffmpeg fake) ────────────────────
describe("9.15d — transcribeVoiceNote (injecté, pivot Gemini)", () => {
  const fakeFfmpeg = async (_bin: string, args: string[]): Promise<void> => {
    const out = args[args.indexOf("-f") + 2] ?? args[args.length - 1];
    fs.writeFileSync(out, Buffer.from("RIFF-fake-wav-16k-mono"));
  };

  it("succès : ffmpeg wav → parts Gemini (inlineData audio/wav + prompt strict) → texte", async () => {
    const generate = vi.fn(async (parts: AsrParts, model: string) => {
      expect(model).toBe("gemini-3.7-flash");
      expect(parts).toHaveLength(2);
      const audio = parts[0] as { inlineData: { mimeType: string; data: string } };
      expect(audio.inlineData.mimeType).toBe("audio/wav");
      const decoded = Buffer.from(audio.inlineData.data, "base64").toString("latin1");
      expect(decoded).toContain("RIFF-fake-wav-16k-mono"); // le wav voyage INTÉGRALEMENT
      const textPart = parts[1] as { text: string };
      expect(textPart.text).toContain("Transcris ce message vocal");
      expect(textPart.text).toContain("UNIQUEMENT");
      return "  télécharge l'épisode 5 de jjk en 480p  ";
    });
    const res = await transcribeVoiceNote(Buffer.from("oggdata"), { generate, ffmpegRun: fakeFfmpeg });
    expect(res).toEqual({ ok: true, text: "télécharge l'épisode 5 de jjk en 480p" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("réponse vide ou blanche → erreur honnête, pas de texte inventé", async () => {
    expect((await transcribeVoiceNote(Buffer.from("ogg"), { generate: async () => null, ffmpegRun: fakeFfmpeg })).ok).toBe(false);
    expect((await transcribeVoiceNote(Buffer.from("ogg"), { generate: async () => "   ", ffmpegRun: fakeFfmpeg })).ok).toBe(false);
  });

  it("échec Gemini → erreur honnête qui remonte le détail", async () => {
    const res = await transcribeVoiceNote(Buffer.from("ogg"), {
      generate: async () => { throw Object.assign(new Error("quota exceeded"), { status: 429 }); },
      ffmpegRun: fakeFfmpeg
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("429");
  });

  it("désactivé / sans clé / entrée vide ou trop lourde → refus SANS appel réseau", async () => {
    const generate = vi.fn();
    process.env.NEBULA_ASR_ENABLED = "0";
    expect((await transcribeVoiceNote(Buffer.from("x"), { generate })).ok).toBe(false);
    process.env.NEBULA_ASR_ENABLED = "1";
    delete process.env.GEMINI_API_KEY;
    expect((await transcribeVoiceNote(Buffer.from("x"), { generate })).ok).toBe(false);
    process.env.GEMINI_API_KEY = "test-gemini-key";
    expect((await transcribeVoiceNote(Buffer.alloc(0), { generate })).ok).toBe(false);
    expect((await transcribeVoiceNote(Buffer.alloc(ASR_MAX_INPUT_BYTES + 1024 * 1024), { generate })).ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("wav converti trop long (note ~> 6 min) → refus honnête avant l'appel", async () => {
    const bigFfmpeg = async (_bin: string, args: string[]): Promise<void> => {
      const out = args[args.indexOf("-f") + 2] ?? args[args.length - 1];
      fs.writeFileSync(out, Buffer.alloc(ASR_MAX_WAV_BYTES + 1024 * 1024, 1)); // wav géant
    };
    const generate = vi.fn();
    const res = await transcribeVoiceNote(Buffer.from("ogg-long"), { generate, ffmpegRun: bigFfmpeg });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("trop longue");
    expect(generate).not.toHaveBeenCalled();
  });

  it("ffmpeg absent → erreur honnête, pas d'exception", async () => {
    const bad = async (): Promise<void> => { throw new Error("spawn ENOENT"); };
    const res = await transcribeVoiceNote(Buffer.from("ogg"), { ffmpegRun: bad });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ffmpeg");
  });

  it("wiring botEngine : branche note vocale derrière la porte d'adressage, budget, honnêteté (Gemini)", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");
    expect(src).toContain("messageContent.audioMessage");
    expect(src).toContain("!isGroup || messageAddressesBot(msg, sock?.user?.id)");
    expect(src).toContain("checkAsrBudget(actualSenderJid)");
    expect(src).toContain("chargeAsrBudget(actualSenderJid)");
    expect(src).toContain("voiceNote: true");
    expect(src).toContain("transcription désactivée ou clé Gemini absente");
  });

  it("wiring agentRunner : le drapeau voiceNote produit un bloc dédié", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/agentRunner.ts"), "utf-8");
    expect(src).toContain("transcription d'une note vocale");
    expect(src).toContain("info.voiceNote");
  });
});
