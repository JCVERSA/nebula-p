/**
 * 9.13/9.15d — Notes vocales → agent (transcription GEMINI, audio natif).
 *
 * Historique honnête : 9.13 visait l'ASR NVIDIA NIM (endpoint OpenAI-
 * compatible /audio/transcriptions). En prod : HTTP 404 quel que soit le nom
 * de modèle — les modèles speech NIM sont des microservices Riva AUTO-HÉBERGÉS
 * (gRPC :50051 / HTTP :9000 sur son propre conteneur GPU), PAS servis par
 * integrate.api.nvidia.com. Pivot 9.15d : Gemini accepte l'AUDIO en entrée
 * native (inlineData base64) — même clé, même client que l'IA existante,
 * aucune nouvelle dépendance.
 *
 * L'utilisateur parle au bot : la note vocale est téléchargée, convertie en
 * wav 16 kHz mono par ffmpeg, puis envoyée à Gemini avec une instruction de
 * transcription stricte (réponse = texte transcrit uniquement). Le texte
 * devient le message de l'agent.
 *
 * Garde-fous :
 * - désactivable (NEBULA_ASR_ENABLED=0) et actif seulement si la clé GEMINI
 *   existe (l'audio est Gemini-only : NIM ne voit ni image ni son) ;
 * - modèle overridable (NEBULA_ASR_MODEL — défaut gemini-3.7-flash) ;
 * - budget dédié : 10 transcriptions/heure/utilisateur (en mémoire) ;
 * - tailles plafonnées (16 Mo en entrée, 12 Mo en wav ≈ 6 min — la limite
 *   inline de Gemini est ~20 Mo requête, base64 inclus) ;
 * - appel DIRECT (pas de repli NIM : il « hallucinerait » une transcription
 *   sur le seul texte d'instruction) ;
 * - échec HONNÊTE : un message clair, jamais d'exception, jamais de tour IA
 *   sur un texte vide. Rien n'est stocké au-delà du tour en cours.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { getAIClient } from "../geminiClient.js";

export const ASR_DEFAULT_MODEL = "gemini-3.7-flash";
export const ASR_MAX_INPUT_BYTES = 16 * 1024 * 1024;
/** 12 Mo wav ≈ 16 Mo en base64 — sous la limite inline (~20 Mo requête). */
export const ASR_MAX_WAV_BYTES = 12 * 1024 * 1024;
export const ASR_HOURLY_LIMIT = 10;
/**
 * 9.15e — retries sur surcharges transitoires. En prod, juste après la
 * validation du pivot : HTTP 503 « This model is currently experiencing
 * high demand… usually temporary » puis 504. Un 503 revient VITE (~1 s) :
 * backoff 1,5 s puis 4 s, 3 tentatives max ≈ 8 s au pire. Le 504 n'est
 * PAS retenté (la tentative a déjà duré ~30 s — l'utilisateur n'attendra
 * pas le double pour un deuxième délai dépassé).
 */
export const ASR_MAX_ATTEMPTS = 3;
const ASR_RETRY_BACKOFF_MS = [1500, 4000] as const;

const ASR_PROMPT = [
  "Transcris ce message vocal.",
  "Réponds UNIQUEMENT avec le texte transcrit — aucun commentaire, pas de guillemets, pas de préambule.",
  "La langue parlée est probablement le français ; si c'est une autre langue, transcris dans cette langue."
].join(" ");

export function getAsrModel(): string {
  return (process.env.NEBULA_ASR_MODEL || "").trim() || ASR_DEFAULT_MODEL;
}

/** Activé par défaut dès qu'une clé Gemini existe ; 0 = coupé. */
export function isAsrEnabled(): boolean {
  if ((process.env.NEBULA_ASR_ENABLED || "").trim() === "0") return false;
  return getAIClient() !== null;
}

// ── Budget : 10 transcriptions/heure/utilisateur (en mémoire) ──────────────
const asrUse = new Map<string, number[]>();

export function checkAsrBudget(user: string, now = Date.now()): { allowed: boolean; retryAfterMin: number } {
  const windowStart = now - 60 * 60 * 1000;
  const uses = (asrUse.get(user) || []).filter((t) => t > windowStart);
  asrUse.set(user, uses);
  if (uses.length >= ASR_HOURLY_LIMIT) {
    return { allowed: false, retryAfterMin: Math.max(1, Math.ceil((uses[0] + 60 * 60 * 1000 - now) / 60_000)) };
  }
  return { allowed: true, retryAfterMin: 0 };
}

function recordAsrUse(user: string, now = Date.now()): void {
  const uses = asrUse.get(user) || [];
  uses.push(now);
  asrUse.set(user, uses);
}

/** Tests uniquement. */
export function __resetAsrForTests(): void {
  asrUse.clear();
}

// ── Conversion ffmpeg → wav 16 kHz mono (injection pour les tests) ─────────
export type FfmpegRunner = (bin: string, args: string[]) => Promise<void>;

const defaultFfmpegRunner: FfmpegRunner = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000 }, (err) => (err ? reject(err) : resolve()));
  });

function ffmpegBin(): string {
  const override = (process.env.FFMPEG_BIN || "").trim();
  if (override) return override;
  return "ffmpeg";
}

async function convertToWav(input: Buffer, run: FfmpegRunner): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula_asr_"));
  const inPath = path.join(dir, "in.ogg");
  const outPath = path.join(dir, "out.wav");
  try {
    fs.writeFileSync(inPath, input);
    await run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath]);
    return fs.readFileSync(outPath);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// ── Transcription (appel Gemini direct et strict) ──────────────────────────
export type AsrParts = Array<Record<string, unknown>>;

export interface AsrOptions {
  /** Injection pour les tests : génère la transcription depuis les parts. */
  generate?: (parts: AsrParts, model: string) => Promise<string | null>;
  /** Injection pour les tests : lanceur ffmpeg. */
  ffmpegRun?: FfmpegRunner;
  /** Injection pour les tests : attente de backoff entre les tentatives. */
  sleep?: (ms: number) => Promise<void>;
}

export type AsrResult = { ok: true; text: string } | { ok: false; error: string };

/** 9.15e — échec transitoire (surcharge/réseau) qui mérite une nouvelle tentative. */
export function isTransientAsrError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const status = Number(e?.status ?? e?.code ?? NaN);
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  return /fetch failed|econnreset|etimedout|socket hang up/i.test(String(e?.message || ""));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function defaultGenerate(parts: AsrParts, model: string): Promise<string | null> {
  const ai = getAIClient();
  if (!ai) throw new Error("Gemini non configuré");
  const response = await ai.models.generateContent({
    model,
    contents: parts,
    config: { httpOptions: { timeout: 30_000 } }
  });
  return response?.text || null;
}

export async function transcribeVoiceNote(input: Buffer, options: AsrOptions = {}): Promise<AsrResult> {
  if (!isAsrEnabled()) {
    return { ok: false, error: "transcription désactivée (NEBULA_ASR_ENABLED=0) ou clé Gemini absente" };
  }
  if (!input.length) return { ok: false, error: "note vocale vide" };
  if (input.length > ASR_MAX_INPUT_BYTES) {
    return { ok: false, error: `note vocale trop lourde (${Math.round(input.length / 1024 / 1024)} Mo, max ${ASR_MAX_INPUT_BYTES / 1024 / 1024})` };
  }
  let wav: Buffer;
  try {
    wav = await convertToWav(input, options.ffmpegRun || defaultFfmpegRunner);
  } catch (err: any) {
    return { ok: false, error: `conversion ffmpeg impossible (${err?.message || err})` };
  }
  if (!wav.length) return { ok: false, error: "conversion ffmpeg invalide" };
  if (wav.length > ASR_MAX_WAV_BYTES) {
    return { ok: false, error: `note vocale trop longue (max ~${Math.floor(ASR_MAX_WAV_BYTES / 1024 / 1024 / 2)} min)` };
  }
  const parts: AsrParts = [
    { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
    { text: ASR_PROMPT }
  ];
  const generate = options.generate || defaultGenerate;
  const sleep = options.sleep || defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ASR_MAX_ATTEMPTS; attempt++) {
    try {
      const text = await generate(parts, getAsrModel());
      if (typeof text === "string" && text.trim()) return { ok: true, text: text.trim() };
      return { ok: false, error: "réponse de transcription vide" };
    } catch (err) {
      lastError = err;
      if (attempt < ASR_MAX_ATTEMPTS && isTransientAsrError(err)) {
        await sleep(ASR_RETRY_BACKOFF_MS[attempt - 1]);
        continue;
      }
      break;
    }
  }
  const e = lastError as { status?: unknown; code?: unknown; message?: string };
  const status = e?.status || e?.code;
  if (status === 503 || status === 504) {
    return { ok: false, error: `HTTP ${status} : modèle Gemini momentanément surchargé — réessaie dans quelques instants` };
  }
  const detail = e?.message || String(lastError);
  return { ok: false, error: status ? `HTTP ${status} : ${detail}` : detail };
}

/** Consomme un crédit budget après un succès (échec = pas facturé). */
export function chargeAsrBudget(user: string): void {
  recordAsrUse(user);
}
