import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  ASR_DEFAULT_MODEL,
  ASR_HOURLY_LIMIT,
  __resetAsrForTests,
  buildAsrMultipartBody,
  checkAsrBudget,
  chargeAsrBudget,
  getAsrModel,
  isAsrEnabled,
  transcribeVoiceNote
} from "../src/bot/services/voiceTranscribe.js";

const KEY = "nvapi-test-key-123";

beforeEach(() => {
  __resetAsrForTests();
  process.env.NVIDIA_NIM_API_KEY = KEY;
  delete process.env.NEBULA_ASR_ENABLED;
  delete process.env.NEBULA_ASR_MODEL;
});

afterEach(() => {
  delete process.env.NVIDIA_NIM_API_KEY;
  delete process.env.NEBULA_ASR_ENABLED;
  delete process.env.NEBULA_ASR_MODEL;
});

// ── Pure : activation, modèle, multipart ───────────────────────────────────
describe("9.13 — voiceTranscribe (pur)", () => {
  it("isAsrEnabled : activé avec clé NIM, coupé par NEBULA_ASR_ENABLED=0 ou sans clé", () => {
    expect(isAsrEnabled()).toBe(true);
    process.env.NEBULA_ASR_ENABLED = "0";
    expect(isAsrEnabled()).toBe(false);
    process.env.NEBULA_ASR_ENABLED = "1";
    delete process.env.NVIDIA_NIM_API_KEY;
    expect(isAsrEnabled()).toBe(false);
  });

  it("getAsrModel : défaut whisper-large-v3, overridable", () => {
    expect(getAsrModel()).toBe(ASR_DEFAULT_MODEL);
    process.env.NEBULA_ASR_MODEL = "nvidia/canary-1b";
    expect(getAsrModel()).toBe("nvidia/canary-1b");
  });

  it("buildAsrMultipartBody : model + fichier + language, wav INTACT, limite cohérente", () => {
    const wav = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
    const { body, contentType } = buildAsrMultipartBody("whisper-large-v3", wav, "boundary-x");
    expect(contentType).toBe("multipart/form-data; boundary=boundary-x");
    const s = body.toString("latin1");
    expect(s).toContain('name="model"');
    expect(s).toContain("whisper-large-v3");
    expect(s).toContain('name="file"; filename="audio.wav"');
    expect(s).toContain('name="language"');
    expect(s).toContain("fr");
    expect(s.trimEnd().endsWith("--boundary-x--")).toBe(true);
    // le wav binaire est présent INTÉGRALEMENT (pas de corruption texte)
    expect(body.indexOf(wav)).toBeGreaterThan(0);
    expect(body.lastIndexOf(wav)).toBe(body.indexOf(wav));
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
    // un autre utilisateur n'est pas pénalisé
    expect(checkAsrBudget("v@s.whatsapp.net").allowed).toBe(true);
    // fenêtre glissante : 61 min plus tard, tout est retombé
    const later = Date.now() + 61 * 60 * 1000;
    expect(checkAsrBudget(u, later).allowed).toBe(true);
  });
});

// ── Intégration avec injection (post + ffmpeg fake) ────────────────────────
describe("9.13 — transcribeVoiceNote (injecté)", () => {
  const fakeFfmpeg = async (_bin: string, args: string[]): Promise<void> => {
    const out = args[args.indexOf("-f") + 2] ?? args[args.length - 1];
    fs.writeFileSync(out, Buffer.from("RIFF-fake-wav-16k-mono"));
  };

  it("succès : ffmpeg → multipart → texte extrait", async () => {
    const post = vi.fn(async (url: string, body: unknown, cfg: any) => {
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(url).toBe("https://integrate.api.nvidia.com/v1/audio/transcriptions");
      expect(cfg.headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(cfg.headers["Content-Type"]).toContain("multipart/form-data");
      expect((body as Buffer).toString("latin1")).toContain("whisper-large-v3");
      return { data: { text: "  télécharge l'épisode 5 de jjk en 480p  " } };
    });
    const res = await transcribeVoiceNote(Buffer.from("oggdata"), { post, ffmpegRun: fakeFfmpeg, boundary: "b-test" });
    expect(res).toEqual({ ok: true, text: "télécharge l'épisode 5 de jjk en 480p" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("modèle indisponible (404/410) → erreur honnête qui nomme NEBULA_ASR_MODEL", async () => {
    const err: any = { response: { status: 404, data: { error: { message: "model not found" } } } };
    const post = vi.fn(async () => Promise.reject(err));
    const res = await transcribeVoiceNote(Buffer.from("ogg"), { post, ffmpegRun: fakeFfmpeg });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("NEBULA_ASR_MODEL");
      expect(res.error).toContain("build.nvidia.com");
    }
  });

  it("ASR désactivé ou entrée vide/trop lourde → refus sans appel réseau", async () => {
    process.env.NEBULA_ASR_ENABLED = "0";
    const post = vi.fn();
    expect((await transcribeVoiceNote(Buffer.from("x"), { post })).ok).toBe(false);
    process.env.NEBULA_ASR_ENABLED = "1";
    expect((await transcribeVoiceNote(Buffer.alloc(0), { post })).ok).toBe(false);
    expect((await transcribeVoiceNote(Buffer.alloc(17 * 1024 * 1024), { post })).ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("ffmpeg absent → erreur honnête, pas d'exception", async () => {
    const bad = async (): Promise<void> => { throw new Error("spawn ENOENT"); };
    const res = await transcribeVoiceNote(Buffer.from("ogg"), { ffmpegRun: bad });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ffmpeg");
  });

  it("wiring botEngine : branche note vocale derrière la porte d'adressage, budget, honnêteté", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");
    expect(src).toContain("messageContent.audioMessage");
    expect(src).toContain("!isGroup || messageAddressesBot(msg, sock?.user?.id)");
    expect(src).toContain("checkAsrBudget(actualSenderJid)");
    expect(src).toContain("chargeAsrBudget(actualSenderJid)");
    expect(src).toContain("voiceNote: true");
    expect(src).toContain("transcription désactivée ou clé NVIDIA NIM absente");
  });

  it("wiring agentRunner : le drapeau voiceNote produit un bloc dédié (et rien sinon)", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/agentRunner.ts"), "utf-8");
    expect(src).toContain("transcription d'une note vocale");
    expect(src).toContain("info.voiceNote");
  });
});
