/**
 * 8.99 — métriques de l'agent (tracing, leçons OpenAI Agents SDK/VoltAgent).
 * Rolling 48 h en JSON, agrégat 24 h, AUCUN contenu de message.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { recordAgentTurn, getAgentHealth, getAgentMetricsTimeline } from "../src/bot/services/agentMetrics.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-metrics-"));
  process.env.NEBULA_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

const H = 60 * 60 * 1000;

describe("agentMetrics (8.99)", () => {
  it("agrège correctement les 24 dernières heures", () => {
    const now = Date.now();
    recordAgentTurn({ ts: now - 1 * H, action: "execute", engine: "nim", latencyMs: 2000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 2 * H, action: "execute", engine: "nim", latencyMs: 4000, parseOk: true, argsSanitized: true }, now);
    recordAgentTurn({ ts: now - 3 * H, action: "reply", engine: "gemini", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 4 * H, action: "degraded", engine: "nim", latencyMs: 3000, parseOk: false, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 5 * H, action: "denied", engine: "nim", latencyMs: 2000, parseOk: true, argsSanitized: false }, now);

    const h = getAgentHealth(24, now);
    expect(h.turns).toBe(5);
    expect(h.executes).toBe(2);
    expect(h.replies).toBe(1);
    expect(h.degraded).toBe(1);
    expect(h.denied).toBe(1);
    expect(h.parseOkRate).toBeCloseTo(4 / 5);
    expect(h.avgLatencyMs).toBe(2400); // (2000+4000+1000+3000+2000)/5
    expect(h.argsSanitized).toBe(1);
    expect(h.lastDegradedAt).toBe(now - 4 * H);
  });

  it("les enregistrements de plus de 24 h sortent de la fenêtre", () => {
    const now = Date.now();
    recordAgentTurn({ ts: now - 30 * H, action: "execute", engine: "nim", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 2 * H, action: "ask", engine: "nim", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    const h = getAgentHealth(24, now);
    expect(h.turns).toBe(1);
    expect(h.asks).toBe(1);
  });

  it("sans données : santé neutre, pas de division par zéro", () => {
    const h = getAgentHealth(24);
    expect(h.turns).toBe(0);
    expect(h.parseOkRate).toBe(1);
    expect(h.avgLatencyMs).toBeNull();
    expect(h.lastDegradedAt).toBeNull();
  });

  it("wiring : un tour est enregistré sur chaque chemin de l'agent", () => {
    const src = require("fs").readFileSync(join(__dirname, "../src/bot/services/agentRunner.ts"), "utf-8");
    expect(src).toContain("recordAgentTurn");
    expect(src).toContain('action: "degraded"');
    expect(src).toContain('action: "denied"');
    expect(src).toContain('action: "error"');
  });

  it("wiring : le moteur expose /api/bot/agent-health (proxifié par le panneau)", () => {
    const app = require("fs").readFileSync(join(__dirname, "../app.ts"), "utf-8");
    expect(app).toContain('"/api/bot/agent-health"');
  });
});

describe("9.18y (P3) — timeline hornaire 48 h", () => {
  it("bucketise par heure, heures creuses omises, ordre ancien → récent", () => {
    const now = Date.now();
    const h0 = Math.floor(now / H) * H; // début de l'heure courante
    // deux tours dans l'heure précédente (h0-H), un tour il y a 5 h
    recordAgentTurn({ ts: h0 - H + 1000, action: "execute", engine: "gemini", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: h0 - H + 2000, action: "reply", engine: "gemini", latencyMs: 3000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: h0 - 5 * H, action: "ask", engine: "nim", latencyMs: 2000, parseOk: true, argsSanitized: false }, now);
    const t = getAgentMetricsTimeline(48, now);
    expect(t.buckets.length).toBe(2); // 2 heures actives seulement
    expect(t.buckets[0].tsHour).toBe(h0 - 5 * H);
    expect(t.buckets[0].ask).toBe(1);
    expect(t.buckets[1].tsHour).toBe(h0 - H);
    expect(t.buckets[1].turns).toBe(2);
    expect(t.buckets[1].execute).toBe(1);
    expect(t.buckets[1].reply).toBe(1);
    expect(t.buckets[1].avgLatencyMs).toBe(2000);
  });

  it("répartition par moteur + hors fenêtre exclu", () => {
    const now = Date.now();
    recordAgentTurn({ ts: now - 1 * H, action: "reply", engine: "gemini", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 2 * H, action: "reply", engine: "gemini", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 3 * H, action: "execute", engine: "nim", latencyMs: 1000, parseOk: true, argsSanitized: false }, now);
    recordAgentTurn({ ts: now - 50 * H, action: "execute", engine: "nim", latencyMs: 1000, parseOk: true, argsSanitized: false }, now); // hors 48 h
    const t = getAgentMetricsTimeline(48, now);
    expect(t.windowHours).toBe(48);
    expect(t.engines).toEqual({ gemini: 2, nim: 1 });
    expect(t.buckets.length).toBe(3);
  });

  it("store vide : buckets vides, moteurs à zéro, pas de crash", () => {
    const t = getAgentMetricsTimeline(48);
    expect(t.buckets).toEqual([]);
    expect(t.engines).toEqual({ gemini: 0, nim: 0 });
  });

  it("wiring : le moteur expose /api/bot/agent-metrics (page Agent du panneau)", () => {
    const app = require("fs").readFileSync(join(__dirname, "../app.ts"), "utf-8");
    expect(app).toContain('"/api/bot/agent-metrics"');
    expect(app).toContain("getAgentMetricsTimeline(48)");
  });
});
