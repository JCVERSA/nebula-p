import "dotenv/config";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";
import { initRegistry } from "./src/bot/commandRegistry.js";
import { addLog } from "./src/bot/botEngine.js";
import { resolvedFfmpegPath } from "./src/bot/ffmpeg.js";

/**
 * R2 (audit follow-up 2026-09-01): verify ffmpeg is actually executable at
 * boot and fail LOUDLY when it is not — every anime/video download needs it
 * (HLS remux). The panel still starts so the operator can fix the host from
 * the terminal; media commands will surface their own errors meanwhile.
 */
function verifyFfmpegAtBoot(): void {
  // Candidates: the shared resolver's pick (FFMPEG_BIN → PATH → dev-only
  // ffmpeg-static), plus both defaults so the boot log states which one hit.
  const candidates = new Set<string>(["ffmpeg", resolvedFfmpegPath]);
  if (process.env.FFMPEG_BIN?.trim()) candidates.add(process.env.FFMPEG_BIN.trim());
  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" -version`, { stdio: "ignore" });
      console.log(`[BOOT] ✅ ffmpeg OK — ${candidate === "ffmpeg" ? "on PATH" : candidate}`);
      return;
    } catch {
      // try the next candidate
    }
  }
  console.error(
    "[BOOT] ⚠️  FFMPEG INTROUVABLE — les téléchargements anime/vidéo échoueront. " +
      "Installe-le (apt-get install -y ffmpeg) ou vérifie FFMPEG_BIN dans l'environnement."
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

// Start dev server with Vite in full-stack mode
async function startServer() {
  // Build the command registry (built-ins + commands on disk) before serving.
  await initRegistry();
  verifyFfmpegAtBoot();

  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === "production";
  const distPath = path.join(process.cwd(), "dist");

  if (isProduction) {
    // Production: serve the built SPA statically.
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Dev: Vite dev server middleware setup (with static fallback if unavailable).
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
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog(`🚀 Nebula Controller Panel is live on http://localhost:${PORT}`);
  });
}

startServer();
