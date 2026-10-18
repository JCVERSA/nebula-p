import "dotenv/config";
import fs from "fs";
import { spawnSync } from "child_process";
import { createApp } from "./app.js";
import { initRegistry } from "./src/bot/commandRegistry.js";
import { initAgentStatePersistence } from "./src/bot/services/agentStateStore.js";
import { startReminderScheduler } from "./src/bot/services/reminderService.js";
import { getLiveSocket } from "./src/bot/liveSocket.js";
import { terminateTrackedSpawns } from "./src/bot/services/spawnRegistry.js";
import { addLog, startLiveBot, stopLiveBot } from "./src/bot/botEngine.js";
import { readBuildSha } from "./src/bot/buildInfo.js";
import { hasRegisteredCreds } from "./src/bot/botsConfig.js";
import { resolvedFfmpegPath } from "./src/bot/ffmpeg.js";

/**
 * Multi-bots (8.75) — point d'entrée d'un MOTEUR enfant.
 *
 * Lancé par le superviseur (botSupervisor.ts) avec :
 *   NEBULA_BOT_ID        — identifiant du slot (logs)
 *   NEBULA_ENGINE_PORT   — port HTTP local (127.0.0.1 uniquement)
 *   NEBULA_AUTH_DIR      — dossier de session Baileys du bot
 *   NEBULA_DATA_DIR      — dossier de données du bot
 *   NEBULA_AI_PERSONALITY— persona IA dédiée (optionnelle)
 *   NEBULA_AUTO_START    — "1" : reconnexion auto si session appairée
 *
 * L'enfant exécute l'application complète createApp() (moteur + API, sans
 * fichiers statiques) : le panneau parent proxifie les requêtes vers lui.
 * Aucune dépendance au superviseur au-delà de l'environnement — un enfant
 * peut être lancé à la main (tsx engine.ts) pour déboguer un bot précis.
 */

const ENGINE_PORT = Number(process.env.NEBULA_ENGINE_PORT || 0);
const BOT_ID = process.env.NEBULA_BOT_ID || "engine";
const AUTH_DIR = process.env.NEBULA_AUTH_DIR || "nebula_auth_info";

if (!ENGINE_PORT) {
  console.error(
    `[engine:${BOT_ID}] NEBULA_ENGINE_PORT manquant — ce binaire est lancé par le superviseur.`,
  );
  process.exit(1);
}

function log(message: string): void {
  console.log(`[engine:${BOT_ID}] ${message}`);
}

// Vérification ffmpeg au boot (copie de server.ts : chaque moteur télécharge
// de l'anime/vidéo, l'absence doit être BRUYANTE mais non fatale).
function verifyFfmpegAtBoot(): void {
  const candidates = new Set<string>(["ffmpeg", resolvedFfmpegPath]);
  if (process.env.FFMPEG_BIN?.trim()) candidates.add(process.env.FFMPEG_BIN.trim());
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    if (result.status === 0) {
      // 9.18mm — la version dans le boot : un ffmpeg 4.4 (apt Ubuntu 22.04)
      // et un ffmpeg 6.x ne plantent pas pareil, sans elle un log terrain
      // ne dit rien de l'outil qui a tourné.
      const firstLine = String(result.stdout || "")
        .split("\n")[0]
        .trim();
      const version = /ffmpeg version (\S+)/.exec(firstLine)?.[1] || "version inconnue";
      log(`ffmpeg OK — ${candidate === "ffmpeg" ? "sur le PATH" : candidate} (${version})`);
      return;
    }
  }
  console.error(
    `[engine:${BOT_ID}] ⚠️  FFMPEG INTROUVABLE — les téléchargements anime/vidéo échoueront. ` +
      "Installe-le (apt-get install -y ffmpeg) ou vérifie FFMPEG_BIN dans l'environnement.",
  );
  try {
    addLog("[BOOT] ffmpeg manquant — téléchargements vidéo indisponibles");
  } catch {}
}

// Résilience process : une promesse réseau rejetée ne doit pas tuer le moteur
// (copie de server.ts, rate-limitée).
let lastRejectionLog = 0;
process.on("unhandledRejection", (reason: unknown) => {
  const now = Date.now();
  if (now - lastRejectionLog < 5000) return;
  lastRejectionLog = now;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[engine:${BOT_ID}] [UnhandledRejection] ${message}`);
  if (reason instanceof Error && reason.stack) {
    console.error(reason.stack.split("\n").slice(0, 6).join("\n"));
  }
});

let shuttingDown = false;
let server: import("http").Server | null = null;

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("arrêt demandé — fermeture de la session WhatsApp…");
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        try {
          stopLiveBot();
        } catch {}
        resolve();
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {}
  // 9.18ggg — terminer les enfants média (ffmpeg/ffprobe/yt-dlp) avant de
  // sortir : sinon un encodage orphelin continue de consommer le cœur du
  // VPS après notre mort (audit 17/10 §6 — le SIGKILL du superviseur ne
  // touche que le moteur, jamais ses petits-fils).
  try {
    await terminateTrackedSpawns(2000);
  } catch {}
  try {
    server?.close();
  } catch {}
  process.exit(code);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

async function main(): Promise<void> {
  // 9.18ttt : le sha dit CE qui tourne — un « nebula logs » suffit à vérifier un déploiement.
  log(`démarrage (port local ${ENGINE_PORT}, auth: ${AUTH_DIR}, build ${readBuildSha()})`);

  await initRegistry();
  // 9.18w : état volatil de l'agent (confirmations + budget/h) restauré au
  // boot du moteur, puis persisté à chaque mutation (dataDir dédié au slot).
  initAgentStatePersistence();
  // 9.18bb (P7) : livraison des rappels programmés (sock lu à chaque tick).
  // 9.18ggg — via liveSocket : l'ancien cast lisait getBotState().socket, un
  // champ qui n'EXISTE PAS dans l'objet retourné → les rappels n'ont jamais
  // été livrés (audit 17/10 §5).
  startReminderScheduler(getLiveSocket);
  verifyFfmpegAtBoot();

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const app = createApp();
  server = app.listen(ENGINE_PORT, "127.0.0.1", () => {
    log(`moteur prêt sur 127.0.0.1:${ENGINE_PORT}`);
  });

  // Reconnexion automatique si une session appairée existe déjà : après un
  // reboot/une mise à jour, les bots reviennent seuls (aucun clic panneau).
  if (process.env.NEBULA_AUTO_START === "1" && hasRegisteredCreds(AUTH_DIR)) {
    log("session appairée détectée — connexion WhatsApp automatique");
    startLiveBot(false);
  } else if (process.env.NEBULA_AUTO_START === "1") {
    log("aucune session appairée — en attente d'un appariement (panneau ou nebula pair)");
  }

  // Garde orpheline : si le panneau parent meurt, cet enfant s'arrête
  // proprement (sinon il garderait le port et la session WhatsApp vivants
  // sans superviseur pour le relancer).
  const parentPid = process.ppid;
  setInterval(() => {
    if (process.ppid !== parentPid) {
      log("panneau parent disparu — arrêt de ce moteur");
      void shutdown(0);
    }
  }, 5000).unref();
}

void main();
