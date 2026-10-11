/**
 * 9.13 — Notes vocales → agent (décision owner, inspiré de free-claude-code).
 *
 * L'utilisateur parle au bot : la note vocale est téléchargée, convertie en
 * wav 16 kHz mono par ffmpeg, puis transcrite par l'API NVIDIA NIM (endpoint
 * OpenAI-compatible /audio/transcriptions — la MÊME clé que le fallback IA,
 * aucune nouvelle dépendance). Le texte transcrit devient le message de
 * l'agent.
 *
 * Garde-fous :
 * - désactivable (NEBULA_ASR_ENABLED=0) et activé seulement si la clé NIM
 *   existe (l'ASR est NIM-only) ;
 * - modèle override (NEBULA_ASR_MODEL — copier l'id exact depuis
 *   build.nvidia.com ; défaut openai/whisper-large-v3) ;
 * - budget dédié : 10 transcriptions/heure/utilisateur (en mémoire — même
 *   école que les budgets IA/web) ;
 * - tailles plafonnées (16 Mo en entrée, 40 Mo en wav) et timeout 30 s ;
 * - échec HONNÊTE : un message clair, jamais d'exception, jamais de tour IA
 *   sur un texte vide. Rien n'est stocké : la transcription sert au tour en
 *   cours, la mémoire longue ne la conserve que comme texte normal.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { isNimConfigured, getNimApiKey } from "../nimClient.js";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const ASR_PATH = "/audio/transcriptions";

// 9.15c (retour prod 404) : sur build.nvidia.com les modèles ASR vivent
// avec des slugs SANS préfixe éditeur (whisper-large-v3, canary-1b-asr…),
// contrairement aux modèles de chat (nvidia/nemotron-…). Le préfixe
// openai/ provoquait un HTTP 404 sur la vraie clé.
export const ASR_DEFAULT_MODEL = "whisper-large-v3";
export const ASR_MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const ASR_MAX_WAV_BYTES = 40 * 1024 * 1024;
export const ASR_TIMEOUT_MS = 30_000;
export const ASR_HOURLY_LIMIT = 10;

export function getAsrModel(): string {
  return (process.env.NEBULA_ASR_MODEL || "").trim() || ASR_DEFAULT_MODEL;
}

/** Activé par défaut dès qu'une clé NIM existe ; 0 = coupé. */
export function isAsrEnabled(): boolean {
  if ((process.env.NEBULA_ASR_ENABLED || "").trim() === "0") return false;
  return isNimConfigured();
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

/** Résolution partagée (audit 8.29) : FFMPEG_BIN > système > ffmpeg-static. */
function ffmpegBin(): string {
  const override = (process.env.FFMPEG_BIN || "").trim();
  if (override) return override;
  // même ordre que ffmpeg.ts, sans import direct (celui-ci résout au chargement)
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

// ── Corps multipart (PUR — testé) ──────────────────────────────────────────
export function buildAsrMultipartBody(model: string, wav: Buffer, boundary: string): { body: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  const crlf = Buffer.from("\r\n");
  // champ model (texte)
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`));
  // fichier audio
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`)
  );
  parts.push(wav);
  parts.push(crlf);
  // champ language (français par défaut — l'agent répond déjà dans la langue
  // de l'utilisateur ; forcer fr évite les transcriptions phonétiques anglaises)
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ── Transcription ──────────────────────────────────────────────────────────
export interface AsrOptions {
  /** Injection pour les tests : un post axios-like. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post?: (url: string, body: unknown, config: any) => Promise<{ data: any }>;
  /** Injection pour les tests : lanceur ffmpeg. */
  ffmpegRun?: FfmpegRunner;
  boundary?: string;
}

export type AsrResult = { ok: true; text: string } | { ok: false; error: string };

export async function transcribeVoiceNote(input: Buffer, options: AsrOptions = {}): Promise<AsrResult> {
  if (!isAsrEnabled()) {
    return { ok: false, error: "ASR désactivé (NEBULA_ASR_ENABLED=0 ou clé NVIDIA NIM absente)" };
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
  if (!wav.length || wav.length > ASR_MAX_WAV_BYTES) {
    return { ok: false, error: "conversion ffmpeg invalide" };
  }
  const boundary = options.boundary || `nebula-asr-${Date.now().toString(16)}`;
  const { body, contentType } = buildAsrMultipartBody(getAsrModel(), wav, boundary);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = options.post || ((url: string, b: unknown, cfg: any) => axios.post(url, b, cfg));
  try {
    const res = await post(`${NIM_BASE_URL}${ASR_PATH}`, body, {
      headers: {
        Authorization: `Bearer ${getNimApiKey()}`,
        "Content-Type": contentType,
        Accept: "application/json"
      },
      timeout: ASR_TIMEOUT_MS,
      maxBodyLength: ASR_MAX_WAV_BYTES + 1024
    });
    const text = res?.data?.text;
    if (typeof text === "string" && text.trim()) return { ok: true, text: text.trim() };
    return { ok: false, error: "réponse ASR vide" };
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.error?.message || err?.message || String(err);
    if (status === 404 || status === 410) {
      return {
        ok: false,
        error: `modèle ASR indisponible sur cette clé (HTTP ${status}) — vérifie le nom exact sur build.nvidia.com et règle NEBULA_ASR_MODEL (${getAsrModel()})`
      };
    }
    return { ok: false, error: status ? `HTTP ${status} : ${detail}` : detail };
  }
}

/** Consomme un crédit budget après un succès (échec = pas facturé). */
export function chargeAsrBudget(user: string): void {
  recordAsrUse(user);
}
