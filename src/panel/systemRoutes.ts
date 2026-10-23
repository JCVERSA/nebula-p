import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Express } from "express";
import { listDiskClaims } from "../bot/diskClaims.js";

/**
 * 9.2 — Section « Système » du panneau : mini-console admin.
 *
 * Idée owner : un bouton sur le dashboard qui lance `nebula update`
 * (puis étendu : redémarrer, arrêter, voir les logs). Le panneau est le
 * SUPERVISEUR — c'est donc lui (panelApp) qui expose ces routes, PAS le
 * moteur.
 *
 * Sécurité — règles non négociables :
 *  - AUCUNE entrée utilisateur n'atteint un shell : les trois actions
 *    lancent EXACTEMENT `bash manage.sh <update|restart|stop>`, script
 *    versionné du dépôt. Rien d'arbitraire.
 *  - Routes sous /api → derrière la session panneau (protectApiRoutes)
 *    et le rate limiter dédié.
 *  - Verrou manage.sh honoré : pas deux updates simultanés (409).
 *
 * Cycle de vie délicat : `manage.sh update|restart|stop` ARRÊTE le panneau
 * lui-même (le process qui exécute cette route). Le script est donc lancé
 * DÉTACHÉ (groupe de process propre via spawn detached, sortie vers un
 * fichier) pour survivre à la mort de son parent — même mécanique que le
 * nohup de cmd_start.
 *
 * Toutes les actions/chemins sont injectables (tests sans VPS).
 */

export type SystemAction = "update" | "restart" | "stop";

// 9.18jjjj — état d'échantillonnage pour /api/system/metrics (deltas CPU
// processus et débit réseau entre deux appels). État module : la vérité est
// celle du processus panneau, partagée par toutes les instances de routes.
let metricsLastCpu = process.cpuUsage();
let metricsLastCpuAt = Date.now();
let metricsLastNet: { rx: number; tx: number; at: number } | null = null;

/** Octets cumulés rx/tx de toutes les interfaces (loopback exclu). Null si /proc absent. */
function readProcNetDevBytes(): { rx: number; tx: number } | null {
  try {
    const lines = fs.readFileSync("/proc/net/dev", "utf-8").split("\n").slice(2);
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      if (line.slice(0, sep).trim() === "lo") continue;
      const cols = line.slice(sep + 1).trim().split(/\s+/).map(Number);
      if (cols.length < 16 || cols.some((n) => !Number.isFinite(n))) continue;
      rx += cols[0];
      tx += cols[8];
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

export interface SystemInfo {
  version: string;
  commit: string;
  branch: string;
  /**
   * 9.18c — rev RÉELLEMENT construite (dist/.nebula-build-rev, écrit par
   * manage.sh après un build réussi). « ? » = build antérieur au marqueur
   * ou rev introuvable : le panneau affiche « code ≠ build » plutôt que
   * de laisser croire que tout est à jour (retour terrain 9.18).
   */
  buildCommit: string;
  /**
   * 9.18f — le process panneau lui-même est-il plus ancien que le bundle ?
   * (build sans redémarrage : install.sh, build manuel — le process survit
   * sur l'ancien inode.) Comparaison démarrage vs mtime de dist/server.cjs ;
   * échec de lecture → false : jamais de faux positif.
   */
  processStale: boolean;
}

export interface SystemState {
  info: SystemInfo;
  uptimeSeconds: number;
  updating: boolean;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

export interface SystemActions {
  getInfo(): Promise<SystemInfo>;
  isUpdateRunning(): boolean;
  launch(action: SystemAction): LaunchResult;
  tailBotLog(lines: number): Promise<string>;
  tailActionLog(lines: number): Promise<string>;
}

export interface SystemActionsOptions {
  appDir?: string;
  manageSh?: string;
  lockDir?: string;
  logFile?: string;
  actionLog?: string;
}

/** Freshness du verrou d'update — même sémantique que manage.sh (15 min). */
const LOCK_STALE_MS = 15 * 60 * 1000;

function execFileText(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 5000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout).trim());
    });
  });
}

export function createDefaultSystemActions(opts: SystemActionsOptions = {}): SystemActions {
  const appDir = opts.appDir || process.cwd();
  const manageSh = opts.manageSh || path.join(appDir, "manage.sh");
  const lockDir = opts.lockDir || path.join(process.env.TMPDIR || "/tmp", "nebula-update.lock");
  const logFile = opts.logFile || process.env.NEBULA_LOG_FILE || "/root/bot.log";
  const actionLog = opts.actionLog || path.join(path.dirname(logFile), "nebula-manage.log");

  // Cache court de la version git : éviter un spawn par poll frontend.
  let cache: { at: number; info: SystemInfo } | null = null;
  const CACHE_MS = 30_000;

  function readPackageVersion(): string {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf-8"));
      return String(pkg.version || "?");
    } catch {
      return "?";
    }
  }

  async function getInfo(): Promise<SystemInfo> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.info;
    const [commit, branch] = await Promise.all([
      execFileText("git", ["rev-parse", "--short", "HEAD"], appDir),
      execFileText("git", ["rev-parse", "--abbrev-ref", "HEAD"], appDir),
    ]);
    // 9.18c — rev du BUILD (marqueur écrit par manage.sh), pas celle du
    // checkout : les deux divergent exactement dans le cas du retour
    // terrain 9.18 (pull réussi, build jamais appliqué, UI ancienne).
    let buildCommit = "?";
    try {
      const full = fs.readFileSync(path.join(appDir, "dist", ".nebula-build-rev"), "utf-8").trim();
      if (full) {
        buildCommit = (await execFileText("git", ["rev-parse", "--short", full], appDir)) || "?";
      }
    } catch {
      /* marqueur absent — build antérieur à 9.18c : « ? » est honnête */
    }
    let processStale = false;
    try {
      const bundleMs = fs.statSync(path.join(appDir, "dist", "server.cjs")).mtimeMs;
      const startedMs = Date.now() - process.uptime() * 1000;
      processStale = bundleMs > startedMs + 2000; // tolérance même-seconde
    } catch {
      /* pas de bundle lisible → rien à comparer, pas de faux positif */
    }
    const info: SystemInfo = {
      version: readPackageVersion(),
      commit: commit || "unknown",
      branch: branch || "unknown",
      buildCommit,
      processStale,
    };
    cache = { at: Date.now(), info };
    return info;
  }

  function isUpdateRunning(): boolean {
    try {
      const st = fs.statSync(lockDir);
      // Dossier-verrou frais = update en cours ; au-delà de 15 min c'est
      // un débris d'update interrompu (même règle que manage.sh).
      return Date.now() - st.mtimeMs < LOCK_STALE_MS;
    } catch {
      return false;
    }
  }

  function launch(action: SystemAction): LaunchResult {
    if (!fs.existsSync(manageSh)) {
      return { ok: false, error: `manage.sh introuvable (${manageSh})` };
    }
    if (action === "update" && isUpdateRunning()) {
      return { ok: false, error: "Une mise à jour est déjà en cours." };
    }
    try {
      fs.mkdirSync(path.dirname(actionLog), { recursive: true });
      const stamp = `\n===== ${new Date().toISOString()} — action « ${action} » lancée depuis le panneau =====\n`;
      fs.appendFileSync(actionLog, stamp, "utf-8");
      const fd = fs.openSync(actionLog, "a");
      try {
        const child = spawn("bash", [manageSh, action], {
          detached: true, // groupe de process propre : survit à l'arrêt du panneau
          stdio: ["ignore", fd, fd],
          cwd: appDir,
          env: { ...process.env, TERM: "dumb" },
        });
        child.unref();
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async function tail(file: string, lines: number): Promise<string> {
    // Bornes : 1..300 lignes — assez large pour le panneau, assez étroit
    // pour ne jamais renvoyer un log entier de 150 Mo.
    const n = Math.max(1, Math.min(300, Math.floor(lines) || 100));
    try {
      return await execFileText("tail", [`-n`, String(n), file], appDir);
    } catch {
      return "";
    }
  }

  return {
    getInfo,
    isUpdateRunning,
    launch,
    tailBotLog: (lines) => tail(logFile, lines),
    tailActionLog: (lines) => tail(actionLog, lines),
  };
}

export interface SystemRouteOptions {
  actions?: SystemActions;
  /** Limiteur dédié aux actions destructrices (injection du panneau). */
  actionRateLimit?: (req: any, res: any, next: any) => void;
}

export function registerSystemRoutes(app: Express, options: SystemRouteOptions = {}): void {
  // 9.18ttt (terrain 18/10) : update/restart ARRÊTE le moteur — un batch de
  // téléchargement en cours serait tué sans préavis (8 épisodes perdus en
  // pleine préparation). Un batch actif = un claim disque VIVANT (registre
  // fichier inter-processus, auto-nettoyé des PID morts). Refus honnête ;
  // « stop » reste libre (arrêt délibéré) ; force possible en CLI.
  const batchGuardBlocked = (req: any): string | null => {
    try {
      const claims = listDiskClaims();
      if (claims.length === 0) return null;
      const force = req?.query?.force === "1" || req?.body?.force === true;
      if (force) return null;
      return `Un téléchargement est en cours (${claims.length} batch actif(s)) — attends le message de fin, puis relance. _(Force CLI : NEBULA_FORCE_UPDATE=1)_`;
    } catch {
      return null; // fail-open : une erreur de lecture ne bloque jamais la maintenance
    }
  };
  const actions = options.actions || createDefaultSystemActions();
  const limiter = options.actionRateLimit;

  app.get("/api/system/info", async (_req, res) => {
    const info = await actions.getInfo();
    res.json({
      ...info,
      uptimeSeconds: Math.floor(process.uptime()),
      updating: actions.isUpdateRunning(),
    });
  });

  app.get("/api/system/update-status", async (_req, res) => {
    res.json({
      updating: actions.isUpdateRunning(),
      logTail: await actions.tailActionLog(30),
    });
  });

  app.get("/api/system/logs", async (req, res) => {
    const raw = req.query.lines;
    const parsed = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    const lines = Number.isFinite(parsed) ? parsed : 100;
    res.json({ lines: await actions.tailBotLog(lines) });
  });

  // 9.18jjjj (audit design v4 — onglet Système) : métriques RÉELLES.
  // Le moniteur « diagnostics » affichait des données simulées (Math.random,
  // PIDs codés en dur) présentées comme réelles — contraire au principe
  // « jamais de chiffre inventé ». Ce endpoint expose les vraies mesures :
  // processus Node (CPU en delta process.cpuUsage, RSS, heap V8), système
  // (os.totalmem/freemem, loadavg, uptime) et réseau (/proc/net/dev, débit
  // = delta des compteurs cumulés — Linux seulement, null sinon, jamais
  // d'erreur 500).
  app.get("/api/system/metrics", (_req, res) => {
    const now = Date.now();
    const cpu = process.cpuUsage();
    const wallMs = Math.max(1, now - metricsLastCpuAt);
    // % d'UN cœur (le VPS en a un) — peut dépasser 100 sur machine multi-cœurs.
    const cpuPercent = Math.max(
      0,
      ((cpu.user - metricsLastCpu.user + (cpu.system - metricsLastCpu.system)) / (wallMs * 1000)) * 100,
    );
    metricsLastCpu = cpu;
    metricsLastCpuAt = now;

    const net = readProcNetDevBytes();
    let network: { rxBps: number | null; txBps: number | null } = { rxBps: null, txBps: null };
    if (net && metricsLastNet) {
      const dt = Math.max(0.001, (now - metricsLastNet.at) / 1000);
      network = {
        rxBps: Math.max(0, (net.rx - metricsLastNet.rx) / dt),
        txBps: Math.max(0, (net.tx - metricsLastNet.tx) / dt),
      };
    }
    if (net) metricsLastNet = { rx: net.rx, tx: net.tx, at: now };

    const mem = process.memoryUsage();
    const totalMb = os.totalmem() / 1024 ** 2;
    const freeMb = os.freemem() / 1024 ** 2;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const load = os.loadavg();
    res.json({
      process: {
        pid: process.pid,
        cpuPercent: round1(cpuPercent),
        rssMb: round1(mem.rss / 1024 ** 2),
        heapUsedMb: round1(mem.heapUsed / 1024 ** 2),
        heapTotalMb: round1(mem.heapTotal / 1024 ** 2),
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
      },
      system: {
        totalMb: Math.round(totalMb),
        usedMb: Math.round(totalMb - freeMb),
        usedPercent: totalMb > 0 ? round1(((totalMb - freeMb) / totalMb) * 100) : null,
        loadAvg1: Number.isFinite(load[0]) ? round1(load[0]) : null,
        loadAvg5: Number.isFinite(load[1]) ? round1(load[1]) : null,
        uptimeSeconds: Math.floor(os.uptime()),
        platform: `${os.type()} ${os.release()}`,
        cores: os.cpus().length,
      },
      network,
    });
  });

  const runAction = (action: SystemAction) => async (req: any, res: any) => {
    if (action === "update" || action === "restart") {
      const blocked = batchGuardBlocked(req);
      if (blocked) {
        res.status(409).json({ ok: false, error: blocked });
        return;
      }
    }
    const result = actions.launch(action);
    if (!result.ok) {
      res.status(action === "update" && result.error?.includes("déjà en cours") ? 409 : 400);
      res.json(result);
      return;
    }
    res.json({ started: true, action });
  };

  if (limiter) {
    app.post("/api/system/update", limiter, runAction("update"));
    app.post("/api/system/restart", limiter, runAction("restart"));
    app.post("/api/system/stop", limiter, runAction("stop"));
  } else {
    app.post("/api/system/update", runAction("update"));
    app.post("/api/system/restart", runAction("restart"));
    app.post("/api/system/stop", runAction("stop"));
  }
}
