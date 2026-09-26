import "dotenv/config";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";
import { initRegistry } from "./src/bot/commandRegistry.js";
import { resolvedFfmpegPath } from "./src/bot/ffmpeg.js";
import { createPanelApp } from "./src/panel/panelApp.js";
import { BotSupervisor, ensurePanelToken } from "./src/bot/botSupervisor.js";
import { startLogGuard } from "./src/bot/logGuard.js";
import { loadBotsConfig } from "./src/bot/botsConfig.js";

/**
 * R2 (audit follow-up 2026-09-01): verify ffmpeg is actually executable at
 * boot and fail LOUDLY when it is not — every anime/video download needs it
 * (HLS remux). The panel still starts so the operator can fix the host from
 * the terminal; media commands will surface their own errors meanwhile.
 */
function verifyFfmpegAtBoot(addLog: (message: string) => void): void {
  // Candidates: the shared resolver's pick (FFMPEG_BIN → PATH → dev-only
  // ffmpeg-static), plus both defaults so the boot log states which one hit.
  const candidates = new Set<string>(["ffmpeg", resolvedFfmpegPath]);
  if (process.env.FFMPEG_BIN?.trim()) candidates.add(process.env.FFMPEG_BIN.trim());
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (result.status === 0) {
      console.log(`[BOOT] ✅ ffmpeg OK — ${candidate === "ffmpeg" ? "on PATH" : candidate}`);
      return;
    } else {
      // try the next candidate
    }
  }
  console.error(
    "[BOOT] ⚠️  FFMPEG INTROUVABLE — les téléchargements anime/vidéo échoueront. " +
      "Installe-le (apt-get install -y ffmpeg) ou vérifie FFMPEG_BIN dans l'environnement.",
  );
  try {
    addLog("[BOOT] ffmpeg manquant — téléchargements vidéo indisponibles");
  } catch {}
}

// ---------------------------------------------------------------------------
// Process-level resilience: a single failed background network promise (e.g.
// a scraper's eager data fetch) must never take the whole panel down. Log it
// loudly instead. Uncaught synchronous exceptions still terminate the
// process — that is deliberate and keeps crashes observable via the runtime.
// ---------------------------------------------------------------------------
let lastRejectionLog = 0;

process.on("unhandledRejection", (reason: unknown) => {
  const now = Date.now();
  if (now - lastRejectionLog < 5000) return; // rate-limit repeated failures
  lastRejectionLog = now;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[UnhandledRejection] ${message}`);
  if (reason instanceof Error && reason.stack) {
    console.error(reason.stack.split("\n").slice(0, 6).join("\n"));
  }
});

/**
 * Production (8.75) : le process devient le PANNEAU SUPERVISEUR du
 * déploiement multi-bots — il ne contient plus de moteur WhatsApp interne.
 * Chaque bot configuré (bots.json, défaut = bot unique « nebula » sur les
 * chemins historiques) tourne dans un process moteur enfant (dist/engine.cjs)
 * lancé et surveillé par le superviseur ; les routes par-bot sont proxifiées.
 * Le panneau ne charge volontairement PAS Baileys (empreinte mémoire minimale).
 */
async function startProductionPanel(PORT: number): Promise<void> {
  // Jeton partagé panneau/enfants : sans PANEL_TOKEN stable, le proxy serait
  // rejeté par les moteurs (chaque process générerait le sien).
  ensurePanelToken();

  // 8.82 : garde taille du log — ce process est la racine de l'arbre (les
  // moteurs enfants y écrivent via son stdout), un seul garde couvre tout.
  startLogGuard();

  const botsConfig = loadBotsConfig();
  const supervisor = new BotSupervisor(botsConfig);
  const app = createPanelApp(supervisor);

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Nebula panel (multi-bots) is live on http://localhost:${PORT}`);
    const cfg = supervisor.describeConfig();
    if (cfg.error) {
      console.error(`⛔ bots.json invalide — AUCUN bot n'est lancé : ${cfg.error}`);
      console.error("   Corrige bots.json puis lance : ./manage.sh restart");
    } else if (cfg.source === "default") {
      console.log(`🤖 bots.json absent — bot par défaut unique « nebula » (chemins historiques)`);
    } else {
      console.log(`🤖 ${cfg.enabled}/${cfg.total} bot(s) activé(s) depuis ${cfg.file}`);
    }
    void supervisor.start();
  });

  const shutdown = async () => {
    console.log("[PANEL] arrêt — stoppe les moteurs enfants…");
    const force = setTimeout(() => process.exit(0), 15_000);
    force.unref?.();
    await supervisor.stopAll();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

/** Dev : panneau + moteur dans le même process, exactement comme avant (8.74). */
async function startDevServer(PORT: number): Promise<void> {
  // Build the command registry (built-ins + commands on disk) before serving.
  await initRegistry();
  const { addLog } = await import("./src/bot/botEngine.js");
  verifyFfmpegAtBoot(addLog);

  const app = createApp();
  const distPath = path.join(process.cwd(), "dist");

  try {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } catch (error: any) {
    console.warn("⚠️ Vite dev middleware unavailable; serving static build if present:", error?.message || error);
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog(`🚀 Nebula Controller Panel is live on http://localhost:${PORT}`);
  });
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV === "production") {
    await startProductionPanel(PORT);
  } else {
    await startDevServer(PORT);
  }
}

startServer();
