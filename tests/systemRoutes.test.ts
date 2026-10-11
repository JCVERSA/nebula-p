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
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
