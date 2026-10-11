/**
 * 9.7 — videoSlim : amincissement « même résolution » au-dessus du seuil.
 * mediaToolkit mocké (aucun ffmpeg réel) — l'orchestration seule est testée :
 * décision, file d'attente un-à-la-fois, garanties d'échec (original livré).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../src/bot/services/mediaToolkit.js", () => ({
  probeVideoInfo: vi.fn(),
  runFfmpegKit: vi.fn(),
  whatsappFitVideoOptions: vi.fn(),
}));

import { slimVideoIfNeeded, slimTriggerBytes } from "../src/bot/services/videoSlim.js";
import { probeVideoInfo, runFfmpegKit, whatsappFitVideoOptions } from "../src/bot/services/mediaToolkit.js";

const mProbe = vi.mocked(probeVideoInfo);
const mRun = vi.mocked(runFfmpegKit);
const mFit = vi.mocked(whatsappFitVideoOptions);

let dir = "";

/** Simule ffmpeg : écrit le fichier de sortie (dernier arg) avec `bytes`. */
function fakeFfmpegWrites(bytes: number) {
  mRun.mockImplementation(async (args: string[]) => {
    const out = args[args.length - 1];
    fs.writeFileSync(out, Buffer.alloc(bytes, 7));
    return { ok: true, stderr: "" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEBULA_SLIM_MAX_MB;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slim-"));
  mProbe.mockResolvedValue({ durationSec: 1, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
  mFit.mockReturnValue({ options: ["-c:v", "libx264", "-b:v", "1k"], videoKbps: 0, note: "test" } as any);
  fakeFfmpegWrites(10);
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

function mkFile(bytes: number): string {
  const p = path.join(dir, "ep.mp4");
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
}

describe("slimTriggerBytes (pur)", () => {
  it("défaut 200 Mo, bornes 50-2000, entrées poubelles → défaut", () => {
    expect(slimTriggerBytes()).toBe(200 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "350";
    expect(slimTriggerBytes()).toBe(350 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "5";
    expect(slimTriggerBytes()).toBe(50 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "9999";
    expect(slimTriggerBytes()).toBe(2000 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "pas-un-nombre";
    expect(slimTriggerBytes()).toBe(200 * 1024 * 1024);
  });
});

describe("slimVideoIfNeeded — décisions", () => {
  it("sous le seuil → intact, aucun ffmpeg", async () => {
    const p = mkFile(500);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(r.finalBytes).toBe(500);
    expect(mRun).not.toHaveBeenCalled();
    expect(fs.statSync(p).size).toBe(500);
  });

  it("durée inconnue (ffprobe muet) → on ne tente pas", async () => {
    mProbe.mockResolvedValue({ durationSec: null, height: null, hasAudio: false, sizeBytes: 0 } as any);
    const p = mkFile(4096);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(mRun).not.toHaveBeenCalled();
  });

  it("gain impossible (source déjà plus frugale que la cible) → on ne tente pas", async () => {
    // 4096 octets / 100 s ≈ 0,33 kbps — cible 1 kbps : ré-encoder ne peut rien gagner.
    mFit.mockReturnValue({ options: [], videoKbps: 1000, note: "x" } as any);
    const p = mkFile(4096);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(mRun).not.toHaveBeenCalled();
  });
});

describe("slimVideoIfNeeded — exécution", () => {
  it("ré-encodage utile → fichier REMPLACÉ sur place, tailles honnêtes", async () => {
    const p = mkFile(4096);
    fakeFfmpegWrites(1000); // sortie plus légère
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024, targetMB: 1 });
    expect(r.slimmed).toBe(true);
    expect(r.originalBytes).toBe(4096);
    expect(r.finalBytes).toBe(1000);
    expect(fs.statSync(p).size).toBe(1000); // remplacé
    // même résolution : heightCap=0 passé à whatsappFitVideoOptions
    expect(mFit).toHaveBeenCalledWith(1, 1, 0);
    // audio aac 96k + faststart dans les args
    const args = mRun.mock.calls[0][0] as string[];
    expect(args.join(" ")).toContain("-b:a 96k");
    expect(args.join(" ")).toContain("+faststart");
  });

  it("échec ffmpeg → fichier original livré, sortie partielle purgée", async () => {
    const p = mkFile(4096);
    mRun.mockImplementation(async (args: string[]) => {
      const out = args[args.length - 1];
      fs.writeFileSync(out, Buffer.alloc(10)); // sortie partielle
      return { ok: false, stderr: "boom" };
    });
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(fs.statSync(p).size).toBe(4096); // original intact
    expect(fs.readdirSync(dir).length).toBe(1); // plus de fichier .slim-
  });

  it("sortie PLUS LOURDE que l'original → original conservé (anti-absurde)", async () => {
    const p = mkFile(4096);
    fakeFfmpegWrites(999_999);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(fs.statSync(p).size).toBe(4096);
    expect(fs.readdirSync(dir).length).toBe(1);
  });

  it("UN SEUL ffmpeg à la fois : deux appels concurrents jamais superposés", async () => {
    let active = 0;
    let maxActive = 0;
    mRun.mockImplementation(async (args: string[]) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((res) => setTimeout(res, 30));
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(10));
      active--;
      return { ok: true, stderr: "" };
    });
    const p1 = mkFile(4096);
    const p2 = path.join(dir, "ep2.mp4");
    fs.writeFileSync(p2, Buffer.alloc(4096, 2));
    const [r1, r2] = await Promise.all([
      slimVideoIfNeeded(p1, { triggerBytes: 1024 }),
      slimVideoIfNeeded(p2, { triggerBytes: 1024 }),
    ]);
    expect(r1.slimmed).toBe(true);
    expect(r2.slimmed).toBe(true);
    expect(maxActive).toBe(1); // jamais deux ffmpeg en parallèle
  });
});

describe("wiring 9.7", () => {
  const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");

  it("novabox : hooks mono-épisode ET batch (avant l'enregistrement du lien)", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    expect(src).toContain("slimVideoIfNeeded");
    const hookCount = src.split("slimVideoIfNeeded(").length - 1;
    expect(hookCount).toBeGreaterThanOrEqual(2); // mono + batch
    // le hook batch précède registerTempDownload (tailles affichées = réelles)
    const batchHook = src.indexOf("await slimVideoIfNeeded(localPath)");
    const reg = src.indexOf("registerTempDownload(localPath, filename");
    expect(batchHook).toBeGreaterThan(-1);
    expect(batchHook).toBeLessThan(reg);
  });

  it("ytvideo : plafond de téléchargement relevé + amincissement avant envoi", () => {
    const src = readSrc("src/bot/commands/ytvideo.ts");
    expect(src).toContain("SLIM_SOURCE_CEILING");
    expect(src).toContain("ytvViaYtDlp(videoUrl, quality, SLIM_SOURCE_CEILING)");
    expect(src).toContain('slimVideoIfNeeded(videoPath, { triggerBytes: MAX_VIDEO_BYTES, targetMB: 92 })');
  });

  it("variable d'environnement câblée partout (rituel env)", () => {
    expect(readSrc("src/panel/envRoutes.ts")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc("manage.sh")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc(".env.example")).toContain("NEBULA_SLIM_MAX_MB");
  });

});
