import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { BotSupervisor } from "../src/bot/botSupervisor.js";
import { parseBotsConfig } from "../src/bot/botsConfig.js";

/**
 * 8.78 — sweep santé des moteurs (botSupervisor.sweepHealthOnce).
 *
 * Le exit-handler relance déjà un moteur MORT (crash isolé, backoff expo).
 * Le trou couvert ici : un moteur qui GÈLE — process vivant mais /api/health
 * muet (event loop bloquée, heap saturé). Test d'intégration avec un VRAI
 * process node factice : il sert /api/health tant qu'aucun marqueur
 * « freeze-<pid> » ne vit dans son dossier d'auth, puis répond 500. Trois
 * échecs consécutifs de sonde doivent déclencher l'arrêt + relance (comme
 * un crash), et le nouveau moteur doit redevenir joignable.
 */

const ENGINE_PORT = 4599;

/** Moteur factice : HTTP minimal qui se « gèle » sur marqueur par PID. */
const FAKE_ENGINE = `
const http = require("http");
const fs = require("fs");
const path = require("path");
const port = Number(process.env.NEBULA_ENGINE_PORT || 0);
const marker = path.join(process.env.NEBULA_AUTH_DIR || ".", "freeze-" + process.pid);
const server = http.createServer((req, res) => {
  const frozen = req.url === "/api/health" && fs.existsSync(marker);
  res.writeHead(frozen ? 500 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(frozen ? { error: "frozen" } : { status: "ok" }));
});
server.listen(port, "127.0.0.1", () => console.log("fake-engine ready"));
setInterval(() => {}, 1 << 30);
`;

let tmpDir: string;
let supervisor: BotSupervisor | null = null;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp", "supervisor-health-"));
});

afterAll(async () => {
  if (supervisor) await supervisor.stopAll();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

async function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout: ${label}`);
}

function overviewOf(s: BotSupervisor) {
  const list = s.getOverview();
  if (list.length < 1) throw new Error("pas de bot dans l'overview");
  return list[0];
}

describe("sweep santé moteurs (gel sans mort du process)", () => {
  it("redémarre un moteur gelé après N échecs de sonde consécutifs", async () => {
    const authDir = path.join(tmpDir, "auth-nebula");
    fs.mkdirSync(authDir, { recursive: true });
    const enginePath = path.join(tmpDir, "fake-engine.cjs");
    fs.writeFileSync(enginePath, FAKE_ENGINE, "utf-8");

    const config = parseBotsConfig(
      JSON.stringify({ bots: [{ id: "nebula", authDir, enginePort: ENGINE_PORT }] })
    );
    if (config.error) throw new Error(config.error);
    supervisor = new BotSupervisor(config, { enginePath, token: "test-token" });

    await supervisor.start();
    // Le moteur monte et devient « running » via pollReadiness.
    await waitFor(() => overviewOf(supervisor!).process === "running", 20_000, "moteur running");
    const firstPid = overviewOf(supervisor!).pid;
    expect(firstPid).toBeTruthy();

    // Une sonde saine ne fait rien (compteur à zéro).
    await supervisor.sweepHealthOnce();
    expect(overviewOf(supervisor!).pid).toBe(firstPid);
    expect(overviewOf(supervisor!).restarts).toBe(0);

    // On gèle CE moteur-ci (marqueur lié à son PID — pas au suivant).
    fs.writeFileSync(path.join(authDir, `freeze-${firstPid}`), "1", "utf-8");

    // Échecs 1/3 et 2/3 : loggués mais pas encore de relance.
    await supervisor.sweepHealthOnce();
    await supervisor.sweepHealthOnce();
    expect(overviewOf(supervisor!).pid).toBe(firstPid);
    expect(overviewOf(supervisor!).restarts).toBe(0);

    // Échec 3/3 : redémarrage forcé, nouveau PID, retour à « running ».
    await supervisor.sweepHealthOnce();
    await waitFor(
      () => overviewOf(supervisor!).process === "running" && overviewOf(supervisor!).pid !== firstPid,
      25_000,
      "moteur relancé et prêt"
    );
    expect(overviewOf(supervisor!).restarts).toBeGreaterThanOrEqual(1);
  }, 90_000);

  it("sweep inactif hors service (stopAll) et ignorer les états non-running", async () => {
    const enginePath = path.join(tmpDir, "fake-engine.cjs");
    const config = parseBotsConfig(
      JSON.stringify({ bots: [{ id: "solo", authDir: path.join(tmpDir, "auth-solo"), enginePort: ENGINE_PORT + 1 }] })
    );
    if (config.error) throw new Error(config.error);
    const s = new BotSupervisor(config, { enginePath, token: "test-token" });

    // Jamais démarré : le sweep ne doit rien tenter (aucun enfant, pas actif).
    await s.sweepHealthOnce();
    expect(s.getOverview().every((b) => b.process === "stopped")).toBe(true);

    // Après stopAll, un sweep résiduel ne doit rien relancer.
    await s.start();
    await s.stopAll();
    await s.sweepHealthOnce();
    expect(s.getOverview().every((b) => b.process === "stopped")).toBe(true);
  }, 60_000);
});
