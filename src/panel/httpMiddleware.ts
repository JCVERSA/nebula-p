import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createPanelAuth } from "../bot/panelAuth.js";

/**
 * 8.78 (session 3) — middleware HTTP PARTAGÉ entre l'app mono-bot (app.ts)
 * et l'app panneau multi-bots (panelApp.ts).
 *
 * Ces blocs étaient copiés conformes entre les deux applications (headers de
 * sécurité, garde Host-header, limiteur de débit, session panneau, routes
 * d'authentification, protection /api, archive projet) : chaque divergence
 * silencieuse entre les copies était un risque de durcissement oublié d'un
 * côté. Ils vivent désormais ici une seule fois ; les deux applications ne
 * gardent que leur ORDRE d'enregistrement propre (l'app mono-bot protège
 * /api avant les limiteurs, le panneau limite avant de protéger).
 */

export type PanelAuthInstance = ReturnType<typeof createPanelAuth>;

/**
 * Headers de sécurité (M13). Pas de X-Frame-Options/frame-ancestors : le
 * panneau est volontairement embarquable en iframe ; la CSP scelle quand
 * même les origines script/style/connect. Le dev garde 'unsafe-inline'
 * pour le préambule React-refresh de Vite.
 */
export function securityHeaders(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
    if (_req.secure || String(_req.headers["x-forwarded-proto"] || "") === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

/**
 * M3 : validation du header Host quand APP_URL est configurée (anti
 * host-header poisoning des URLs de téléchargement absolues et anti
 * DNS-rebinding). N'accepte que le nom public configuré (ou loopback pour
 * les sondes locales / reverse proxies qui préservent le Host public).
 */
export function hostHeaderGuard(): RequestHandler {
  const allowedHostname = (() => {
    try {
      const u = new URL(process.env.APP_URL || "");
      return u.hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return (req: Request, res: Response, next: NextFunction) => {
    if (allowedHostname) {
      const hostHeader = req.get("host") || "";
      const hostName = hostHeader.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
      const trusted =
        hostName === allowedHostname || hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1";
      if (!trusted) {
        console.warn(`[Panel] Rejected request with foreign Host header: "${hostHeader}" (allowed: ${allowedHostname})`);
        return res.status(400).json({ error: "Invalid Host header." });
      }
    }
    next();
  };
}

/**
 * Limiteur de débit en mémoire (fenêtre fixe, plafond mémoire).
 *
 * Clé = adresse socket pair (pas req.ip) : avec `trust proxy`, req.ip fait
 * confiance à la chaîne X-Forwarded-For fournie par le client, ce qui
 * permettrait de tourner d'identité pour contourner le limiteur.
 * keyPrefix : bucket partagé entre plusieurs chemins (ex. tous les liens
 * médias) au lieu d'un bucket par chemin — sinon un scan de jetons
 * aléatoires obtenait un bucket neuf à chaque essai (audit 8.76 / SEC-03).
 */
export function createRateLimiter() {
  const MAX_RATE_LIMIT_KEYS = 5000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function rateLimit(max: number, windowMs: number, keyPrefix?: string): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const peer = req.socket.remoteAddress || "unknown";
      const key = `${keyPrefix ?? req.path}|${peer}`;
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt < now) {
        if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
          // Purger d'abord les buckets expirés…
          for (const [k, b] of buckets) {
            if (b.resetAt < now) buckets.delete(k);
          }
          // …puis si c'est toujours saturé, jeter les plus vieilles entrées
          // pour éviter l'épuisement mémoire.
          if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
            let pruned = 0;
            for (const k of buckets.keys()) {
              buckets.delete(k);
              if (++pruned > 200) break;
            }
          }
        }
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      bucket.count++;
      if (bucket.count > max) {
        return res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
      }
      next();
    };
  }

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, 10 * 60 * 1000);
  sweepTimer.unref();

  return { rateLimit };
}

/**
 * Session panneau : PANEL_TOKEN (clé admin, jamais exposée au navigateur —
 * l'opérateur se connecte via /api/auth/login et reçoit un cookie HttpOnly
 * aléatoire ; le Bearer token reste pour l'outillage API). Sans PANEL_TOKEN
 * configurée, une clé est générée et affichée dans les logs du process.
 */
export function setupPanelAuth(): { panelAuth: PanelAuthInstance; panelToken: string; tokenIsAutoGenerated: boolean } {
  const configuredToken = process.env.PANEL_TOKEN?.trim() || "";
  const panelToken = configuredToken || crypto.randomBytes(24).toString("hex");
  const tokenIsAutoGenerated = !configuredToken;

  const panelAuth = createPanelAuth({
    configuredToken: panelToken,
    autoGenerated: tokenIsAutoGenerated,
    appUrl: process.env.APP_URL,
  });

  if (tokenIsAutoGenerated) {
    console.log(`🔑 Panel access key (auto-generated): ${panelToken}`);
    console.log("   Use it in the panel login screen, or set PANEL_TOKEN to choose your own.");
  }

  // Balayer les sessions expirées pour que la map ne croisse pas sans borne.
  const sessionSweepTimer = setInterval(() => panelAuth.sweep(), 10 * 60 * 1000);
  sessionSweepTimer.unref();

  return { panelAuth, panelToken, tokenIsAutoGenerated };
}

/**
 * Routes de session panneau (identiques des deux côtés) :
 * /auth/token est explicitement retiré (l'ancien endpoint fuyait la clé) —
 * on renvoie 404 au lieu de laisser le fallback SPA répondre avec le shell.
 */
export function registerAuthRoutes(app: import("express").Express, panelAuth: PanelAuthInstance): void {
  app.get("/auth/token", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  app.post("/api/auth/login", (req, res) => {
    const { token } = req.body ?? {};
    const result = panelAuth.login(token);
    if (!result.success || !result.sessionId) {
      return res.status(401).json({ error: result.error || "Login failed." });
    }
    panelAuth.setCookie(res, result.sessionId);
    res.json({ success: true });
  });

  app.post("/api/auth/logout", (req, res) => {
    panelAuth.logout(req, res);
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ authenticated: panelAuth.isAuthenticated(req) });
  });
}

/**
 * Protection de TOUT /api (et de l'archive projet) SAUF les liens médias
 * publics (/api/media/download/, /d/ — sondés sans cookie) et les routes
 * d'authentification elles-mêmes.
 */
export function protectApiRoutes(app: import("express").Express, panelAuth: PanelAuthInstance): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path.startsWith("/api/");
    const isArchive = req.path === "/nebula-bot-latest.zip";
    if (!isApi && !isArchive) {
      return next();
    }
    if (req.path.startsWith("/api/media/download/") || req.path.startsWith("/d/")) {
      return next();
    }
    if (req.path.startsWith("/api/auth/")) {
      return next();
    }
    panelAuth.requireApiAuth(req, res, next);
  });
}

/**
 * Archive projet (source complète en ZIP, pour sauvegarde/déplacement) —
 * publique, servie par les deux applications.
 */
export function registerProjectArchiveRoute(app: import("express").Express): void {
  app.get("/nebula-bot-latest.zip", (_req, res) => {
    const zipPath = path.join(process.cwd(), "nebula-bot-latest.zip");
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: "Project archive not available on this deployment." });
    }
    res.download(zipPath, "nebula-bot-latest.zip");
  });
}
