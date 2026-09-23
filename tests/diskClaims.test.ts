/**
 * 8.78 — garde-fou disque global inter-bots (src/bot/diskClaims.ts).
 *
 * Chaque moteur tourne dans son propre process (bots/<id>/) : les
 * réclamations doivent donc vivre SUR DISQUE (dossier partagé) et survivre
 * aux frontières de process. Ces tests valident l'arithmétique de la
 * réserve, le nettoyage des débris (PID morts), et le branchement du
 * release dans batchDownloadManager (états terminaux).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const ORIGINAL_ENV = { ...process.env };

function freshEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEBULA_DISK_GUARD;
  delete process.env.NEBULA_MIN_FREE_DISK_MB;
  delete process.env.NEBULA_CLAIMS_DIR;
}

/** Recharge le module pour que chaque test pilote son propre dossier de réclamations. */
async function loadModule() {
  const mod = await import("../src/bot/diskClaims.js");
  return mod;
}

function writeClaim(dir: string, claim: Record<string, unknown>): void {
  const safe = String(claim.jobId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  fs.writeFileSync(path.join(dir, `${safe}.json`), JSON.stringify(claim), "utf-8");
}

describe("diskClaims — garde-fou disque inter-bots", () => {
  let dir: string;

  beforeEach(() => {
    freshEnv();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-claims-test-"));
    process.env.NEBULA_CLAIMS_DIR = dir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("accorde une réclamation quand l'espace libre est suffisant", async () => {
    const { acquireDiskClaim, listDiskClaims } = await loadModule();
    const result = acquireDiskClaim("batch_aaa", 10 * 1024 * 1024);
    expect(result.ok).toBe(true);
    const claims = listDiskClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].jobId).toBe("batch_aaa");
    expect(claims[0].pid).toBe(process.pid);
    expect(claims[0].expectedBytes).toBe(10 * 1024 * 1024);
  });

  it("compte les réclamations des AUTRES bots et refuse si la réserve serait franchie", async () => {
    const { acquireDiskClaim } = await loadModule();
    // Réclamation d'un autre moteur (process vivant = le nôtre, mais autre
    // jobId) : elle DOIT peser dans le budget global.
    writeClaim(dir, {
      jobId: "batch_bot2",
      botId: "bot2",
      pid: process.pid,
      expectedBytes: 10 * 1024 * 1024 * 1024 * 1024, // 10 To — plus que tout disque
      createdAt: Date.now(),
    });
    const result = acquireDiskClaim("batch_aaa", 2048 * 1024 * 1024);
    expect(result.ok).toBe(false);
    expect(result.freeBytes).toBeGreaterThan(0);
    expect(result.error).toContain("Espace disque insuffisant");
    expect(result.error).toMatch(/Mo libres/);
    // Aucun fichier ne doit avoir été écrit pour le refusé.
    expect(fs.readdirSync(dir).some((f) => f.startsWith("batch_aaa"))).toBe(false);
  });

  it("ne compte pas sa propre réclamation lors d'une ré-acquisition", async () => {
    const { acquireDiskClaim } = await loadModule();
    expect(acquireDiskClaim("batch_aaa", 5 * 1024 * 1024).ok).toBe(true);
    // Ré-acquérir (même jobId) doit remplacer, pas cumuler.
    expect(acquireDiskClaim("batch_aaa", 5 * 1024 * 1024).ok).toBe(true);
  });

  it("libère la réclamation et permet un nouveau batch", async () => {
    const { acquireDiskClaim, releaseDiskClaim, listDiskClaims } = await loadModule();
    acquireDiskClaim("batch_aaa", 10 * 1024 * 1024);
    expect(releaseDiskClaim("batch_aaa")).toBe(true);
    expect(listDiskClaims()).toHaveLength(0);
    // Un batch énorme redevient possible une fois l'espace libéré.
    expect(acquireDiskClaim("batch_bbb", 10 * 1024 * 1024 * 1024).ok).toBe(true);
  });

  it("ignore et nettoie les réclamations orphelines (moteur mort)", async () => {
    const { acquireDiskClaim, listDiskClaims } = await loadModule();
    // PID au-delà de pid_max Linux : kill(pid, 0) → ESRCH → orphelin.
    writeClaim(dir, {
      jobId: "batch_dead",
      botId: "bot3",
      pid: 9999999,
      expectedBytes: 10 * 1024 * 1024 * 1024 * 1024,
      createdAt: Date.now(),
    });
    // Le nouveau batch doit réussir : le débris ne compte pas...
    expect(acquireDiskClaim("batch_aaa", 10 * 1024 * 1024).ok).toBe(true);
    // ...et le passage de listDiskClaims l'a supprimé.
    expect(listDiskClaims().map((c) => c.jobId)).toEqual(["batch_aaa"]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("batch_dead"))).toBe(false);
  });

  it("nettoie les réclamations trop vieilles même si le PID est vivant", async () => {
    const { listDiskClaims } = await loadModule();
    writeClaim(dir, {
      jobId: "batch_old",
      pid: process.pid,
      expectedBytes: 1024,
      createdAt: Date.now() - 13 * 60 * 60 * 1000, // 13 h > CLAIM_STALE_MS
    });
    expect(listDiskClaims()).toHaveLength(0);
  });

  it("peut être désactivé par NEBULA_DISK_GUARD=off", async () => {
    process.env.NEBULA_DISK_GUARD = "off";
    const { acquireDiskClaim } = await loadModule();
    writeClaim(dir, {
      jobId: "batch_bot2",
      pid: process.pid,
      expectedBytes: 10 * 1024 * 1024 * 1024 * 1024,
      createdAt: Date.now(),
    });
    expect(acquireDiskClaim("batch_aaa", 2048 * 1024 * 1024).ok).toBe(true);
  });

  it("respecte la réserve minimale NEBULA_MIN_FREE_DISK_MB", async () => {
    // Réserve énorme (1 Po) : tout nouveau batch doit être refusé.
    process.env.NEBULA_MIN_FREE_DISK_MB = String(1024 * 1024 * 1024 * 1024);
    const { acquireDiskClaim } = await loadModule();
    const result = acquireDiskClaim("batch_aaa", 10 * 1024 * 1024);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Espace disque insuffisant");
  });
});

describe("diskClaims — branchement batchDownloadManager", () => {
  let dir: string;

  beforeEach(() => {
    freshEnv();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-claims-test-"));
    process.env.NEBULA_CLAIMS_DIR = dir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("libère la réservation quand le job atteint un état terminal", async () => {
    const { acquireDiskClaim, listDiskClaims } = await loadModule();
    const bdm = await import("../src/bot/batchDownloadManager.js");

    const job = bdm.createBatchJob({
      animeTitle: "Test Anime",
      season: "Season 1",
      totalEpisodes: 2,
    });
    expect(acquireDiskClaim(job.id, 2048 * 1024 * 1024).ok).toBe(true);
    expect(listDiskClaims()).toHaveLength(1);

    bdm.updateJobStatus(job.id, "downloading", "en cours");
    expect(listDiskClaims()).toHaveLength(1); // pas encore terminal

    bdm.updateJobStatus(job.id, "completed", "Batch download ready");
    expect(listDiskClaims()).toHaveLength(0); // libéré
  });

  it("libère aussi sur failed et cancelBatchJob", async () => {
    const { acquireDiskClaim, listDiskClaims } = await loadModule();
    const bdm = await import("../src/bot/batchDownloadManager.js");

    const jobA = bdm.createBatchJob({ animeTitle: "A", season: "S1", totalEpisodes: 1 });
    acquireDiskClaim(jobA.id, 1024);
    bdm.updateJobStatus(jobA.id, "failed", "boom");
    expect(listDiskClaims()).toHaveLength(0);

    const jobB = bdm.createBatchJob({ animeTitle: "B", season: "S1", totalEpisodes: 1 });
    acquireDiskClaim(jobB.id, 1024);
    bdm.cancelBatchJob(jobB.id);
    expect(listDiskClaims()).toHaveLength(0);
  });
});
