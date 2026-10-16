/**
 * 9.18uu — service statique du panneau : gzip + cache immuable + bundles
 * serveur bloqués.
 *
 * Retour terrain 17/10 (« l'interface lag ») : le bundle de 1,14 Mo partait
 * NON COMPRESSÉ (express.static ne compresse rien) et sans Cache-Control —
 * à travers le tunnel, chaque chargement froid tirait le méga entier.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { mountStaticPanel } from "../src/panel/staticAssets.js";

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-static-"));
const bigJs = "console.log('" + "x".repeat(40000) + "');\n"; // > seuil gzip (1 kB)

beforeAll(() => {
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "assets", "index-ABC123.js"), bigJs);
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>panel</title>");
  fs.writeFileSync(path.join(dist, "server.cjs"), "// bundle serveur — ne doit JAMAIS être servi");
});

afterAll(() => {
  try { fs.rmSync(dist, { recursive: true, force: true }); } catch {}
});

function mkApp() {
  const app = express();
  mountStaticPanel(app, dist);
  return app;
}

describe("9.18uu — statique panel : gzip + cache immuable", () => {
  it("bundle /assets servi COMPRESSÉ (gzip) — 4× moins à travers le tunnel", async () => {
    const res = await request(mkApp())
      .get("/assets/index-ABC123.js")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("noms hashés → Cache-Control immutable 1 an (zéro re-téléchargement)", async () => {
    const res = await request(mkApp()).get("/assets/index-ABC123.js");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
  });

  it("index.html servi SANS cache immuable (il référence les nouveaux hash)", async () => {
    const res = await request(mkApp()).get("/index.html");
    expect(res.status).toBe(200);
    expect(String(res.headers["cache-control"] || "")).not.toContain("immutable");
  });

  it("bundles serveur et sourcemaps BLOQUÉS (le static naïf les exposait)", async () => {
    const cjs = await request(mkApp()).get("/server.cjs");
    expect(cjs.status).toBe(403);
    const map = await request(mkApp()).get("/assets/index-ABC123.js.map");
    expect(map.status).toBe(403);
  });

  it("wiring : server.ts monte mountStaticPanel (pas de express.static nu)", () => {
    const src = fs.readFileSync("server.ts", "utf-8");
    expect(src).toContain("mountStaticPanel(app, distPath)");
    expect(src).not.toContain("app.use(express.static(");
  });
});
