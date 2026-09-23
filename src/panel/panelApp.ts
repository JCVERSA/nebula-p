import express, { Request, Response } from "express";
import type { BotOverview } from "../bot/botSupervisor.js";
import {
  securityHeaders,
  hostHeaderGuard,
  createRateLimiter,
  setupPanelAuth,
  registerAuthRoutes,
  protectApiRoutes,
  registerProjectArchiveRoute,
} from "./httpMiddleware.js";

/**
 * Multi-bots (8.75) — application panneau du process SUPERVISEUR.
 *
 * En production (server.ts), ce panneau remplace l'app mono-bot : il ne
 * contient PLUS de moteur en interne. Il garde les surfaces globales (login,
 * santé, archive projet, liste des bots) et proxifie toutes les routes par-bot
 * (état WhatsApp, pairing, commandes, batchs…) vers le moteur enfant ciblé
 * via le superviseur.
 *
 * Le frontend existant continue de fonctionner sans modification : sans
 * sélecteur `?bot=`, les requêtes partent vers le bot par défaut (le premier
 * activé de bots.json — « nebula » avec les chemins historiques).
 */

/** Surface du superviseur utilisée par le panneau (stubable en tests). */
export interface PanelSupervisor {
  getOverview(): BotOverview[];
  getDefaultBotId(): string | null;
  hasBot(id: string): boolean;
  startBot(id: string): Promise<{ ok: boolean; error?: string }>;
  stopBot(id: string): Promise<{ ok: boolean; error?: string }>;
  restartBot(id: string): Promise<{ ok: boolean; error?: string }>;
  proxyRequest(botId: string, req: Request, res: Response): Promise<void>;
  proxyMediaProbe(req: Request, res: Response): Promise<void>;
  fetchWhatsAppStatuses(): Promise<Record<string, Record<string, unknown> | null>>;
  describeConfig(): { source: "default" | "file"; file?: string; error?: string; total: number; enabled: number };
}

export function createPanelApp(supervisor: PanelSupervisor): express.Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "32mb" }));

  // 8.78 : session panneau + headers de sécurité + garde Host-header
  // partagés avec l'app mono-bot (src/panel/httpMiddleware.ts).
  const { panelAuth } = setupPanelAuth();
  app.use(securityHeaders());
  app.use(hostHeaderGuard());

  // ---------------------------------------------------------------------------
  // Rate limiting — implémentation partagée (httpMiddleware.ts) : peer
  // socket, plafond mémoire, buckets à préfixe (audit 8.76 / SEC-03).
  // ---------------------------------------------------------------------------
  const { rateLimit } = createRateLimiter();
  app.use("/api", rateLimit(300, 60_000));
  app.post("/api/auth/login", rateLimit(8, 60_000));

  // ---------------------------------------------------------------------------
  // Session panneau (login / logout / statut) — partagé.
  // ---------------------------------------------------------------------------
  registerAuthRoutes(app, panelAuth);

  // ---------------------------------------------------------------------------
  // Santé du panneau (sonde publique — aucune information sensible).
  // Le DÉTAIL de l'erreur bots.json n'est renvoyé qu'aux requêtes
  // authentifiées (audit 8.76 / SEC-02) : la sonde publique n'expose qu'un
  // booléen de validité.
  // ---------------------------------------------------------------------------
  app.get("/api/health", (req, res) => {
    const cfg = supervisor.describeConfig();
    const payload: Record<string, unknown> = {
      status: "ok",
      mode: "panel",
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      botsConfigured: cfg.total,
      botsEnabled: cfg.enabled,
      botsConfigValid: !cfg.error,
    };
    if (panelAuth.isAuthenticated(req)) {
      payload.botsConfigError = cfg.error || null;
      payload.botsConfigSource = cfg.source;
    }
    res.json(payload);
  });

  // ---------------------------------------------------------------------------
  // Authentification : tout /api est protégé SAUF les liens médias publics
  // (sondés à travers les moteurs sans cookie de session) et /api/auth/.
  // ---------------------------------------------------------------------------
  protectApiRoutes(app, panelAuth);

  // ---------------------------------------------------------------------------
  // API: vue multi-bots (liste + état process + état WhatsApp fusionné)
  // ---------------------------------------------------------------------------
  app.get("/api/bots", async (_req, res) => {
    const overview = supervisor.getOverview();
    const statuses = await supervisor.fetchWhatsAppStatuses();
    res.json({
      bots: overview.map((bot) => ({
        ...bot,
        whatsapp: statuses[bot.id] || null,
        isDefault: bot.id === supervisor.getDefaultBotId(),
      })),
      config: supervisor.describeConfig(),
    });
  });

  app.post("/api/bots/:id/start", async (req, res) => {
    const result = await supervisor.startBot(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, message: `Bot « ${req.params.id} » lancé.` });
  });

  app.post("/api/bots/:id/stop", async (req, res) => {
    const result = await supervisor.stopBot(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, message: `Bot « ${req.params.id} » arrêté.` });
  });

  app.post("/api/bots/:id/restart", async (req, res) => {
    const result = await supervisor.restartBot(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, message: `Bot « ${req.params.id} » redémarré.` });
  });

  // ---------------------------------------------------------------------------
  // Archive projet (publique) — partagée.
  // ---------------------------------------------------------------------------
  registerProjectArchiveRoute(app);

  // ---------------------------------------------------------------------------
  // Proxy multi-bots
  // ---------------------------------------------------------------------------
  function resolveBotId(req: Request): string | null {
    const fromQuery = Array.isArray(req.query.bot) ? String(req.query.bot[0]) : req.query.bot;
    const raw = (typeof fromQuery === "string" && fromQuery.trim()) || req.get("x-nebula-bot")?.trim() || "";
    if (!raw) return supervisor.getDefaultBotId();
    if (!supervisor.hasBot(raw)) return null;
    return raw;
  }

  const proxyHandler = async (req: Request, res: Response) => {
    const botId = resolveBotId(req);
    if (!botId) {
      res.status(404).json({ error: `Bot inconnu : « ${String(req.query.bot || req.get("x-nebula-bot"))} »` });
      return;
    }
    await supervisor.proxyRequest(botId, req, res);
  };

  // Routes par-bot authentifiées → moteur enfant correspondant.
  app.all("/api/bot/*", proxyHandler);
  app.all("/api/bot", proxyHandler);
  app.all("/api/gemini/*", proxyHandler);
  app.all("/api/batch-downloads", proxyHandler);
  app.all("/api/batch-downloads/*", proxyHandler);
  app.all("/api/batch-downloads-stats", proxyHandler);

  // Liens médias publics (sans auth) → sondage des moteurs par jeton.
  // Rate limit dédié à bucket partagé (audit 8.76 / SEC-03) : ces routes ne
  // sont couvertes par le limiteur général (/api) que partiellement (/d/*
  // y échappe) et chaque jeton inconnu coûte une requête par moteur lancé.
  const mediaLimiter = rateLimit(120, 60_000, "media");
  app.get("/api/media/download/*", mediaLimiter, async (req, res) => {
    await supervisor.proxyMediaProbe(req, res);
  });
  app.get("/d/*", mediaLimiter, async (req, res) => {
    await supervisor.proxyMediaProbe(req, res);
  });

  return app;
}
