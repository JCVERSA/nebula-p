/**
 * 9.18mm — runFfmpegKit capture le SIGNAL de mort.
 *
 * Retour terrain 16/10 : échec SLIM en prod SANS aucune erreur dans stderr
 * (frame=3 puis plus rien) — un ffmpeg tué de l'extérieur n'imprime rien.
 * L'ancien handler `close(code => …)` jetait le 2ᵉ argument (signal) : OOM
 * killer (SIGKILL) et crash (SIGSEGV) étaient indistinguables d'un échec
 * normal. Ici : child_process mocké, les trois morts possibles restituées.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  // ffmpeg.ts (résolveur) appelle execSync au chargement — échouer
  // proprement : son try/catch retombe sur "ffmpeg" sans toucher au système.
  execSync: vi.fn(() => {
    throw new Error("pas de ffmpeg en test");
  }),
}));

import { spawn } from "child_process";
import { runFfmpegKit } from "../src/bot/services/mediaToolkit.js";

const mSpawn = vi.mocked(spawn);

/** Fake proc : buffer stderr muet, mort émise sur on("close"). */
function fakeProc(emit: (close: (code: number | null, signal: string | null) => void) => void): any {
  return {
    stderr: { on: () => {} },
    on: (ev: string, cb: any) => {
      if (ev === "close") setTimeout(() => emit(cb), 1);
    },
    kill: () => {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("9.18mm — runFfmpegKit : code et signal de mort capturés", () => {
  it("tué par SIGKILL (OOM killer) → signal restitué, code null", async () => {
    mSpawn.mockImplementation((() => fakeProc((close) => close(null, "SIGKILL"))) as any);
    const r = await runFfmpegKit(["-y", "in.mp4", "out.mp4"]);
    expect(r.ok).toBe(false);
    expect(r.code).toBeNull();
    expect(r.signal).toBe("SIGKILL");
  });

  it("crash SIGSEGV → signal restitué (distinguable de l'OOM)", async () => {
    mSpawn.mockImplementation((() => fakeProc((close) => close(null, "SIGSEGV"))) as any);
    const r = await runFfmpegKit(["-y", "in.mp4", "out.mp4"]);
    expect(r.ok).toBe(false);
    expect(r.signal).toBe("SIGSEGV");
  });

  it("échec classique (code 1) → code restitué, aucun signal", async () => {
    mSpawn.mockImplementation((() => fakeProc((close) => close(1, null))) as any);
    const r = await runFfmpegKit(["-y", "in.mp4", "out.mp4"]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.signal).toBeNull();
  });

  it("sortie propre (code 0) → ok, champs honnêtes", async () => {
    mSpawn.mockImplementation((() => fakeProc((close) => close(0, null))) as any);
    const r = await runFfmpegKit(["-y", "in.mp4", "out.mp4"]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.signal).toBeNull();
  });
});
