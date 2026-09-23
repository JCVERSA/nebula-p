import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ChildProcess, spawn } from "child_process";
import readline from "readline";
import type { Request, Response } from "express";
import axios from "axios";
import type { BotsConfig, BotSlot } from "./botsConfig.js";

/**
 * Multi-bots (8.75) — superviseur de moteurs enfants.
 *
 * Le panneau (server.ts, mode production) héberge ce superviseur : il lance
 * un process `dist/engine.cjs` par slot bot avec des variables d'environnement
 * dédiées (NEBULA_AUTH_DIR / NEBULA_DATA_DIR / NEBULA_AI_PERSONALITY /
 * NEBULA_ENGINE_PORT). Chaque enfant est une application complète
 * (createApp()) liée à 127.0.0.1 uniquement ; le panneau proxifie les routes
 * par-bot vers l'enfant concerné.
 *
 * Propriétés voulues (décisions owner 2026-09-23, option B) :
 *   - un seul déploiement (`nebula update` unique), N process ;
 *   - crash isolé : un enfant qui meurt est relancé (backoff expo), le
 *     panneau et les autres bots restent debout ;
 *   - `nebula update` coupe tout le monde (courte coupure assumée).
 */

export interface BotOverview {
  id: string;
  name: string;
  enabled: boolean;
  /** État du PROCESSUS enfant, pas de la connexion WhatsApp. */
  process: "stopped" | "starting" | "running" | "backoff";
  pid: number | null;
  enginePort: number;
  uptimeSeconds: number;
  restarts: number;
  ready: boolean;
}

export interface BotStartResult {
  ok: boolean;
  error?: string;
}

interface BotRuntime {
  slot: BotSlot;
  state: BotOverview["process"];
  child: ChildProcess | null;
  startedAt: number;
  restarts: number;
  ready: boolean;
  intentionalStop: boolean;
  restartTimer: NodeJS.Timeout | null;
  readyTimer: NodeJS.Timeout | null;
  backoffMs: number;
}

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 1_000;
const STAGGER_MS = 1_500;
const STOP_GRACE_MS = 8_000;
const BACKOFF_RESET_MS = 10 * 60_000; // 10 min de stabilité → compteur remis à zéro
const PROXY_TIMEOUT_MS = 300_000;
const STATUS_TIMEOUT_MS = 1_500;

/** Backoff exponentiel de relance : 5 s → 10 → 20 → 40 → 60 s (plafond). */
export function computeBackoffMs(restarts: number): number {
  const attempts = Math.max(1, restarts);
  return Math.min(5_000 * Math.pow(2, attempts - 1), 60_000);
}

/**
 * Environnement d'un moteur enfant : isole session + données + persona, et
 * propage le reste (clés IA, proxy, PANEL_TOKEN…) du panneau parent. Pure,
 * donc testable sans spawn.
 */
export function buildChildEnv(slot: BotSlot, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env.NEBULA_BOT_ID = slot.id;
  env.NEBULA_ENGINE_PORT = String(slot.enginePort);
  env.NEBULA_AUTH_DIR = slot.authDir;
  env.NEBULA_DATA_DIR = slot.dataDir;
  env.NEBULA_AI_PERSONALITY = slot.persona || "";
  env.NEBULA_AUTO_START = slot.autoStart ? "1" : "0";
  // L'enfant n'est pas un panneau public : jamais de PORT du parent.
  delete env.PORT;
  return env;
}

/**
 * Garantit un PANEL_TOKEN stable et partagé panneau/enfants. Sans cette étape,
 * chaque process générerait son propre jeton aléatoire (panelAuth) et le
 * proxy du panneau serait rejeté par les enfants (401).
 *
 * Ordre : variable d'environnement → ligne PANEL_TOKEN du .env → génération +
 * persistance dans .env (+ process.env). Retourne le jeton effectif.
 */
export function ensurePanelToken(envFile: string | undefined = undefined): string {
  const existing = process.env.PANEL_TOKEN?.trim();
  if (existing) return existing;

  const file = envFile || process.env.NEBULA_ENV_FILE || path.join(process.cwd(), ".env");
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(/^\s*PANEL_TOKEN\s*=\s*(\S+)\s*$/m);
      if (match?.[1]) {
        process.env.PANEL_TOKEN = match[1];
        return match[1];
      }
    }
  } catch {
    // Lecture impossible : on retombe sur la génération ci-dessous.
  }

  const token = crypto.randomBytes(24).toString("hex");
  process.env.PANEL_TOKEN = token;
  try {
    const prefix = fs.existsSync(file) && fs.readFileSync(file, "utf-8").length > 0 ? "\n" : "";
    fs.appendFileSync(file, `${prefix}# PANEL_TOKEN généré par le superviseur multi-bots (8.75)\nPANEL_TOKEN=${token}\n`, {
      encoding: "utf-8",
    });
    console.log(`🔑 PANEL_TOKEN généré et persisté dans ${file} (partagé panneau + moteurs)`);
  } catch (e: any) {
    console.warn(`⚠️ Impossible de persister PANEL_TOKEN dans ${file} : ${e?.message || e}`);
  }
  return token;
}

export class BotSupervisor {
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly config: BotsConfig;
  private readonly enginePath: string;
  private readonly token: string;
  private active = false;

  constructor(config: BotsConfig, opts: { enginePath?: string; token?: string } = {}) {
    this.config = config;
    for (const slot of config.bots) {
      this.runtimes.set(slot.id, {
        slot,
        state: "stopped",
        child: null,
        startedAt: 0,
        restarts: 0,
        ready: false,
        intentionalStop: true,
        restartTimer: null,
        readyTimer: null,
        backoffMs: 0,
      });
    }
    this.enginePath = opts.enginePath || path.join(process.cwd(), "dist", "engine.cjs");
    this.token = opts.token || process.env.PANEL_TOKEN || "";
  }

  /** Jeton utilisé pour authentifier les requêtes proxifiées vers les enfants. */
  get panelToken(): string {
    return this.token;
  }

  /** Résumé de la configuration bots.json pour le panneau / la CLI. */
  describeConfig(): { source: "default" | "file"; file?: string; error?: string; total: number; enabled: number } {
    return {
      source: this.config.source,
      file: this.config.file,
      error: this.config.error,
      total: this.config.bots.length,
      enabled: this.config.bots.filter((b) => b.enabled).length,
    };
  }


  getOverview(): BotOverview[] {
    return Array.from(this.runtimes.values()).map((rt) => ({
      id: rt.slot.id,
      name: rt.slot.name,
      enabled: rt.slot.enabled,
      process: rt.state,
      pid: rt.child?.pid ?? null,
      enginePort: rt.slot.enginePort,
      uptimeSeconds: rt.state === "running" || rt.state === "starting" ? Math.max(0, Math.floor((Date.now() - rt.startedAt) / 1000)) : 0,
      restarts: rt.restarts,
      ready: rt.ready,
    }));
  }

  /** Bot par défaut pour les requêtes sans sélecteur : le 1er activé de la liste. */
  getDefaultBotId(): string | null {
    for (const rt of this.runtimes.values()) {
      if (rt.slot.enabled) return rt.slot.id;
    }
    return null;
  }

  hasBot(id: string): boolean {
    return this.runtimes.has(id);
  }

  private log(botId: string, message: string): void {
    console.log(`[bots:${botId}] ${message}`);
  }

  /**
   * Lance tous les bots activés, décalés de STAGGER_MS pour éviter un pic
   * CPU/RAM au démarrage (3 Baileys simultanés sur un petit VPS).
   */
  async start(): Promise<void> {
    this.active = true;
    const queue = Array.from(this.runtimes.values()).filter((rt) => rt.slot.enabled);
    for (let i = 0; i < queue.length; i++) {
      const rt = queue[i];
      if (i === 0) {
        this.spawnBot(rt);
      } else {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (this.active) this.spawnBot(rt);
            resolve();
          }, STAGGER_MS);
          timer.unref?.();
        });
      }
    }
  }

  async stopAll(): Promise<void> {
    this.active = false;
    const stops: Promise<void>[] = [];
    for (const id of this.runtimes.keys()) {
      stops.push(this.stopBot(id).then(() => undefined));
    }
    await Promise.all(stops);
  }

  async startBot(id: string): Promise<BotStartResult> {
    const rt = this.runtimes.get(id);
    if (!rt) return { ok: false, error: `Bot inconnu : « ${id} »` };
    if (!rt.slot.enabled) return { ok: false, error: `Bot « ${id} » est désactivé dans bots.json` };
    if (rt.child && rt.child.exitCode === null) return { ok: false, error: `Bot « ${id} » tourne déjà (PID ${rt.child.pid})` };
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = null;
    }
    const spawned = this.spawnBot(rt);
    return spawned ? { ok: true } : { ok: false, error: `Moteur introuvable (${this.enginePath}) — lance ./manage.sh update` };
  }

  async stopBot(id: string): Promise<BotStartResult> {
    const rt = this.runtimes.get(id);
    if (!rt) return { ok: false, error: `Bot inconnu : « ${id} »` };
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = null;
    }
    const child = rt.child;
    if (!child || child.exitCode !== null) {
      rt.state = "stopped";
      rt.intentionalStop = true;
      return { ok: true };
    }
    rt.intentionalStop = true;
    rt.state = "stopped";
    this.log(id, "arrêt demandé (SIGTERM)…");
    return new Promise<BotStartResult>((resolve) => {
      child.once("exit", () => resolve({ ok: true }));
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        if (child.exitCode === null) {
          this.log(id, "ne s'est pas arrêté à temps — SIGKILL");
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }, STOP_GRACE_MS).unref?.();
    });
  }

  async restartBot(id: string): Promise<BotStartResult> {
    const stop = await this.stopBot(id);
    if (!stop.ok) return stop;
    return this.startBot(id);
  }

  private spawnBot(rt: BotRuntime): boolean {
    if (!fs.existsSync(this.enginePath)) {
      rt.state = "stopped";
      this.log(rt.slot.id, `moteur introuvable : ${this.enginePath} — lance ./manage.sh update`);
      return false;
    }
    rt.intentionalStop = false;
    rt.state = "starting";
    rt.ready = false;
    rt.startedAt = Date.now();

    const child = spawn(
      process.execPath,
      ["--expose-gc", `--max-old-space-size=${rt.slot.maxOldSpaceMb}`, this.enginePath],
      {
        env: buildChildEnv(rt.slot, process.env),
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
      },
    );
    rt.child = child;
    this.log(rt.slot.id, `moteur lancé (PID ${child.pid}, port ${rt.slot.enginePort}, heap ${rt.slot.maxOldSpaceMb} Mo)`);

    // Logs enfant → log du panneau, préfixés pour rester lisibles.
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      readline
        .createInterface({ input: stream })
        .on("line", (line) => {
          console.log(`[bot:${rt.slot.id}] ${line}`);
        })
        .on("error", () => {});
    }

    child.on("error", (err) => {
      this.log(rt.slot.id, `échec du lancement : ${err.message}`);
      rt.state = "stopped";
      rt.child = null;
    });

    child.on("exit", (code, signal) => {
      if (rt.readyTimer) {
        clearTimeout(rt.readyTimer);
        rt.readyTimer = null;
      }
      rt.ready = false;
      rt.child = null;
      const uptime = Date.now() - rt.startedAt;
      if (rt.intentionalStop || !this.active) {
        rt.state = "stopped";
        this.log(rt.slot.id, `moteur arrêté (${signal || `code ${code}`})`);
        return;
      }
      // Crash inattendu : backoff expo, compteur remis à zéro après stabilité.
      if (uptime > BACKOFF_RESET_MS) rt.restarts = 0;
      rt.restarts++;
      rt.backoffMs = computeBackoffMs(rt.restarts);
      rt.state = "backoff";
      this.log(rt.slot.id, `moteur mort (${signal || `code ${code}`}) — relance dans ${Math.round(rt.backoffMs / 1000)} s`);
      rt.restartTimer = setTimeout(() => {
        rt.restartTimer = null;
        if (this.active && !rt.intentionalStop) this.spawnBot(rt);
      }, rt.backoffMs);
      rt.restartTimer.unref?.();
    });

    this.pollReadiness(rt);
    return true;
  }

  /** Attend que l'enfant réponde sur /api/health (mark ready, sans bloquer). */
  private pollReadiness(rt: BotRuntime): void {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const attempt = () => {
      if (!rt.child || rt.child.exitCode !== null) return;
      axios
        .get(`http://127.0.0.1:${rt.slot.enginePort}/api/health`, { timeout: 1_000, validateStatus: () => true })
        .then((res) => {
          if (res.status === 200) {
            rt.ready = true;
            if (rt.state === "starting") rt.state = "running";
            this.log(rt.slot.id, "moteur prêt");
          } else if (Date.now() < deadline) {
            rt.readyTimer = setTimeout(attempt, READY_POLL_MS);
            rt.readyTimer.unref?.();
          }
        })
        .catch(() => {
          if (Date.now() < deadline) {
            rt.readyTimer = setTimeout(attempt, READY_POLL_MS);
            rt.readyTimer.unref?.();
          }
        });
    };
    rt.readyTimer = setTimeout(attempt, READY_POLL_MS);
    rt.readyTimer.unref?.();
  }

  /** État WhatsApp (connecté, QR, pairing…) d'un enfant, ou null si injoignable. */
  async fetchWhatsAppStatus(botId: string): Promise<Record<string, unknown> | null> {
    const rt = this.runtimes.get(botId);
    if (!rt || !rt.child || rt.child.exitCode !== null) return null;
    try {
      const res = await axios.get(`http://127.0.0.1:${rt.slot.enginePort}/api/bot/status`, {
        timeout: STATUS_TIMEOUT_MS,
        validateStatus: () => true,
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (res.status !== 200 || typeof res.data !== "object" || res.data === null) return null;
      return res.data as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Statut WhatsApp de tous les enfants lancés (clé = id du bot). */
  async fetchWhatsAppStatuses(): Promise<Record<string, Record<string, unknown> | null>> {
    const entries = await Promise.all(
      Array.from(this.runtimes.keys()).map(async (id) => [id, await this.fetchWhatsAppStatus(id)] as const),
    );
    return Object.fromEntries(entries);
  }

  private resolveRuntime(botId: string): BotRuntime | null {
    const rt = this.runtimes.get(botId);
    if (!rt) return null;
    if (!rt.child || rt.child.exitCode !== null) return null;
    return rt;
  }

  /**
   * Proxifie une requête API vers le moteur du bot demandé. Le panneau a déjà
   * authentifié la requête ; on la transmet avec le Bearer PANEL_TOKEN (les
   * enfants n'écoutent que sur 127.0.0.1). Le cookie de session n'est PAS
   * transmis : l'enfant ne connaît que le Bearer.
   */
  async proxyRequest(botId: string, req: Request, res: Response): Promise<void> {
    const rt = this.resolveRuntime(botId);
    if (!rt) {
      res.status(503).json({ error: `Le bot « ${botId} » est arrêté ou injoignable.` });
      return;
    }
    const forwardHeaders: Record<string, string> = {};
    // Host + x-forwarded-* sont transmis pour que l'enfant calcule les mêmes
    // URLs publiques (liens médias temporaires) que le panneau.
    for (const name of ["accept", "content-type", "user-agent", "host", "x-forwarded-proto", "x-forwarded-for"]) {
      const value = req.get(name);
      if (value) forwardHeaders[name] = value;
    }
    if (this.token) forwardHeaders.authorization = `Bearer ${this.token}`;

    try {
      const upstream = await axios.request({
        method: req.method as any,
        url: `http://127.0.0.1:${rt.slot.enginePort}${req.originalUrl}`,
        headers: forwardHeaders,
        data: req.method === "GET" || req.method === "HEAD" ? undefined : (req.body as any),
        responseType: "stream",
        timeout: PROXY_TIMEOUT_MS,
        validateStatus: () => true,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      res.status(upstream.status);
      for (const name of ["content-type", "content-length", "content-disposition", "cache-control"]) {
        const value = upstream.headers[name];
        if (value) res.setHeader(name, value);
      }
      upstream.data.pipe(res);
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNABORTED") {
        res.status(503).json({ error: `Le bot « ${botId} » est arrêté ou injoignable.` });
      } else {
        console.error(`[bots:${botId}] erreur proxy ${req.method} ${req.path} :`, e?.message || e);
        res.status(502).json({ error: "Le moteur du bot a renvoyé une réponse invalide." });
      }
    }
  }

  /**
   * Liens médias publics (/d/:token, /api/media/download/:token) : le jeton
   * appartient à un seul moteur mais le panneau ne sait pas lequel — on essaie
   * le bot par défaut puis les autres jusqu'à obtenir autre chose qu'un 404.
   */
  async proxyMediaProbe(req: Request, res: Response): Promise<void> {
    const order: string[] = [];
    const defaultId = this.getDefaultBotId();
    if (defaultId) order.push(defaultId);
    for (const rt of this.runtimes.values()) {
      if (rt.slot.id !== defaultId) order.push(rt.slot.id);
    }

    for (const botId of order) {
      const rt = this.resolveRuntime(botId);
      if (!rt) continue;
      try {
        const upstream = await axios.request({
          method: "GET",
          url: `http://127.0.0.1:${rt.slot.enginePort}${req.originalUrl}`,
          headers: {
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...(req.get("host") ? { host: req.get("host") as string } : {}),
          },
          responseType: "stream",
          timeout: PROXY_TIMEOUT_MS,
          validateStatus: () => true,
          maxContentLength: Infinity,
        });
        if (upstream.status === 404) {
          (upstream.data as any)?.destroy?.();
          continue; // Ce moteur ne connaît pas ce jeton.
        }
        res.status(upstream.status);
        for (const name of ["content-type", "content-length", "content-disposition", "cache-control"]) {
          const value = upstream.headers[name];
          if (value) res.setHeader(name, value);
        }
        upstream.data.pipe(res);
        return;
      } catch {
        // Moteur injoignable : on tente le suivant.
      }
    }
    res.status(404).json({ error: "Lien média introuvable ou expiré." });
  }
}
