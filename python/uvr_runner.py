#!/usr/bin/env python3
"""
Nebula UVR runner — vocal separation sidecar (audit 8.49, 2026-09-02).

Standalone, dependency-light companion process for the WhatsApp bot: takes a
decoded WAV (44.1 kHz stereo), separates vocals from instrumental with an
MDX-Net style ONNX model (the model family popularized by
Ultimate-Vocal-RemoverGUI — this file is an INDEPENDENT implementation: no
code from that project, which ships no license; only the freely distributed
model files are used).

Dependencies (installed by scripts/uvr-setup.sh into a dedicated venv):
  onnxruntime, numpy, soundfile

Protocol (stdout, line-based):
  PROGRESS <0-100>   — separation progress
  DONE <json>        — {"vocals": path, "instrumental": path, "seconds": n}
  ERROR <message>    — fatal, exit code 1

Design notes:
  - The model graph is INTROSPECTED at load: input rank/shape gives the
    channel count, frequency bins (n_bins) and time frames (dim_t); n_fft is
    derived as (n_bins - 1) * 2. Only the hop length comes from the model
    config JSON (default 1024, the MDX standard).
  - Chunked overlap-add with a periodic Hann window and an n_fft/2 trim
    margin keeps RAM flat regardless of song length.
  - instrumental = mix - compensate * vocals (wave-domain subtraction, phase
    taken from the mixture — the standard minimal MDX stem derivation).
  - --selftest runs the whole pipeline on a synthetic mix without any input
    file; used by `nebula doctor` to validate the install on the server.
"""

import argparse
import json
import os
import resource
import sys
import time

import numpy as np

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover - environment guard
    print("ERROR onnxruntime is not installed (run scripts/uvr-setup.sh)")
    sys.exit(1)

SR = 44100
DEFAULT_HOP = 1024
DEFAULT_COMPENSATE = 1.035  # Kim_Vocal_2 family
DEFAULT_OVERLAP = 0.5


def say(msg: str) -> None:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def apply_memory_limit(mb: int) -> None:
    try:
        soft = mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (soft, soft))
    except Exception:
        pass  # best effort — platforms may refuse


# ---------------------------------------------------------------------------
# STFT / ISTFT (numpy only, periodic Hann, COLA-safe overlap-add)
# ---------------------------------------------------------------------------

def stft_2ch(wave: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """(2, N) float32 → (2, n_bins, frames) complex64."""
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)  # periodic Hann
    frames = 1 + max(0, (wave.shape[1] - n_fft) // hop)
    out = np.empty((2, n_fft // 2 + 1, frames), dtype=np.complex64)
    for ch in range(2):
        strides = (wave[ch].strides[0], wave[ch].strides[0])
        framed = np.lib.stride_tricks.as_strided(
            wave[ch], shape=(frames, n_fft), strides=(hop * strides[0], strides[1])
        )
        out[ch] = np.fft.rfft(framed * window, axis=1).T
    return out


def istft_2ch(spec: np.ndarray, hop: int, length: int) -> np.ndarray:
    """(2, n_bins, frames) complex64 → (2, length) float32 (overlap-add)."""
    n_fft = (spec.shape[1] - 1) * 2
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    frames = spec.shape[2]
    out = np.zeros((2, frames * hop + n_fft), dtype=np.float64)
    wsum = np.zeros(frames * hop + n_fft, dtype=np.float64)
    time_dom = np.fft.irfft(spec, axis=1, n=n_fft)  # (2, n_bins, frames) → (2, n_fft, frames)
    for ch in range(2):
        for i in range(frames):
            out[ch, i * hop : i * hop + n_fft] += time_dom[ch, :, i] * window
    for i in range(frames):
        wsum[i * hop : i * hop + n_fft] += window.astype(np.float64) ** 2
    wsum[wsum < 1e-10] = 1.0
    result = (out / wsum).astype(np.float32)
    return result[:, :length]


# ---------------------------------------------------------------------------
# Model wrapper
# ---------------------------------------------------------------------------

class MdxModel:
    def __init__(self, model_path: str, hop: int, layout: str):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        shape = [d if isinstance(d, int) else -1 for d in inp.shape]
        if len(shape) != 4:
            raise ValueError(f"unexpected model input rank {shape} (want N,C,F,T)")
        self.channels = shape[1] if shape[1] > 0 else 4
        self.n_bins = shape[2] if shape[2] > 0 else 3073
        self.dim_t = shape[3] if shape[3] > 0 else 256
        self.n_fft = (self.n_bins - 1) * 2
        self.hop = hop
        self.layout = layout  # "re-im" (default) or "alt"
        if self.channels not in (2, 4):
            raise ValueError(f"unsupported channel count {self.channels}")

    def predict_spec(self, spec: np.ndarray) -> np.ndarray:
        """(2, n_bins, T) complex64 → predicted vocals spec, same shape."""
        re = spec.real.astype(np.float32)
        im = spec.imag.astype(np.float32)
        if self.channels == 4:
            if self.layout == "re-im":
                feed = np.stack([re[0], im[0], re[1], im[1]])[None]
            else:  # alt: interleave per channel pair (reL, reR, imL, imR)
                feed = np.stack([re[0], re[1], im[0], im[1]])[None]
        else:
            feed = np.stack([re[0], re[1]])[None]
        pred = self.session.run(None, {self.input_name: feed})[0][0]  # (C, F, T)
        out = np.empty_like(spec)
        if pred.shape[0] >= 4:
            if self.layout == "re-im":
                # feed/ouput order: [re_L, im_L, re_R, im_R] — rebuild BOTH
                # stereo channels, not one channel from mismatched halves
                out[0].real = pred[0][: spec.shape[1]]
                out[0].imag = pred[1][: spec.shape[1]]
                out[1].real = pred[2][: spec.shape[1]]
                out[1].imag = pred[3][: spec.shape[1]]
            else:  # alt: [re_L, re_R, im_L, im_R]
                out[0].real = pred[0][: spec.shape[1]]
                out[0].imag = pred[2][: spec.shape[1]]
                out[1].real = pred[1][: spec.shape[1]]
                out[1].imag = pred[3][: spec.shape[1]]
        else:
            out[0].real = pred[0][: spec.shape[1]]
            out[0].imag = pred[1][: spec.shape[1]]
            out[1].real = pred[0][: spec.shape[1]]
            out[1].imag = pred[1][: spec.shape[1]]
        return out


def separate(mix: np.ndarray, model: MdxModel, overlap: float, compensate: float, progress=True) -> np.ndarray:
    """mix (2, N) float32 → vocals (2, N) float32 via chunked overlap-add."""
    n_fft, hop, dim_t = model.n_fft, model.hop, model.dim_t
    chunk_size = hop * (dim_t - 1)
    trim = n_fft // 2

    gen = chunk_size - 2 * trim
    if gen <= 0:
        raise ValueError("model geometry too small for chunking")
    pad = gen_size_pad(mix.shape[1], gen, trim)
    mixture = np.concatenate(
        [np.zeros((2, trim), dtype=np.float32), mix, np.zeros((2, pad), dtype=np.float32)], axis=1
    )

    step = int((1 - overlap) * chunk_size)
    step = max(1, step)
    total = mixture.shape[1]
    result = np.zeros((2, total), dtype=np.float64)
    divider = np.zeros(total, dtype=np.float64)
    n_chunks = max(1, -(-(total - chunk_size) // step) if total > chunk_size else 1)

    done = 0
    for start in range(0, total, step):
        end = min(start + chunk_size, total)
        actual = end - start
        part = mixture[:, start:end]
        if actual < chunk_size:
            part = np.concatenate([part, np.zeros((2, chunk_size - actual), dtype=np.float32)], axis=1)

        spec = stft_2ch(part, n_fft, hop)[:, : model.n_bins, : dim_t]
        # MDX convention: the bottom 3 frequency bins are zeroed (DC rumble)
        spec[:, :3, :] = 0
        vocal_spec = model.predict_spec(spec)

        chunk_wave = istft_2ch(vocal_spec, hop, chunk_size)
        window = np.hanning(chunk_size + 1)[:-1].astype(np.float64) if overlap > 0 else None
        seg = chunk_wave[:, :actual]
        if window is not None:
            result[:, start:end] += seg * window[:actual]
            divider[start:end] += window[:actual]
        else:
            result[:, start:end] += seg
            divider[start:end] += 1

        done += 1
        if progress and (done % 2 == 0 or done == n_chunks):
            say(f"PROGRESS {min(99, int(done * 100 / n_chunks))}")

    divider[divider < 1e-8] = 1.0
    vocals = (result / divider)[:, trim:-trim if trim else None]
    vocals = (vocals * compensate).astype(np.float32)
    return vocals[:, : mix.shape[1]]


def gen_size_pad(length: int, gen: int, trim: int) -> int:
    return gen + trim - (length % gen)


# ---------------------------------------------------------------------------
# Selftest — validates the whole pipeline on the server (no input file)
# ---------------------------------------------------------------------------

def selftest(model_path: str, hop: int, layout: str) -> int:
    import soundfile as sf  # noqa: F401 — presence check

    duration = 6
    t = np.linspace(0, duration, SR * duration, endpoint=False, dtype=np.float32)
    vocal = 0.4 * np.sin(2 * np.pi * 440.0 * t)          # steady "voice" tone
    instr = 0.2 * np.sin(2 * np.pi * 110.0 * t) + 0.2 * np.sin(2 * np.pi * 165.0 * t)
    mix = np.stack([vocal + instr, vocal + instr * 0.9]).astype(np.float32)

    model = MdxModel(model_path, hop, layout)
    t0 = time.time()
    vocals = separate(mix, model, overlap=0.25, compensate=1.0, progress=False)
    dt = time.time() - t0

    if vocals.shape != mix.shape:
        say(f"ERROR selftest shape mismatch {vocals.shape} != {mix.shape}")
        return 1
    voice_energy = float(np.mean(vocals[0] ** 2))
    residual = float(np.mean((mix[0] - vocals[0]) ** 2))
    say(
        "DONE "
        + json.dumps(
            {
                "selftest": True,
                "model": os.path.basename(model_path),
                "shape": list(vocals.shape),
                "seconds": round(dt, 1),
                "voice_energy": round(voice_energy, 6),
                "residual_energy": round(residual, 6),
            }
        )
    )
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Nebula vocal separation runner")
    ap.add_argument("--input", help="decoded stereo WAV 44.1 kHz")
    ap.add_argument("--vocals", help="output vocals WAV path")
    ap.add_argument("--instrumental", help="output instrumental WAV path")
    ap.add_argument("--model", default=os.environ.get("NEBULA_UVR_MODEL", "models/uvr/Kim_Vocal_2.onnx"))
    ap.add_argument("--hop", type=int, default=DEFAULT_HOP)
    ap.add_argument("--overlap", type=float, default=DEFAULT_OVERLAP)
    ap.add_argument("--compensate", type=float, default=DEFAULT_COMPENSATE)
    ap.add_argument("--layout", choices=["re-im", "alt"], default="re-im",
                    help="ONNX input channel ordering (re-im is the MDX convention)")
    ap.add_argument("--mem-limit-mb", type=int, default=500)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    apply_memory_limit(args.mem_limit_mb)

    if args.selftest:
        if not os.path.exists(args.model):
            say(f"ERROR model not found: {args.model}")
            return 1
        return selftest(args.model, args.hop, args.layout)

    if not (args.input and args.vocals and args.instrumental):
        say("ERROR --input/--vocals/--instrumental are required")
        return 1
    if not os.path.exists(args.model):
        say(f"ERROR model not found: {args.model} (run scripts/uvr-setup.sh)")
        return 1

    try:
        import soundfile as sf

        mix, sr = sf.read(args.input, dtype="float32", always_2d=True)
        if sr != SR:
            say(f"ERROR expected {SR} Hz input, got {sr} Hz")
            return 1
        wave = np.ascontiguousarray(mix.T)  # (2, N)

        model = MdxModel(args.model, args.hop, args.layout)
        vocals = separate(wave, model, args.overlap, args.compensate)
        instrumental = (wave - vocals).astype(np.float32)

        sf.write(args.vocals, vocals.T, SR, subtype="PCM_16")
        sf.write(args.instrumental, instrumental.T, SR, subtype="PCM_16")
        say("DONE " + json.dumps({
            "vocals": args.vocals,
            "instrumental": args.instrumental,
            "seconds": round(wave.shape[1] / SR, 1),
        }))
        return 0
    except MemoryError:
        say("ERROR memory limit reached — try a shorter track")
        return 1
    except Exception as exc:  # noqa: BLE001 — surfaced to the bot as ERROR
        say(f"ERROR {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
