/**
 * Media toolkit (audit 8.48, 2026-09-02) — FFmpeg recipes for the `.m`
 * command and deterministic WhatsApp-fit compression.
 *
 * Techniques retained from two evaluated repos (audit 9.7, zero code taken):
 * - addyosmani/video-compress: file-size targeting
 *   `videoKbps = targetMB × 8192 / duration − audioKbps` (their version
 *   forgets to subtract the audio track — ours does) and the percentage→CRF
 *   mapping `crf = 51 − pct/100 × 33`.
 * - DivyanshuChipa/sadness-splitter: chained `atempo` for speed factors
 *   beyond the per-filter 2.0 limit, the quality GIF recipe
 *   (fps+lanczos+palettegen/paletteuse), aspect-preserving scale+pad.
 *
 * Everything argument-related is a PURE function so it is fully unit
 * testable without an FFmpeg binary; only `probeVideoInfo` and
 * `runFfmpegKit` touch the system.
 */

import { spawn } from "child_process";
import fs from "fs";
import { resolvedFfmpegPath } from "../ffmpeg.js";

export const WHATSAPP_DOC_SAFE_MB = 90; // delivery-as-document ceiling (buffer under the ~95 MB cap)

// ---------------------------------------------------------------------------
// Pure formulas
// ---------------------------------------------------------------------------

/** Percentage of original quality → x264 CRF (100%→18, 50%→34, 0%→51; clamped). */
export function crfFromPercentage(pct: number): number {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 50;
  return Math.min(51, Math.max(18, Math.round(51 - (p / 100) * 33)));
}

/**
 * Video bitrate (kbps) that lands the OUTPUT at targetMB including audio.
 * audioKbps is subtracted FIRST — omitting it is the classic mistake that
 * makes "target 95 MB" outputs overshoot.
 */
export function videoBitrateKbpsForTargetMb(targetMB: number, durationSec: number, audioKbps = 96): number {
  const totalKbps = Math.floor((targetMB * 8192) / Math.max(1, durationSec));
  return Math.min(4000, Math.max(120, totalKbps - audioKbps));
}

/** Expected output size (MB) for given bitrates — inverse of the formula above. */
export function estimateSizeMb(durationSec: number, videoKbps: number, audioKbps = 96): number {
  return ((videoKbps + audioKbps) * Math.max(0, durationSec)) / 8192;
}

/** `atempo` is limited to [0.5, 2.0] per instance — chain chunks for bigger factors. */
export function atempoChain(factor: number): string[] {
  const f = Math.min(4, Math.max(0.5, factor));
  // NOTE: f is clamped to >= 0.5 above, so a single final atempo always
  // suffices at the low end — only the >2 side needs chaining.
  const parts: string[] = [];
  let remaining = f;
  while (remaining > 2.0 + 1e-9) {
    parts.push("atempo=2");
    remaining /= 2.0;
  }
  parts.push(`atempo=${+remaining.toFixed(4)}`);
  return parts;
}

/** filter_complex for speed changes (video PTS + chained audio tempo). */
export function speedFilterComplex(factor: number, hasAudio: boolean): string {
  const pts = (1 / Math.min(4, Math.max(0.5, factor))).toFixed(6);
  const video = `[0:v]setpts=${pts}[v]`;
  if (!hasAudio) return video;
  return `${video};[0:a]${atempoChain(factor).join(",")}[a]`;
}

/** Quality GIF filter chain (lanczos + palette). */
export function gifVideoFilter(fps: number, width: number): string {
  return `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
}

/** Aspect-preserving resize to an exact canvas (no distortion). */
export function scalePadFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

/** "90" | "1:30" | "12:05:30" | "1m30" → seconds (null when unparsable). */
export function parseTimeSpec(spec: string): number | null {
  const s = (spec || "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    if (m[3] !== undefined) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    if (+m[2] > 59) return null;
    return +m[1] * 60 + +m[2];
  }
  m = s.match(/^(\d+)m(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(\d+(?:\.\d+)?)s?$/);
  if (m) return Math.round(+m[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Argument builders (pure)
// ---------------------------------------------------------------------------

export function buildMp3Args(input: string, output: string, kbps: number): string[] {
  const rate = [96, 128, 192, 320].includes(kbps) ? kbps : 192;
  return ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", `${rate}k`, output];
}

export function buildGifArgs(input: string, output: string, fps: number, width: number, maxDurationSec: number): string[] {
  const f = Math.min(24, Math.max(5, Math.round(fps)));
  const w = Math.min(1280, Math.max(160, Math.round(width / 2) * 2));
  return ["-y", "-t", String(Math.max(1, maxDurationSec)), "-i", input, "-vf", gifVideoFilter(f, w), "-loop", "0", output];
}

export function buildSpeedArgs(input: string, output: string, factor: number, hasAudio: boolean): string[] {
  const f = Math.min(4, Math.max(0.5, factor));
  const args = ["-y", "-i", input, "-filter_complex", speedFilterComplex(f, hasAudio), "-map", "[v]"];
  if (hasAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "128k");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-movflags", "+faststart", output);
  return args;
}

/** Lossless cut (stream copy) — start inclusive, end exclusive. */
export function buildTrimArgs(input: string, output: string, startSec: number, endSec: number): string[] {
  return ["-y", "-ss", String(Math.max(0, startSec)), "-to", String(Math.max(startSec + 1, endSec)), "-i", input, "-c", "copy", "-movflags", "+faststart", output];
}

export interface CompressOptions {
  mode: "pct" | "mb" | "crf";
  value: number; // percentage 0-100, target MB, or CRF 18-51
  durationSec?: number | null;
  heightCap?: number; // downscale to this height when source is taller
}

/**
 * WhatsApp-fit compression args. Modes:
 * - pct: quality percentage → CRF (annotated scale, video-compress formula)
 * - mb: deterministic size target (bitrate computed WITH audio subtracted)
 * - crf: explicit CRF
 */
export function buildCompressArgs(input: string, output: string, opts: CompressOptions): { args: string[]; videoKbps: number | null; note: string } {
  const audioKbps = 96;
  const args = ["-y", "-i", input];
  let videoKbps: number | null = null;
  let note = "";

  if (opts.mode === "mb") {
    if (!opts.durationSec || opts.durationSec <= 0) {
      // duration unknown → cannot compute a bitrate; fall back to CRF 28
      args.push("-c:v", "libx264", "-crf", "28", "-preset", "veryfast");
      note = "durée inconnue — CRF 28 appliqué";
    } else {
      videoKbps = videoBitrateKbpsForTargetMb(opts.value, opts.durationSec, audioKbps);
      args.push("-c:v", "libx264", "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.45)}k`, "-bufsize", `${Math.round(videoKbps * 2)}k`, "-preset", "veryfast");
      note = `${estimateSizeMb(opts.durationSec, videoKbps, audioKbps).toFixed(1)} MB estimés`;
    }
  } else {
    const crf = opts.mode === "pct" ? crfFromPercentage(opts.value) : Math.min(51, Math.max(18, Math.round(opts.value)));
    args.push("-c:v", "libx264", "-crf", String(crf), "-preset", "veryfast");
    note = `CRF ${crf}`;
  }

  if (opts.heightCap && opts.heightCap > 0) {
    args.push("-vf", `scale=-2:min(${Math.round(opts.heightCap)}\\,ih)`);
  }
  args.push("-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart", output);
  return { args, videoKbps, note };
}

/**
 * WhatsApp-fit output OPTIONS ONLY (no -y/-i/output) for splicing into an
 * existing arg array: deterministic -b:v computed from the duration (audio
 * subtracted, maxrate clamp), 480p cap via min() so short/tall sources are
 * never upscaled. Returns null when the duration is unknown (caller keeps
 * its legacy args).
 */
export function whatsappFitVideoOptions(
  durationSec: number | null | undefined,
  targetMB = 92,
  heightCap = 480,
  audioKbps = 96
): { options: string[]; videoKbps: number; note: string } | null {
  if (!durationSec || durationSec <= 0) return null;
  const videoKbps = videoBitrateKbpsForTargetMb(targetMB, durationSec, audioKbps);
  return {
    options: [
      "-c:v", "libx264",
      "-b:v", `${videoKbps}k`,
      "-maxrate", `${Math.round(videoKbps * 1.45)}k`,
      "-bufsize", `${Math.round(videoKbps * 2)}k`,
      "-preset", "veryfast",
      "-vf", `scale=-2:min(${heightCap}\\,ih)`
    ],
    videoKbps,
    note: `${estimateSizeMb(durationSec, videoKbps, audioKbps).toFixed(1)} MB estimés`
  };
}

// ---------------------------------------------------------------------------
// System-touching helpers (thin, bounded)
// ---------------------------------------------------------------------------

export interface VideoInfo {
  durationSec: number | null;
  height: number | null;
  hasAudio: boolean;
  sizeBytes: number;
}

/** One ffprobe call: duration + height + audio presence (bounded, never throws). */
export function probeVideoInfo(filePath: string, timeoutMs = 8000): Promise<VideoInfo> {
  return new Promise(resolve => {
    const fallback: VideoInfo = { durationSec: null, height: null, hasAudio: false, sizeBytes: 0 };
    try {
      const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      const p = spawn("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1",
        filePath
      ]);
      let out = "";
      p.stdout.on("data", (d: Buffer) => (out += d.toString()));
      p.on("error", () => resolve(fallback));

      // audio probe in parallel via a second bounded call
      const pa = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath]);
      let audioOut = "";
      pa.stdout.on("data", (d: Buffer) => (audioOut += d.toString()));
      pa.on("error", () => {});

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const heightMatch = out.match(/height=(\d+)/i);
        const durationMatch = out.match(/duration=([\d.]+)/i);
        resolve({
          durationSec: durationMatch ? parseFloat(durationMatch[1]) : null,
          height: heightMatch ? parseInt(heightMatch[1], 10) : null,
          hasAudio: audioOut.includes("audio"),
          sizeBytes
        });
      };
      const timer = setTimeout(() => {
        try { p.kill(); } catch {}
        try { pa.kill(); } catch {}
        finish();
      }, timeoutMs);
      p.on("close", () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      resolve(fallback);
    }
  });
}

/** Runs the toolkit FFmpeg with a hard timeout. Never throws (returns ok+stderr). */
export function runFfmpegKit(args: string[], timeoutMs = 240000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise(resolve => {
    try {
      const bin = resolvedFfmpegPath || "ffmpeg";
      const p = spawn(bin, args);
      let stderr = "";
      p.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 8000) stderr += d.toString();
      });
      p.on("error", err => resolve({ ok: false, stderr: String(err) }));
      const timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch {}
        resolve({ ok: false, stderr: `timeout after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);
      p.on("close", code => {
        clearTimeout(timer);
        resolve({ ok: code === 0, stderr: stderr.slice(-1500) });
      });
    } catch (err: any) {
      resolve({ ok: false, stderr: String(err?.message || err) });
    }
  });
}
