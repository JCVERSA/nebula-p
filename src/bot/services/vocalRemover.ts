/**
 * Vocal separation orchestration (audit 8.49, 2026-09-02).
 *
 * WhatsApp entry points: `.m karaoké` (instrumental) and `.m voix` (vocal
 * stem). The heavy lifting happens in `python/uvr_runner.py` — an independent
 * MDX-Net ONNX implementation inspired by the Ultimate-Vocal-RemoverGUI
 * ecosystem (no code from that project; only its freely distributed model
 * files, installed by scripts/uvr-setup.sh with a pinned sha256).
 *
 * Pipeline: WhatsApp media → ffmpeg decode (44.1 kHz stereo WAV) → runner
 * (chunked STFT → ONNX → iSTFT, RAM-capped) → two WAV stems → MP3 192k for
 * delivery. One separation at a time (shared VPS CPU/RAM).
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildMp3Args, probeVideoInfo, runFfmpegKit } from "./mediaToolkit.js";

export const MAX_UVR_SECONDS = 8 * 60; // audio length cap (CPU/RAM fairness)
export const UVR_RUNNER_TIMEOUT_MS = 10 * 60 * 1000;

export interface VocalSeparationResult {
  vocalsMp3: string;
  instrumentalMp3: string;
  seconds: number;
}

/** Single-flight lock shared with the .m entry points. */
export const uvrBusy = { active: false };

function repoRoot(): string {
  // dist/server.cjs runs from the repo root; dev runs from the root too.
  return process.cwd();
}

export function uvrRunnerPaths(): { python: string; runner: string; model: string } {
  const root = repoRoot();
  return {
    python: path.join(root, ".uvr-venv", "bin", "python"),
    runner: path.join(root, "python", "uvr_runner.py"),
    model: process.env.NEBULA_UVR_MODEL || path.join(root, "models", "uvr", "Kim_Vocal_2.onnx")
  };
}

/** True when the sidecar, the venv python and the model are all present. */
export function isVocalSeparationAvailable(): boolean {
  if (process.env.NEBULA_UVR_DISABLED === "1") return false;
  const { python, runner, model } = uvrRunnerPaths();
  return fs.existsSync(python) && fs.existsSync(runner) && fs.existsSync(model);
}

function tmpFile(name: string): string {
  return path.join(os.tmpdir(), `nebula_uvr_${Date.now()}_${name}`);
}

/**
 * Runs the full separation. Throws with a user-presentable message on any
 * failure. The caller owns cleanup of the returned files after delivery.
 */
export async function separateVocals(inputMediaPath: string): Promise<VocalSeparationResult> {
  const { python, runner, model } = uvrRunnerPaths();

  const info = await probeVideoInfo(inputMediaPath);
  if (info.durationSec && info.durationSec > MAX_UVR_SECONDS) {
    throw new Error(`Piste trop longue (${Math.round(info.durationSec / 60)} min) — maximum ${MAX_UVR_SECONDS / 60} min.`);
  }

  const wavPath = tmpFile("input.wav");
  const vocWav = tmpFile("vocals.wav");
  const instWav = tmpFile("instrumental.wav");
  const vocMp3 = tmpFile("vocals.mp3");
  const instMp3 = tmpFile("instrumental.mp3");

  // 1. Decode to the runner's contract: stereo 44.1 kHz PCM WAV.
  const decode = await runFfmpegKit(
    ["-y", "-i", inputMediaPath, "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", wavPath],
    180000
  );
  if (!decode.ok || !fs.existsSync(wavPath)) {
    throw new Error("Décodage audio impossible — format non supporté.");
  }

  // 2. Run the sidecar (progress lines forwarded to the server log).
  const stdout = await new Promise<string>((resolve, reject) => {
    let out = "";
    let settled = false;
    try {
      const child = spawn(python, [
        runner,
        "--input", wavPath,
        "--vocals", vocWav,
        "--instrumental", instWav,
        "--model", model
      ]);
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        if (!settled) { settled = true; reject(new Error("Séparation interrompue (délai dépassé, 10 min).")); }
      }, UVR_RUNNER_TIMEOUT_MS);
      child.stdout?.on("data", (d: Buffer) => {
        const text = d.toString();
        out += text;
        for (const line of text.split("\n")) {
          if (line.startsWith("PROGRESS")) console.log(`[UVR] ${line.trim()}`);
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (text.trim()) console.warn(`[UVR:stderr] ${text.trim().slice(0, 300)}`);
      });
      child.on("error", err => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error(`Runner indisponible: ${err.message}`)); }
      });
      child.on("close", code => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          if (code === 0) resolve(out);
          else reject(new Error(runnerError(out)));
        }
      });
    } catch (err: any) {
      reject(new Error(`Runner indisponible: ${err?.message}`));
    }
  });

  const doneLine = stdout.split("\n").find(l => l.startsWith("DONE"));
  if (!doneLine || !fs.existsSync(vocWav) || !fs.existsSync(instWav)) {
    throw new Error("La séparation n'a pas produit de résultat.");
  }
  let seconds = 0;
  try {
    seconds = JSON.parse(doneLine.slice(5).trim()).seconds || 0;
  } catch {}

  // 3. Encode both stems as MP3 192k for WhatsApp delivery.
  for (const [src, dst] of ([[vocWav, vocMp3], [instWav, instMp3]] as const)) {
    const enc = await runFfmpegKit(buildMp3Args(src, dst, 192), 300000);
    if (!enc.ok || !fs.existsSync(dst)) {
      throw new Error("Encodage MP3 des stems impossible.");
    }
  }

  for (const p of [wavPath, vocWav, instWav]) {
    try { fs.unlinkSync(p); } catch {}
  }
  return { vocalsMp3: vocMp3, instrumentalMp3: instMp3, seconds };
}

function runnerError(stdout: string): string {
  const errLine = stdout.split("\n").find(l => l.startsWith("ERROR"));
  const raw = errLine ? errLine.slice(6).trim() : "échec inconnu";
  if (/memory/i.test(raw)) return "Pas assez de mémoire sur le serveur pour cette piste — réessaie avec un extrait plus court.";
  if (/model not found/i.test(raw)) return "Modèle de séparation absent sur le serveur (nebula setup).";
  if (/expected 44100/i.test(raw)) return "Format audio inattendu.";
  return `Séparation échouée (${raw.slice(0, 120)}).`;
}

/** Cleanup helper for the command layer. */
export function cleanupUvrFiles(files: Array<string | undefined>): void {
  for (const f of files) {
    if (f && fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}
