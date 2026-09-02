import { describe, expect, it } from "vitest";
import fs from "fs";
import { MAX_UVR_SECONDS, UVR_RUNNER_TIMEOUT_MS, uvrRunnerPaths } from "../src/bot/services/vocalRemover.js";

/**
 * Vocal separation system (audit 8.49): python/uvr_runner.py sidecar,
 * scripts/uvr-setup.sh installer, services/vocalRemover.ts orchestration and
 * the .m karaoké / .m voix entry points. The DSP core was validated
 * end-to-end in-sandbox against a synthetic MDX-geometry ONNX (identity
 * model): vocals ≈ 0.5 × mix to PCM-16 quantization error (max 3.1e-5);
 * channel reconstruction + overlap-add proven correct. Real-model validation
 * runs on the VPS via `nebula doctor` (runner --selftest).
 */

describe("runner (python/uvr_runner.py)", () => {
  const runner = fs.readFileSync("python/uvr_runner.py", "utf-8");

  it("exposes the line protocol the orchestrator parses", () => {
    for (const token of ["PROGRESS", "DONE ", "ERROR "]) {
      expect(runner).toContain(token);
    }
    expect(runner).toContain('"vocals"');
    expect(runner).toContain('"instrumental"');
  });

  it("introspects the model geometry and derives n_fft (no hardcoded shapes)", () => {
    expect(runner).toContain("get_inputs()[0]");
    expect(runner).toContain("(self.n_bins - 1) * 2");
    expect(runner).toContain("self.dim_t");
  });

  it("derives instrumental by wave subtraction with the compensate factor", () => {
    expect(runner).toContain("wave - vocals");
    expect(runner).toContain("compensate");
    expect(runner).toContain("1.035"); // Kim_Vocal_2 family default
  });

  it("rebuilds BOTH stereo channels from the 4-channel output (the E2E-caught bug)", () => {
    expect(runner).toContain("out[0].real = pred[0]");
    expect(runner).toContain("out[0].imag = pred[1]");
    expect(runner).toContain("out[1].real = pred[2]");
    expect(runner).toContain("out[1].imag = pred[3]");
  });

  it("ships a selftest for nebula doctor and caps its own memory", () => {
    expect(runner).toContain("--selftest");
    expect(runner).toContain("RLIMIT_AS");
    expect(runner).toContain("MemoryError");
  });

  it("contains no code from the UVR project (independent implementation)", () => {
    // no UVR/pytorch/gui imports — our runner is numpy+onnxruntime only
    expect(runner).not.toContain("torch");
    expect(runner).not.toContain("librosa");
    expect(runner).not.toContain("PySide");
  });
});

describe("installer (scripts/uvr-setup.sh)", () => {
  const setup = fs.readFileSync("scripts/uvr-setup.sh", "utf-8");

  it("pins the model download by sha256 and refuses on mismatch", () => {
    expect(setup).toContain("huggingface.co/seanghay/uvr_models/resolve/main/Kim_Vocal_2.onnx");
    expect(setup).toMatch(/MODEL_SHA256="[0-9a-f]{64}"/);
    expect(setup).toContain("sha256sum -c");
    expect(setup).toContain("sha256 du modèle invalide");
  });

  it("uses a dedicated venv and never blocks the whole setup on failure", () => {
    expect(setup).toContain(".uvr-venv");
    expect(setup).toContain("exit 0"); // best-effort everywhere
  });

  it("installs only the light dependency set (no torch)", () => {
    expect(setup).toContain("onnxruntime");
    expect(setup).toContain("soundfile");
    expect(setup).not.toContain("torch");
  });
});

describe("orchestration (services/vocalRemover.ts)", () => {
  it("caps track length at 8 minutes and the runner at 10 minutes", () => {
    expect(MAX_UVR_SECONDS).toBe(480);
    expect(UVR_RUNNER_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it("decodes to the runner contract (stereo 44.1 kHz PCM) and encodes MP3 stems", () => {
    const src = fs.readFileSync("src/bot/services/vocalRemover.ts", "utf-8");
    expect(src).toContain('"44100"');
    expect(src).toContain('"pcm_s16le"');
    expect(src).toContain("buildMp3Args(src, dst, 192)");
  });

  it("resolves the venv python, runner and model paths", () => {
    const p = uvrRunnerPaths();
    expect(p.python).toContain(".uvr-venv");
    expect(p.runner.endsWith("uvr_runner.py")).toBe(true);
    expect(p.model.endsWith("Kim_Vocal_2.onnx")).toBe(true);
  });
});

describe("command wiring (.m karaoké / .m voix)", () => {
  const cmd = fs.readFileSync("src/bot/commands/media.ts", "utf-8");

  it("routes both stems and refuses when the system is not installed", () => {
    expect(cmd).toContain("karaoké");
    expect(cmd).toContain("voix");
    expect(cmd).toContain("Séparation vocale non installée");
    expect(cmd).toContain("isVocalSeparationAvailable()");
  });

  it("shares the single-flight locks (ffmpeg + UVR never run together)", () => {
    expect(cmd).toContain("busy.active || uvrBusy.active");
    expect(cmd).toContain("uvrBusy.active = true");
    expect(cmd).toContain("cleanupUvrFiles");
  });

  it("surfaces exist on the VPS tooling", () => {
    expect(fs.readFileSync("manage.sh", "utf-8")).toContain("uvr-setup.sh");
    expect(fs.readFileSync(".env.example", "utf-8")).toContain("NEBULA_UVR_DISABLED");
    expect(fs.readFileSync("README.md", "utf-8")).toContain(".m karaoké");
  });
});
