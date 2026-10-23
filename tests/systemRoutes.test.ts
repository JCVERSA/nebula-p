/**
 * 9.2 — routes système du panneau (mini-console admin).
 *
 * Implémentation RÉELLE de createDefaultSystemActions sur des répertoires
 * temporaires : un faux manage.sh (script bash qui touche un marqueur),
 * un lock neuve/vieux, un bot.log factice. Aucun VPS requis.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  registerSystemRoutes,
  createDefaultSystemActions,
} from "../src/panel/systemRoutes.js";

let dir: string;

function buildApp(overrides: Record<string, unknown> = {}) {
  const actions = createDefaultSystemActions({
    appDir: dir,
    manageSh: join(dir, "manage.sh"),
    lockDir: join(dir, "lock"),
    logFile: join(dir, "bot.log"),
    actionLog: join(dir, "manage.log"),
    ...overrides,
  });
  const app = express();
  registerSystemRoutes(app, { actions });
  return app;
}

function writeFakeManageSh() {
  const script = `#!/usr/bin/env bash\nsleep 0.05\ntouch "${join(dir, "marker-" + Date.now())}"\nexit 0\n`;
  writeFileSync(join(dir, "manage.sh"), script, "utf-8");
  chmodSync(join(dir, "manage.sh"), 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "system-routes-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.2.0-test" }), "utf-8");
  writeFileSync(join(dir, "bot.log"), "ligne 1\nligne 2\nligne 3\n", "utf-8");
  // 9.18ttt : claims disque ISOLÉS par test — la garde « batch en cours »
  // lit un registre fichier partagé ; sans isolation, un claim vivant créé
  // par un AUTRE fichier de tests (processus séparé, même /tmp) bloquerait
  // ces tests de façon non déterministe.
  process.env.NEBULA_CLAIMS_DIR = join(dir, "claims");
  mkdirSync(process.env.NEBULA_CLAIMS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_CLAIMS_DIR;
});

describe("GET /api/system/info", () => {
  it("renvoie la version package.json et dégrade git proprement (pas de repo)", async () => {
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.version).toBe("9.2.0-test");
    expect(res.body.commit).toBe("unknown"); // pas de .git dans le tmpdir
    expect(res.body.branch).toBe("unknown");
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.updating).toBe(false);
  });
});

describe("GET /api/system/logs", () => {
  it("taille le bot.log (bornes appliquées)", async () => {
    const res = await request(buildApp()).get("/api/system/logs?lines=2").expect(200);
    expect(res.body.lines).toContain("ligne 2");
    expect(res.body.lines).toContain("ligne 3");
    expect(res.body.lines).not.toContain("ligne 1");
  });

  it("fichier absent → chaîne vide, pas d'erreur 500", async () => {
    rmSync(join(dir, "bot.log"));
    const res = await request(buildApp()).get("/api/system/logs").expect(200);
    expect(res.body.lines).toBe("");
  });
});

describe("GET /api/system/metrics (9.18jjjj — vraies mesures, plus de simulacre)", () => {
  it("expose processus + système + réseau sans jamais 500", async () => {
    const res = await request(buildApp()).get("/api/system/metrics").expect(200);
    expect(res.body.process.pid).toBeGreaterThan(0);
    expect(res.body.process.rssMb).toBeGreaterThanOrEqual(0);
    expect(res.body.process.heapUsedMb).toBeLessThanOrEqual(res.body.process.heapTotalMb);
    expect(res.body.system.totalMb).toBeGreaterThan(0);
    expect(res.body.system.usedMb).toBeLessThanOrEqual(res.body.system.totalMb);
    // Réseau : null (premier échantillon) ou débit >= 0 — jamais négatif.
    expect(res.body.network.rxBps === null || res.body.network.rxBps >= 0).toBe(true);
    expect(res.body.network.txBps === null || res.body.network.txBps >= 0).toBe(true);
  });

  it("deux appels → deltas CPU finis et compteurs cohérents", async () => {
    await request(buildApp()).get("/api/system/metrics");
    const res = await request(buildApp()).get("/api/system/metrics").expect(200);
    expect(Number.isFinite(res.body.process.cpuPercent)).toBe(true);
    expect(res.body.process.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(res.body.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.system.loadAvg1 === null || res.body.system.loadAvg1 >= 0).toBe(true);
    expect(res.body.system.cores).toBeGreaterThan(0);
    expect(typeof res.body.process.nodeVersion).toBe("string");
  });
});

describe("POST /api/system/update — lancement détaché + verrou", () => {
  it("lance le script (marqueur créé) et répond started", async () => {
    writeFakeManageSh();
    const res = await request(buildApp()).post("/api/system/update").expect(200);
    expect(res.body.started).toBe(true);
    // Le script détaché touche son marqueur rapidement.
    await new Promise((r) => setTimeout(r, 700));
    const marker = existsSync(join(dir)) &&
      require("fs").readdirSync(dir).some((f: string) => f.startsWith("marker-"));
    expect(marker).toBe(true);
  });

  it("verrou d'update frais → 409 + status updating:true", async () => {
    writeFakeManageSh();
    mkdirSync(join(dir, "lock")); // frais (mtime = maintenant)
    const status = await request(buildApp()).get("/api/system/update-status").expect(200);
    expect(status.body.updating).toBe(true);
    const res = await request(buildApp()).post("/api/system/update").expect(409);
    expect(res.body.error).toContain("déjà en cours");
  });

  it("manage.sh absent → 400 explicite (aucun spawn)", async () => {
    const res = await request(buildApp()).post("/api/system/restart").expect(400);
    expect(res.body.error).toContain("introuvable");
  });

  it("verrou PÉRIMÉ (>15 min) = débris → update autorisé", async () => {
    writeFakeManageSh();
    const lock = join(dir, "lock");
    mkdirSync(lock);
    const old = new Date(Date.now() - 20 * 60 * 1000);
    require("fs").utimesSync(lock, old, old);
    const status = await request(buildApp()).get("/api/system/update-status").expect(200);
    expect(status.body.updating).toBe(false); // périmé ≠ en cours (règle manage.sh)
  });
});

describe("surface API complète", () => {
  it("restart et stop passent par le même chemin (script fixe, aucune entrée shell)", async () => {
    writeFakeManageSh();
    await request(buildApp()).post("/api/system/restart").expect(200);
    await request(buildApp()).post("/api/system/stop").expect(200);
    // Le log d'action trace les deux lancements côté panneau.
    const { readFileSync } = require("fs");
    const actionLog = readFileSync(join(dir, "manage.log"), "utf-8");
    expect(actionLog).toContain("action « restart »");
    expect(actionLog).toContain("action « stop »");
  });
});

describe("GET /api/system/info — buildCommit (9.18c)", () => {
  it("marqueur absent → « ? » : build antérieur au marqueur, jamais de faux « à jour »", async () => {
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.buildCommit).toBe("?");
  });

  it("marqueur = HEAD d'un vrai dépôt git → buildCommit == commit", async () => {
    const { execFileSync } = require("child_process");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "nebula@test"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "nebula"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init", "--no-gpg-sign"], { cwd: dir });
    const full = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", ".nebula-build-rev"), full + "\n", "utf-8");
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.commit).not.toBe("unknown");
    expect(res.body.buildCommit).toBe(res.body.commit);
  });

  it("marqueur pointant un rev absent du dépôt → « ? » (pas de faux « à jour »)", async () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(
      join(dir, "dist", ".nebula-build-rev"),
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n",
      "utf-8",
    );
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.buildCommit).toBe("?");
  });
});

describe("GET /api/system/info — processStale (9.18f)", () => {
  it("pas de bundle sur disque → false (rien à comparer, pas de faux positif)", async () => {
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.processStale).toBe(false);
  });

  it("bundle PLUS RÉCENT que le process → true (build sans redémarrage)", async () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "server.cjs"), "// bundle", "utf-8");
    // mtime dans le futur : le bundle a été écrit APRÈS le démarrage du process
    const future = new Date(Date.now() + 120_000);
    require("fs").utimesSync(join(dir, "dist", "server.cjs"), future, future);
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.processStale).toBe(true);
  });

  it("bundle plus ANCIEN que le process → false (process déjà à jour)", async () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "server.cjs"), "// bundle", "utf-8");
    const past = new Date(Date.now() - 3_600_000);
    require("fs").utimesSync(join(dir, "dist", "server.cjs"), past, past);
    const res = await request(buildApp()).get("/api/system/info").expect(200);
    expect(res.body.processStale).toBe(false);
  });
});

describe("9.18ttt — garde « batch en cours » : update/restart ne tuent plus un téléchargement", () => {
  /** Un claim VIVANT : PID du process de test (kill -0 réussit). */
  function writeLiveClaim() {
    writeFileSync(
      join(process.env.NEBULA_CLAIMS_DIR!, "batch-ttt.json"),
      JSON.stringify({ jobId: "batch-ttt", botId: "nebula", pid: process.pid, expectedBytes: 1, createdAt: Date.now() }),
      "utf-8"
    );
  }

  it("batch actif → update REFUSÉ (409) avec un message honnête", async () => {
    writeFakeManageSh();
    writeLiveClaim();
    const res = await request(buildApp()).post("/api/system/update").expect(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("téléchargement");
    expect(res.body.error).toContain("1 batch");
  });

  it("batch actif → restart REFUSÉ aussi ; stop reste LIBRE (arrêt délibéré)", async () => {
    writeFakeManageSh();
    writeLiveClaim();
    await request(buildApp()).post("/api/system/restart").expect(409);
    const res = await request(buildApp()).post("/api/system/stop").expect(200);
    expect(res.body.started).toBe(true);
  });

  it("claim d'un PID MORT → auto-nettoyé, l'update repart (pas de blocage fantôme)", async () => {
    writeFakeManageSh();
    writeFileSync(
      join(process.env.NEBULA_CLAIMS_DIR!, "batch-mort.json"),
      JSON.stringify({ jobId: "batch-mort", botId: "nebula", pid: 99999999, expectedBytes: 1, createdAt: Date.now() }),
      "utf-8"
    );
    const res = await request(buildApp()).post("/api/system/update").expect(200);
    expect(res.body.started).toBe(true);
  });

  it("force explicite (?force=1) → l'update passe (décision délibérée)", async () => {
    writeFakeManageSh();
    writeLiveClaim();
    const res = await request(buildApp()).post("/api/system/update?force=1").expect(200);
    expect(res.body.started).toBe(true);
  });
});
