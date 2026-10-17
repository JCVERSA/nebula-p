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

import {
  parseMemAvailableBytes,
  slimEncodeArgs,
  slimPreflightDecision,
  slimVideoIfNeeded,
  slimTriggerBytes
} from "../src/bot/services/videoSlim.js";
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
    return { ok: true, code: 0, signal: null, stderr: "" };
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
    // 9.18aaa — bornes mémoire x264 MESURÉES (terrain 17/10 : un 1080p de
    // 536 Mo a OOM-tué le moteur entier) : rc-lookahead/ref/bframes bornés
    // (622 → 350 Mo) + 1 seul thread (→ 244 Mo) côté encodeur ET décodeur.
    expect(args.join(" ")).toContain("-x264-params rc-lookahead=10:ref=1:bframes=0");
    expect(args.join(" ")).toContain("-threads 1");
    expect(args.join(" ")).not.toContain("-threads 0");
    expect(args.join(" ")).not.toContain("-threads 2");
  });

  it("9.18mm — échec TUÉ PAR SIGNAL (SIGKILL/OOM) → la cause dans le log, original livré", async () => {
    const p = mkFile(4096);
    mRun.mockImplementation(async (args: string[]) => {
      const out = args[args.length - 1];
      fs.writeFileSync(out, Buffer.alloc(10));
      return { ok: false, code: null, signal: "SIGKILL", stderr: "frame=    3 fps=0.0" };
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    try {
      const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
      expect(r.slimmed).toBe(false);
      expect(fs.statSync(p).size).toBe(4096); // original intact
      const line = logs.find((l) => l.includes("[SLIM] échec ffmpeg"));
      expect(line).toBeTruthy();
      expect(line).toContain("signal SIGKILL");
      expect(line).toContain("OOM killer");
      expect(line).toContain("dmesg");
    } finally {
      spy.mockRestore();
    }
  });

  it("9.18mm — échec avec code de sortie (pas de signal) → code affiché, pas de mention OOM", async () => {
    const p = mkFile(4096);
    mRun.mockImplementation(async () => ({ ok: false, code: 1, signal: null, stderr: "Invalid data" }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    try {
      const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
      expect(r.slimmed).toBe(false);
      const line = logs.find((l) => l.includes("[SLIM] échec ffmpeg"));
      expect(line).toContain("code 1");
      expect(line).not.toContain("OOM");
    } finally {
      spy.mockRestore();
    }
  });

  it("échec ffmpeg → fichier original livré, sortie partielle purgée", async () => {
    const p = mkFile(4096);
    mRun.mockImplementation(async (args: string[]) => {
      const out = args[args.length - 1];
      fs.writeFileSync(out, Buffer.alloc(10)); // sortie partielle
      return { ok: false, code: 1, signal: null, stderr: "boom" };
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
      return { ok: true, code: 0, signal: null, stderr: "" };
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

describe("9.18aaa — bornes mémoire + préflight (le SLIM ne tue plus le moteur)", () => {
  beforeEach(() => {
    delete process.env.NEBULA_SLIM_MIN_FREE_MB;
    delete process.env.NEBULA_SLIM_INPUT_CAP_MB;
  });
  afterEach(() => {
    delete process.env.NEBULA_SLIM_MIN_FREE_MB;
    delete process.env.NEBULA_SLIM_INPUT_CAP_MB;
  });

  it("parseMemAvailableBytes — extrait MemAvailable, rejette le bruit", () => {
    expect(parseMemAvailableBytes("MemTotal:       1024000 kB\nMemAvailable:   358400 kB\n")).toBe(358400 * 1024);
    expect(parseMemAvailableBytes("")).toBeNull();
    expect(parseMemAvailableBytes("MemFree: 100 kB")).toBeNull();
  });

  it("préflight — RAM disponible insuffisante → pas d'encodage, raison honnête", () => {
    const v = slimPreflightDecision(500 * 1024 * 1024, 200 * 1024 * 1024); // 200 Mo libres < 350
    expect(v.run).toBe(false);
    expect(v.reason).toContain("RAM disponible");
  });

  it("préflight — entrée démesurée → pas d'encodage (sans espoir sur 1 cœur)", () => {
    const v = slimPreflightDecision(2 * 1024 ** 3, 800 * 1024 * 1024); // 2 Go
    expect(v.run).toBe(false);
    expect(v.reason).toContain("plafond");
  });

  it("préflight — machine saine → encodage autorisé ; RAM inconnue (non-Linux) → autorisé avec garde taille", () => {
    expect(slimPreflightDecision(500 * 1024 * 1024, 800 * 1024 * 1024).run).toBe(true);
    expect(slimPreflightDecision(500 * 1024 * 1024, null).run).toBe(true);
  });

  it("préflight — NEBULA_SLIM_MIN_FREE_MB=0 / NEBULA_SLIM_INPUT_CAP_MB=0 désactivent les gardes", () => {
    process.env.NEBULA_SLIM_MIN_FREE_MB = "0";
    process.env.NEBULA_SLIM_INPUT_CAP_MB = "0";
    expect(slimPreflightDecision(500 * 1024 * 1024, 1).run).toBe(true); // même à sec
    expect(slimPreflightDecision(99 * 1024 ** 3, 1).run).toBe(true);    // même démesuré
  });

  it("slimVideoIfNeeded — préflight refusé → AUCUN ffmpeg, original livré", async () => {
    const p = mkFile(4096);
    process.env.NEBULA_SLIM_MIN_FREE_MB = "99999"; // plus que toute machine
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(false);
    expect(mRun).not.toHaveBeenCalled();
    expect(fs.statSync(p).size).toBe(4096);
  });

  it("slimEncodeArgs — bornes x264 mesurées présentes (622 → 244 Mo en 1080p)", () => {
    const a = slimEncodeArgs("/tmp/in.mp4", ["-c:v", "libx264", "-b:v", "900k"], "/tmp/out.mp4");
    expect(a).toContain("-x264-params");
    expect(a.join(" ")).toContain("rc-lookahead=10:ref=1:bframes=0");
    expect(a.filter((x) => x === "-threads")).toHaveLength(2); // décodeur + encodeur
    expect(a).not.toContain("2"); // plus aucun cap à 2 threads
    expect(a[a.length - 1]).toBe("/tmp/out.mp4");
  });

  it("wiring — ffmpeg en priorité basse : Node garde le CPU (sonde santé)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/mediaToolkit.ts"), "utf8");
    expect(src).toContain("os.setPriority(p.pid, 10)");
  });

  it("wiring — novabox compression : mêmes bornes mémoire que SLIM", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf8");
    const m = /const ffmpegArgs = \[([\s\S]*?)runFfmpegKit\(ffmpegArgs/.exec(src);
    expect(m, "bloc ffmpegArgs introuvable").toBeTruthy();
    expect(m![1]).toContain("rc-lookahead=10:ref=1:bframes=0");
    expect(m![1]).toContain("\"1\"");
  });

  it("wiring — manage.sh expose la commande swap (filet anti-OOM terrain)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf8");
    expect(src).toContain("cmd_swap()");
    expect(src).toContain("swapon /swapfile");
    expect(src).toContain("swap)    cmd_swap");
  });
});

describe("wiring 9.7", () => {
  const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");

  it("9.18pp→aaa — compression novabox : mêmes bornes mémoire que videoSlim (threads 1 + x264 bornés)", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    const m = /const ffmpegArgs = \[([\s\S]*?)runFfmpegKit\(ffmpegArgs/.exec(src);
    expect(m, "bloc ffmpegArgs introuvable").toBeTruthy();
    const block = m![1];
    expect(block).toContain("-threads");
    expect(block).toContain("\"1\"");
    expect(block).toContain("rc-lookahead=10:ref=1:bframes=0");
    expect(block).not.toContain("\"2\"");
    // le cap de SORTIE doit exister APRÈS les options vidéo (fitOptions splice)
    const spliceIdx = block.indexOf("...(fitOptions");
    const threadsIdx = block.indexOf("\"1\"");
    expect(spliceIdx).toBeGreaterThan(-1);
    expect(threadsIdx).toBeGreaterThan(spliceIdx);
  });

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
    expect(src).toContain("ytvViaYtDlp(videoUrl, quality, SLIM_SOURCE_CEILING, { audioLang, subs })");
    expect(src).toContain('slimVideoIfNeeded(videoPath, { triggerBytes: MAX_VIDEO_BYTES, targetMB: 92 })');
  });

  it("variable d'environnement câblée partout (rituel env)", () => {
    expect(readSrc("src/panel/envRoutes.ts")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc("manage.sh")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc(".env.example")).toContain("NEBULA_SLIM_MAX_MB");
  });

});
