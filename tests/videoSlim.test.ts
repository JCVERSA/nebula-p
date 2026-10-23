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
  cgroupAvailableBytes,
  parseMemAvailableBytes,
  slimAggressiveArgs,
  slimAggressiveKbps,
  slimEffectiveTargetMB,
  slimEncodeArgs,
  slimEtaMinutes,
  slimFloorKbpsForHeight,
  slimPreflightDecision,
  slimQualityDecision,
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
  // 9.18ccc : durée 0,01 s ⇒ 4096 octets = ~3276 kbps de source (au-dessus
  // du plancher 1080p) — la décision qualité autorise l'encodage.
  mProbe.mockResolvedValue({ durationSec: 0.01, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
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
  it("défaut 250 Mo (9.18ccc), bornes 50-2000, entrées poubelles → défaut", () => {
    expect(slimTriggerBytes()).toBe(250 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "350";
    expect(slimTriggerBytes()).toBe(350 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "5";
    expect(slimTriggerBytes()).toBe(50 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "9999";
    expect(slimTriggerBytes()).toBe(2000 * 1024 * 1024);
    process.env.NEBULA_SLIM_MAX_MB = "pas-un-nombre";
    expect(slimTriggerBytes()).toBe(250 * 1024 * 1024);
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

  it("9.18ccc — source déjà frugale (plancher résolution) → on ne l'abîme pas", async () => {
    // 4096 octets / 3600 s ≈ 0,009 kbps : plafond 75 % ≈ 0 < plancher 1080p.
    mProbe.mockResolvedValue({ durationSec: 3600, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    try {
      const p = mkFile(4096);
      const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
      expect(r.slimmed).toBe(false);
      expect(mRun).not.toHaveBeenCalled();
      expect(logs.some((l) => l.includes("ré-encoder n'abîmerait que la qualité"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("slimVideoIfNeeded — exécution", () => {
  it("ré-encodage utile → fichier REMPLACÉ sur place, tailles honnêtes", async () => {
    const p = mkFile(4096);
    fakeFfmpegWrites(1000); // sortie plus légère
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024 });
    expect(r.slimmed).toBe(true);
    expect(r.originalBytes).toBe(4096);
    expect(r.finalBytes).toBe(1000);
    expect(fs.statSync(p).size).toBe(1000); // remplacé
    expect(mFit).not.toHaveBeenCalled(); // 9.18ccc : plus de cible de taille fixe
    const args = mRun.mock.calls[0][0] as string[];
    const joined = args.join(" ");
    // 9.18ccc — CRF 22 constant + VBV 75 % du source + superfast 2 threads
    expect(joined).toContain("-preset superfast");
    expect(joined).toContain("-crf 22");
    expect(joined).toContain("-maxrate 2457k"); // 75 % de ~3276 kbps (4096 o / 0,01 s)
    expect(joined).toContain("-af aresample=async=1:first_pts=0"); // hygiène TS 9.18k conservée
    expect(joined).toContain("-b:a 96k");
    expect(joined).toContain("+faststart");
    // 9.18aaa — bornes mémoire x264 mesurées conservées (l'encodage a survécu
    // au terrain grâce à elles)
    expect(joined).toContain("-x264-params rc-lookahead=10:ref=1:bframes=0");
    expect(joined).toContain("-threads 1"); // décodeur
    expect(joined).toContain("-threads 2"); // encodeur (superfast priorité owner)
    expect(joined).not.toContain("-threads 0");
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

  it("préflight — entrée démesurée → pas d'encodage (cap 9.18ccc = 2048 Mo)", () => {
    const v = slimPreflightDecision(3 * 1024 ** 3, 800 * 1024 * 1024); // 3 Go
    expect(v.run).toBe(false);
    expect(v.reason).toContain("plafond");
    // 9.18ccc (décision owner) : 1 Go est désormais TRAITÉ (l'ancien cap
    // 800 Mo le refusait) — « 1G → 800 Mo » doit pouvoir encoder.
    expect(slimPreflightDecision(1024 ** 3, 800 * 1024 * 1024).run).toBe(true);
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

  it("slimEncodeArgs (ccc) — CRF 22 + VBV 75 % + superfast 2 threads + bornes x264", () => {
    const a = slimEncodeArgs("/tmp/in.mp4", { encode: true, crf: 22, maxrateKbps: 2457 }, "/tmp/out.mp4");
    const joined = a.join(" ");
    expect(joined).toContain("-preset superfast");
    expect(joined).toContain("-crf 22");
    expect(joined).toContain("-maxrate 2457k");
    expect(joined).toContain("-bufsize 3931k"); // 1,6 × maxrate
    expect(joined).toContain("rc-lookahead=10:ref=1:bframes=0");
    expect(a.filter((x) => x === "-threads")).toHaveLength(2); // décodeur 1 + encodeur 2
    expect(joined).toContain("-b:a 96k"); // audio ré-encodé : hygiène TS 9.18k
    expect(a[a.length - 1]).toBe("/tmp/out.mp4");
  });

  it("9.18ccc — slimFloorKbpsForHeight : planchers par résolution", () => {
    expect(slimFloorKbpsForHeight(1080)).toBe(2000);
    expect(slimFloorKbpsForHeight(1000)).toBe(2000);
    expect(slimFloorKbpsForHeight(720)).toBe(1100);
    expect(slimFloorKbpsForHeight(700)).toBe(1100);
    expect(slimFloorKbpsForHeight(480)).toBe(650);
    expect(slimFloorKbpsForHeight(0)).toBe(650); // hauteur inconnue → plancher bas
  });

  it("9.18ccc — slimQualityDecision : 536 Mo/24 min/1080p → encode à 75 % ; frugale → refus", () => {
    // Terrain du 17/10 : 536 Mo ≈ 2980 kbps → plafond 2235 ≥ plancher 2000.
    const d = slimQualityDecision(536_000_000, 24 * 60, 1080);
    expect(d.encode).toBe(true);
    expect(d.crf).toBe(22);
    expect(d.maxrateKbps).toBe(2233); // 75 % de 2978 kbps
    // Source frugale : 300 kbps → plafond 225 < plancher 1080p → on n'abîme pas.
    const frugale = slimQualityDecision(54_000_000, 24 * 60, 1080); // 300 kbps
    expect(frugale.encode).toBe(false);
    expect(frugale.reason).toContain("ré-encoder n'abîmerait que la qualité");
    // 480p : un débit moyen (≈1111 kbps → plafond 833) passe le plancher
    // 650 du 480p mais PAS celui du 1080p — la garde dépend de la résolution.
    expect(slimQualityDecision(200_000_000, 24 * 60, 480).encode).toBe(true);
    expect(slimQualityDecision(200_000_000, 24 * 60, 1080).encode).toBe(false);
  });

  it("9.18ccc — slimEtaMinutes : temps estimé selon la taille (message de patience)", () => {
    expect(slimEtaMinutes(512 * 1024 * 1024)).toBe(3);   // ~500 Mo → ~3 min
    expect(slimEtaMinutes(1024 * 1024 * 1024)).toBe(7);  // 1 Go → ~7 min
    expect(slimEtaMinutes(250 * 1024 * 1024)).toBe(2);   // 250 Mo → ~2 min
    expect(slimEtaMinutes(1024)).toBe(1);                // plancher 1 min
  });

  it("9.18ddd — wiring : plus de conversion imposée — l'offre .slim accompagne la livraison", () => {
    const novabox = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf8");
    // AUCUN appel d'amincissement dans novabox (mono comme lot) : l'original
    // part immédiatement, l'offre est la seule porte d'entrée.
    expect(novabox).not.toContain("await slimVideoIfNeeded(");
    // l'offre est posée APRÈS l'enregistrement du lien (chemin vivant).
    const offerIdx = novabox.indexOf("registerSlimOffer(");
    const regIdx = novabox.indexOf("registerTempDownload(activeSendPath");
    expect(offerIdx).toBeGreaterThan(regIdx);
    expect(novabox).toContain("slimOfferLine");
    expect(novabox).toContain("slimTriggerBytes()");
    // ytvideo garde sa patience (contrainte du plafond d'envoi WhatsApp).
    const ytv = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/ytvideo.ts"), "utf8");
    expect(ytv).toContain("slimEtaMinutes");
    expect(ytv).not.toContain("targetMB");
  });

  it("9.18ddd — wiring : commande .slim enregistrée (2-pass à la demande)", () => {
    const cmd = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/slim.ts"), "utf8");
    expect(cmd).toContain('mode: "aggressive"');
    expect(cmd).toContain("keepOriginal: true");
    expect(cmd).toContain("consumeSlimOffer");
    expect(cmd).toContain("registerTempDownload");
    const reg = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commandRegistry.ts"), "utf8");
    expect(reg).toContain("slimCommand");
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

describe("9.18eeee — préflight CONSCIENT DU CONTENEUR (terrain 21/10 : SIGKILL passe 1 après un /proc/meminfo menteur)", () => {
  it("math terrain : usage 923 Mo / limite 953 Mo / cache 280 Mo → 310 Mo dispo → le 1080P de 490 Mo est REFUSÉ", () => {
    const available = cgroupAvailableBytes(923 * 1024 * 1024, 953 * 1024 * 1024, 280 * 1024 * 1024);
    expect(available).toBe(310 * 1024 * 1024); // limite − (usage − cache) = 953 − 643
    const v = slimPreflightDecision(490 * 1024 * 1024, available); // le 1080P du terrain
    expect(v.run).toBe(false);
    expect(v.reason).toContain("RAM disponible");
  });

  it("cgroup illisible ou sans limite → null (repli /proc/meminfo : machine hôte nue)", () => {
    expect(cgroupAvailableBytes(null, 953 * 1024 * 1024, 100)).toBeNull();
    expect(cgroupAvailableBytes(500, null, 100)).toBeNull();
    expect(cgroupAvailableBytes(500, 0, 100)).toBeNull();
    expect(cgroupAvailableBytes(500, Number.NaN, 100)).toBeNull();
  });

  it("cache inconnu → working set = usage entier (conservateur, jamais optimiste)", () => {
    expect(cgroupAvailableBytes(600 * 1024 * 1024, 953 * 1024 * 1024, null)).toBe(353 * 1024 * 1024);
  });

  it("câblage : le préflight mesure le conteneur quand le cgroup est lisible (leçon zzz appliquée au slim)", () => {
    const src = fs.readFileSync("src/bot/services/videoSlim.ts", "utf8");
    expect(src).toContain("slimEffectiveAvailableBytes()");
    expect(src).toContain("readCgroupMemLimitBytes");
    expect(src).toContain("readCgroupMemUsageBytes");
    expect(src).toContain("readCgroupPageCacheBytes");
  });
});

describe("9.18fff — cible adaptative à la durée (le film de 90 min n'est plus refusé)", () => {
  it("épisode 24 min : la cible de base (~190 Mo) reste la cible", () => {
    expect(slimEffectiveTargetMB(465_600_000, 1440, 190)).toBe(190);
  });

  it("film 90 min / 1041 Mo (terrain Shiboyugi) : ~589 Mo — plus jamais de refus bouillie", () => {
    // Hier : cible fixe 190 Mo → 193 kbps → « impossible sans bouillir l'image ».
    // Maintenant : plancher 800 kbps vidéo → ~589 Mo (57 % de la source).
    expect(slimEffectiveTargetMB(1_091_813_226, 5400, 190)).toBe(589);
  });

  it("source frugale : bornée à 80 % de la source — le garde kbps refusera après", () => {
    const t = slimEffectiveTargetMB(314_572_800, 5400, 190); // 300 Mo / 90 min
    expect(t).toBe(240); // 80 % de la source
    expect(slimAggressiveKbps(314_572_800, 5400, t)).toBeNull(); // bouillie → refus honnête
  });

  it("NEBULA_SLIM_TARGET_MB élevé rehausse tout (c'est un MINIMUM désormais)", () => {
    expect(slimEffectiveTargetMB(465_600_000, 1440, 400)).toBe(355); // plafonné à 80 % de la source
  });

  it("wiring : l'offre ET .slim utilisent la cible adaptative (annonce honnête)", () => {
    const novabox = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf8");
    expect(novabox).toContain("slimEffectiveTargetMB");
    const slimCmd = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/slim.ts"), "utf8");
    expect(slimCmd).toContain("slimEffectiveTargetMB");
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

  it("novabox : aucun hook d'amincissement (mono et lot livrent l'original, 9.18ddd)", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    expect(src).not.toContain("slimVideoIfNeeded(");
    // la décision owner est verrouillée : jamais de conversion sans demande.
  });

  it("ytvideo : plafond de téléchargement relevé + amincissement avant envoi", () => {
    const src = readSrc("src/bot/commands/ytvideo.ts");
    expect(src).toContain("SLIM_SOURCE_CEILING");
    expect(src).toContain("ytvViaYtDlp(videoUrl, quality, SLIM_SOURCE_CEILING, {\n          audioLang,\n          subs,\n          onProgress:");
    expect(src).toContain("slimVideoIfNeeded(videoPath, { triggerBytes: MAX_VIDEO_BYTES })");
    expect(src).toContain("slimEtaMinutes"); // 9.18ccc : patience + ETA, douceur (plus de targetMB 92)
  });

  it("variable d'environnement câblée partout (rituel env)", () => {
    expect(readSrc("src/panel/envRoutes.ts")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc("manage.sh")).toContain("NEBULA_SLIM_MAX_MB");
    expect(readSrc(".env.example")).toContain("NEBULA_SLIM_MAX_MB");
  });

});

describe("9.18ddd — mode agressif (.slim) : cible exacte en 2-pass", () => {
  it("slimAggressiveKbps : budget cible − audio − conteneur, refuse la bouillie", () => {
    // 24 min, cible 190 Mo : 1106,8 kbps × 0,98 − 96 = 988 kbps.
    expect(slimAggressiveKbps(465_600_000, 1440, 190)).toBe(988);
    // Cible impossible (80 Mo sur 24 min) : sous 400 kbps → null.
    expect(slimAggressiveKbps(465_600_000, 1440, 80)).toBeNull();
  });

  it("slimAggressiveArgs : tune animation + passes 1/2 distinctes", () => {
    const p1 = slimAggressiveArgs("/tmp/in.mp4", 972, 1, "/tmp/pl", "/tmp/out.mp4");
    expect(p1.join(" ")).toContain("-tune animation");
    expect(p1.join(" ")).toContain("-pass 1");
    expect(p1.join(" ")).toContain("/dev/null");
    expect(p1.join(" ")).not.toContain("/tmp/out.mp4");
    const p2 = slimAggressiveArgs("/tmp/in.mp4", 972, 2, "/tmp/pl", "/tmp/out.mp4");
    expect(p2.join(" ")).toContain("-pass 2");
    expect(p2[p2.length - 1]).toBe("/tmp/out.mp4");
    expect(p2.join(" ")).toContain("-b:a 96k"); // hygiène TS conservée
  });

  it("DEUX passes, keepOriginal : l'original reste, la sortie vit à côté", async () => {
    // 50 Mo / 100 s ≈ 4194 kbps de source ; cible 8 Mo → 561 kbps (≥400, < source).
    mProbe.mockResolvedValue({ durationSec: 100, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
    mRun.mockImplementation(async (args: string[]) => {
      if (args.join(" ").includes("-pass 1")) return { ok: true, code: 0, signal: null, stderr: "" };
      const out = args[args.length - 1];
      fs.writeFileSync(out, Buffer.alloc(20 * 1024 * 1024, 7)); // 20 Mo < 50 Mo
      return { ok: true, code: 0, signal: null, stderr: "" };
    });
    const p = mkFile(50 * 1024 * 1024);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024, mode: "aggressive", targetMB: 8, keepOriginal: true });
    expect(r.slimmed).toBe(true);
    expect(r.path).not.toBe(p); // la version allégée vit à côté
    expect(fs.existsSync(p)).toBe(true); // l'original (et son lien /d/) restent
    expect(fs.statSync(p).size).toBe(50 * 1024 * 1024);
    expect(r.finalBytes).toBe(20 * 1024 * 1024);
    expect(mRun).toHaveBeenCalledTimes(2); // deux passes
    expect(mRun.mock.calls[0][0].join(" ")).toContain("-pass 1");
    expect(mRun.mock.calls[1][0].join(" ")).toContain("-pass 2");
  });

  it("passe 1 échoue → original intact, message honnête", async () => {
    mProbe.mockResolvedValue({ durationSec: 100, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
    mRun.mockResolvedValue({ ok: false, code: null, signal: "SIGKILL", stderr: "boom" } as any);
    const p = mkFile(50 * 1024 * 1024);
    const r = await slimVideoIfNeeded(p, { triggerBytes: 1024, mode: "aggressive", targetMB: 8 });
    expect(r.slimmed).toBe(false);
    expect(fs.statSync(p).size).toBe(50 * 1024 * 1024);
    expect(mRun).toHaveBeenCalledTimes(1); // la passe 2 ne part jamais
  });

  it("cible plus légère que la source → rien à gagner, aucun encodage", async () => {
    mProbe.mockResolvedValue({ durationSec: 100, height: 1080, hasAudio: true, sizeBytes: 0 } as any);
    const p = mkFile(1024); // source ~0 kbps
    const r = await slimVideoIfNeeded(p, { triggerBytes: 128, mode: "aggressive", targetMB: 8 });
    expect(r.slimmed).toBe(false);
    expect(mRun).not.toHaveBeenCalled();
  });
});
