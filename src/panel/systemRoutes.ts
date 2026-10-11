import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { Express } from "express";

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

export interface SystemInfo {
  version: string;
  commit: string;
  branch: string;
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
    const info: SystemInfo = {
      version: readPackageVersion(),
      commit: commit || "unknown",
      branch: branch || "unknown",
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

  const runAction = (action: SystemAction) => async (_req: any, res: any) => {
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
