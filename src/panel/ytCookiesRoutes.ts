import fs from "fs";
import path from "path";
import type { Express } from "express";
import { parseEnvFile, upsertEnvKey } from "./envRoutes.js";

/**
 * 9.4 — Cookies YouTube collés depuis le dashboard (section Système).
 *
 * Retour owner : plus jamais `nano /root/p/.yt-cookies.txt` + `chmod 600`
 * + édition de .env — on colle le CONTENU du cookies.txt exporté dans le
 * panneau, le reste est automatique.
 *
 * Sécurité :
 *  - le CONTENU des cookies (session YouTube !) n'est JAMAIS renvoyé par
 *    l'API — le GET ne retourne que des métadonnées (nombre, domaines,
 *    expiration) ;
 *  - validation stricte du format Netscape (7 champs tabulés) + au moins
 *    un cookie du domaine youtube.com + aucun cookie totalement expiré ;
 *  - écriture atomique 0600 dans le dépôt (à côté du .env) ;
 *  - NEBULA_YTDLP_COOKIES est écrit dans le .env automatiquement ;
 *  - remplacement du fichier = À CHAUD (activeCookiesFile vérifie à chaque
 *    appel) ; seule la PREMIÈRE configuration (env absent du process moteur)
 *    demande un redémarrage — indiqué dans la réponse.
 */

export interface YtCookiesStatus {
  configured: boolean;
  envSet: boolean;
  fileExists: boolean;
  cookieCount: number;
  domains: string[];
  maxExpiry: string | null; // ISO — null si cookies de session
  updatedAt: string | null;
  valid: boolean;
}

export interface YtCookiesDiagnostic {
  cookieCount: number;
  domains: string[];
  maxExpiry: string | null;
  expired: boolean;
}

export interface YtCookiesValidation {
  ok: boolean;
  error?: string;
  diagnostic?: YtCookiesDiagnostic;
}

const MAX_CONTENT_BYTES = 512 * 1024;

/** Valide un contenu cookies.txt Netscape (pur — testé). */
export function validateYtCookiesContent(content: string): YtCookiesValidation {
  if (!content || !content.trim()) {
    return { ok: false, error: "Contenu vide — colle le contenu du fichier cookies.txt exporté." };
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
    return { ok: false, error: "Fichier trop volumineux (512 Ko max) — tu as probablement collé autre chose." };
  }

  const domains = new Set<string>();
  let cookieCount = 0;
  let hasYoutube = false;
  let maxExpirySec = 0;
  let hasSessionCookie = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 7) {
      return {
        ok: false,
        error: `Format invalide : une ligne n'a pas 7 champs séparés par des tabulations (${fields.length} trouvés). Réexporte avec une extension « cookies.txt » au format Netscape.`,
      };
    }
    const [domain, , , , expiryStr] = fields;
    cookieCount += 1;
    const d = domain.replace(/^\./, "").toLowerCase();
    domains.add(d);
    if (d === "youtube.com" || d.endsWith(".youtube.com")) hasYoutube = true;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < 0) {
      return { ok: false, error: "Format invalide : champ d'expiration non numérique." };
    }
    if (expiry === 0) hasSessionCookie = true;
    else if (expiry > maxExpirySec) maxExpirySec = expiry;
  }

  if (cookieCount === 0) {
    return { ok: false, error: "Aucun cookie trouvé dans le contenu (uniquement des commentaires ?)." };
  }
  if (!hasYoutube) {
    return {
      ok: false,
      error: "Aucun cookie du domaine youtube.com — exporte bien tes cookies depuis youtube.com connecté.",
    };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = maxExpirySec > 0 && maxExpirySec < nowSec && !hasSessionCookie;
  if (expired) {
    return { ok: false, error: "Tous les cookies sont déjà expirés — reconnecte-toi à YouTube puis réexporte le fichier." };
  }

  return {
    ok: true,
    diagnostic: {
      cookieCount,
      domains: [...domains].slice(0, 6),
      maxExpiry: maxExpirySec > 0 ? new Date(maxExpirySec * 1000).toISOString() : null,
      expired: false,
    },
  };
}

export interface YtCookiesOptions {
  appDir?: string;
  envFile?: string;
  cookiesFile?: string;
}

export interface YtCookiesHandler {
  status(): YtCookiesStatus;
  save(content: string): { ok: true; restartRequired: boolean; diagnostic: YtCookiesDiagnostic } | { ok: false; error: string; status: number };
  remove(): { ok: true; restartRequired: boolean };
}

export function createYtCookiesHandler(opts: YtCookiesOptions = {}): YtCookiesHandler {
  const appDir = opts.appDir || process.cwd();
  const envFile = opts.envFile || path.join(appDir, ".env");
  const cookiesFile = opts.cookiesFile || path.join(appDir, ".yt-cookies.txt");

  function readEnv(): string {
    try {
      return fs.readFileSync(envFile, "utf-8");
    } catch {
      return "";
    }
  }

  function writeEnv(content: string): void {
    const tmp = `${envFile}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, content, "utf-8");
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, envFile);
  }

  function inspectFile(): { exists: boolean; diagnostic: YtCookiesDiagnostic | null; updatedAt: string | null } {
    try {
      const st = fs.statSync(cookiesFile);
      const content = fs.readFileSync(cookiesFile, "utf-8");
      const v = validateYtCookiesContent(content);
      return {
        exists: true,
        diagnostic: v.ok ? v.diagnostic! : { cookieCount: 0, domains: [], maxExpiry: null, expired: false },
        updatedAt: st.mtime.toISOString(),
      };
    } catch {
      return { exists: false, diagnostic: null, updatedAt: null };
    }
  }

  return {
    status() {
      const parsed = parseEnvFile(readEnv());
      const envSet = Boolean(parsed.NEBULA_YTDLP_COOKIES);
      const { exists, diagnostic, updatedAt } = inspectFile();
      return {
        configured: exists,
        envSet,
        fileExists: exists,
        cookieCount: diagnostic?.cookieCount ?? 0,
        domains: diagnostic?.domains ?? [],
        maxExpiry: diagnostic?.maxExpiry ?? null,
        updatedAt,
        valid: exists && (diagnostic?.cookieCount ?? 0) > 0,
      };
    },
    save(content) {
      const v = validateYtCookiesContent(content);
      if (!v.ok) return { ok: false, error: v.error!, status: 400 };

      // Écriture atomique 0600 du fichier de cookies.
      fs.mkdirSync(path.dirname(cookiesFile), { recursive: true });
      const tmp = `${cookiesFile}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, content, "utf-8");
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, cookiesFile);

      // Chemin automatiquement configuré dans le .env (s'il n'y est pas déjà).
      let env = readEnv();
      const parsed = parseEnvFile(env);
      const restartRequired = parsed.NEBULA_YTDLP_COOKIES !== cookiesFile;
      if (restartRequired) {
        env = upsertEnvKey(env, "NEBULA_YTDLP_COOKIES", cookiesFile);
        writeEnv(env);
      }
      return { ok: true, restartRequired, diagnostic: v.diagnostic! };
    },
    remove() {
      try {
        fs.unlinkSync(cookiesFile);
      } catch {}
      // Retire aussi la variable d'env — retour au mode anonyme propre.
      let env = readEnv();
      if (parseEnvFile(env).NEBULA_YTDLP_COOKIES) {
        env = upsertEnvKey(env, "NEBULA_YTDLP_COOKIES", null);
        writeEnv(env);
      }
      return { ok: true, restartRequired: true };
    },
  };
}

export function registerYtCookiesRoutes(
  app: Express,
  options: { handler?: YtCookiesHandler; limiter?: any } = {}
): void {
  const handler = options.handler || createYtCookiesHandler();

  app.get("/api/system/yt-cookies", (_req, res) => {
    res.json(handler.status()); // métadonnées uniquement — JAMAIS le contenu
  });

  const post = (req: any, res: any) => {
    const content = String(req.body?.content ?? "");
    const result = handler.save(content);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      restartRequired: result.restartRequired,
      ...result.diagnostic,
    });
  };

  const del = (_req: any, res: any) => {
    res.json(handler.remove());
  };

  if (options.limiter) {
    app.post("/api/system/yt-cookies", options.limiter, post);
    app.delete("/api/system/yt-cookies", options.limiter, del);
  } else {
    app.post("/api/system/yt-cookies", post);
    app.delete("/api/system/yt-cookies", del);
  }
}
