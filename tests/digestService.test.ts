/**
 * 8.99 — digest quotidien du propriétaire (owner : 8 h, complet, toujours
 * envoyé). formatDailyDigest est pur ; collectDigestInputs est testé avec
 * un dataDir temporaire.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { formatDailyDigest, collectDigestInputs, type DigestInputs } from "../src/bot/services/digestService.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "digest-"));
  process.env.NEBULA_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

const BASE_INPUTS: DigestInputs = {
  subscriptions: [
    { title: "Tokyo Ghoul", lang: "VF", lastSeenEp: 7 },
    { title: "Jujutsu Kaisen", lang: "VF", lastSeenEp: 4 }
  ],
  diskFreeBytes: 12 * 1024 ** 3,
  diskTotalBytes: 100 * 1024 ** 3,
  aiUsage: { todayCount: 14, dailyLimit: 40 },
  agentHealth: {
    windowHours: 24,
    turns: 12,
    executes: 8,
    asks: 2,
    replies: 2,
    degraded: 1,
    denied: 0,
    errors: 0,
    parseOkRate: 11 / 12,
    avgLatencyMs: 2400,
    argsSanitized: 1,
    lastDegradedAt: Date.now() - 3600_000
  }
};

describe("formatDailyDigest (8.99 — pur)", () => {
  it("contient les quatre sections (veilles, disque, quota, agent)", () => {
    const text = formatDailyDigest(BASE_INPUTS);
    expect(text).toContain("*Veilles (.w)* — 2 active(s)");
    expect(text).toContain("*Tokyo Ghoul* (VF) — dernier épisode vu : 7");
    expect(text).toContain("Espace disque");
    expect(text).toContain("(12 %)");
    expect(text).toContain("14/40 requêtes");
    expect(text).toContain("12 tour(s)");
    expect(text).toContain("92 % décisions conformes");
    expect(text).toContain("1 dégradation(s)");
    expect(text).toContain("latence moy. 2.4 s");
    expect(text).toContain("arguments nettoyés par le garde-fou : 1");
  });

  it("disque < 15 % → avertissement purge", () => {
    const text = formatDailyDigest({
      ...BASE_INPUTS,
      diskFreeBytes: 5 * 1024 ** 3,
      diskTotalBytes: 100 * 1024 ** 3
    });
    expect(text).toContain("(5 %)");
    expect(text).toContain("pense à");
  });

  it("aucune veille → suggestion .w, pas d'erreur", () => {
    const text = formatDailyDigest({ ...BASE_INPUTS, subscriptions: [] });
    expect(text).toContain("0 active(s)");
    expect(text).toContain(".w <titre>");
  });

  it("jour complètement calme → ligne « Rien d'autre à signaler » (toujours envoyé)", () => {
    const text = formatDailyDigest({
      ...BASE_INPUTS,
      subscriptions: [],
      aiUsage: { todayCount: 0, dailyLimit: 40 },
      agentHealth: { ...BASE_INPUTS.agentHealth, turns: 0, avgLatencyMs: null, degraded: 0, argsSanitized: 0 }
    });
    expect(text).toContain("Rien d'autre à signaler");
  });

  it("latence inconnue → pas de « null » dans le message", () => {
    const text = formatDailyDigest({
      ...BASE_INPUTS,
      agentHealth: { ...BASE_INPUTS.agentHealth, turns: 3, avgLatencyMs: null }
    });
    expect(text).not.toContain("null");
  });
});

describe("collectDigestInputs (8.99 — IO, dataDir temporaire)", () => {
  it("collecte sans crash sur un stock vierge (dégradations isolées)", () => {
    const inputs = collectDigestInputs();
    expect(inputs.subscriptions).toEqual([]);
    expect(inputs.aiUsage).toBeDefined();
    expect(inputs.agentHealth.turns).toBe(0);
    // disque : renseigné sur une vraie machine (peut être null en sandbox)
    expect(typeof inputs.diskFreeBytes === "number" || inputs.diskFreeBytes === null).toBe(true);
  });
});

describe("wiring digest (8.99)", () => {
  it("botEngine branche le sender owner + le scheduler au démarrage", () => {
    const fs = require("fs");
    const engine = fs.readFileSync(join(__dirname, "../src/bot/botEngine.ts"), "utf-8");
    expect(engine).toContain("setDigestSender");
    expect(engine).toContain("startDigestScheduler()");
  });

  it("le scheduler respecte NEBULA_DIGEST=0 (off) et l'heure par défaut 8h", () => {
    const fs = require("fs");
    const svc = fs.readFileSync(join(__dirname, "../src/bot/services/digestService.ts"), "utf-8");
    expect(svc).toContain('NEBULA_DIGEST');
    expect(svc).toContain("NEBULA_DIGEST_HOUR");
    expect(svc).toContain("0 ${hour} * * *");
  });

  it("nebula env propose les variables du digest (réglable sans éditer le fichier à la main)", () => {
    const fs = require("fs");
    const manage = fs.readFileSync(join(__dirname, "../manage.sh"), "utf-8");
    expect(manage).toContain("NEBULA_DIGEST|");
    expect(manage).toContain("NEBULA_DIGEST_HOUR|");
  });
});
