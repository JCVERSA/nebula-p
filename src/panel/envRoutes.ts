import fs from "fs";
import path from "path";
import type { Express } from "express";

/**
 * 9.3 — Éditeur .env du panneau (section Système).
 *
 * Décision owner : pouvoir régler certaines variables depuis le dashboard
 * (quotas, moteur IA, digest, veille) ET coller les clés API en écriture
 * seule (Tavily, Gemini, NIM, chemin cookies YouTube) — sans SSH.
 *
 * Sécurité :
 *  - LISTE BLANCHE STRICTE des clés éditables (spécifications ci-dessous) ;
 *  - validation par type AVANT écriture (entiers bornés, énumérés, pas de
 *    retours ligne/quotes — aucune injection possible dans le .env) ;
 *  - écriture atomique (tmp + rename) au format de manage.sh (KEY="valeur"),
 *    chmod 600 conservé ;
 *  - les secrets ne sont JAMAIS renvoyés en clair : masqués à l'affichage
 *    (écriture seule) ;
 *  - la plupart des variables sont lues au BOOT : la réponse indique
 *    restartRequired (le bouton Redémarrer de la section Système applique).
 *    Exceptions « à chaud » : quota web et TAVILY_API_KEY (lus à chaque
 *    utilisation).
 */

export type EnvEditType = "number" | "boolean" | "enum" | "string" | "path" | "secret";

export interface EnvKeySpec {
  key: string;
  label: string;
  description: string;
  type: EnvEditType;
  group: "quotas" | "digest" | "keys";
  default?: string;
  min?: number;
  max?: number;
  choices?: string[];
  /** Appliqué seulement après un redémarrage (défaut true). */
  hot?: boolean;
}

const MAX_VALUE_LEN = 500;

export const ENV_EDITABLE_SPECS: EnvKeySpec[] = [
  {
    key: "NEBULA_AI_DAILY_LIMIT", label: "Quota IA / jour / utilisateur",
    description: "Budget de requêtes IA par utilisateur et par jour (défaut 40).",
    type: "number", group: "quotas", default: "40", min: 1, max: 1000,
  },
  {
    key: "NEBULA_AI_MAX_CONCURRENT", label: "Requêtes IA simultanées",
    description: "Appels IA en parallèle maximum (défaut 3 — au-delà, risque de saturation).",
    type: "number", group: "quotas", default: "3", min: 1, max: 10,
  },
  {
    key: "NEBULA_WEB_DAILY_LIMIT", label: "Quota web / jour / utilisateur",
    description: "Recherches/lectures web (.search/.fetch/.wiki) par utilisateur et par jour (défaut 20).",
    type: "number", group: "quotas", default: "20", min: 0, max: 500,
    hot: true,
  },
  {
    key: "NEBULA_AI_PRIMARY", label: "Moteur IA primaire",
    description: "gemini (défaut) ou nim — les images vont toujours à Gemini.",
    type: "enum", group: "quotas", default: "gemini", choices: ["gemini", "nim"],
  },
  {
    key: "NEBULA_DIGEST", label: "Digest quotidien owner",
    description: "0 pour couper le digest quotidien en DM (défaut activé).",
    type: "boolean", group: "digest", default: "1",
  },
  {
    key: "NEBULA_DIGEST_HOUR", label: "Heure du digest",
    description: "Heure d'envoi du digest, 0-23 (défaut 8, fuseau de la veille).",
    type: "number", group: "digest", default: "8", min: 0, max: 23,
  },
  {
    key: "NEBULA_WATCH_TZ", label: "Fuseau horaire (veille + digest)",
    description: "Fuseau IANA, ex. Africa/Douala (défaut).",
    type: "string", group: "digest", default: "Africa/Douala",
  },
  {
    key: "GEMINI_API_KEY", label: "Clé Gemini",
    description: "Clé API Google Gemini (IA texte/image/transcription).",
    type: "secret", group: "keys",
  },
  {
    key: "NVIDIA_NIM_API_KEY", label: "Clé NVIDIA NIM",
    description: "Clé NIM (nvapi-…) — IA de secours (gratuite sur build.nvidia.com).",
    type: "secret", group: "keys",
  },
  {
    key: "TAVILY_API_KEY", label: "Clé Tavily",
    description: "Clé (tvly-…) qui améliore .search — gratuite sur app.tavily.com. Vide = DuckDuckGo.",
    type: "secret", group: "keys",
    hot: true,
  },
  {
    key: "NEBULA_YTDLP_COOKIES", label: "Fichier cookies YouTube",
    description: "Chemin du cookies.txt (format Netscape) pour débloquer .ytv/.ytm.",
    type: "path", group: "keys",
  },
];

const SPEC_BY_KEY = new Map(ENV_EDITABLE_SPECS.map((s) => [s.key, s]));

export function validateEnvValue(spec: EnvKeySpec, value: string): string | null {
  if (value.length > MAX_VALUE_LEN) return "Valeur trop longue (500 max).";
  if (/[\r\n\0]/.test(value)) return "Les retours ligne sont interdits.";
  if (/"/.test(value)) return "Les guillemets sont interdits.";
  switch (spec.type) {
    case "number": {
      if (!/^-?\d+$/.test(value)) return "Nombre entier attendu.";
      const n = Number(value);
      if (spec.min !== undefined && n < spec.min) return `Minimum ${spec.min}.`;
      if (spec.max !== undefined && n > spec.max) return `Maximum ${spec.max}.`;
      return null;
    }
    case "boolean":
      return value === "0" || value === "1" ? null : "0 ou 1 attendu.";
    case "enum":
      return spec.choices?.includes(value) ? null : `Valeurs possibles : ${(spec.choices || []).join(", ")}.`;
    case "secret":
      return /\s/.test(value) ? "Une clé ne contient pas d'espaces." : null;
    case "path":
      return /\s/.test(value) ? "Un chemin ne contient pas d'espaces." : null;
    default:
      return null;
  }
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export interface EnvEditorOptions {
  envFile?: string;
}

/** Parse naïf du .env (KEY="v" ou KEY=v) — suffisant pour l'affichage. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Réécrit le .env en remplaçant/supprimant UNE clé (atomique, format manage.sh). */
export function upsertEnvKey(content: string, key: string, value: string | null): string {
  const lines = content.split("\n").filter((l) => !new RegExp(`^\\s*${key}=`).test(l));
  if (value !== null) lines.push(`${key}="${value}"`);
  let out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

export interface EnvValueView {
  key: string;
  label: string;
  description: string;
  type: EnvEditType;
  group: EnvKeySpec["group"];
  choices?: string[];
  default?: string;
  set: boolean;
  value: string; // masquée pour les secrets
  restartRequired: boolean;
}

export interface EnvEditor {
  list(): EnvValueView[];
  set(key: string, value: string): { ok: true; restartRequired: boolean } | { ok: false; error: string; status: number };
}

export function createEnvEditor(opts: EnvEditorOptions = {}): EnvEditor {
  const envFile = opts.envFile || path.join(process.cwd(), ".env");

  function readRaw(): string {
    try {
      return fs.readFileSync(envFile, "utf-8");
    } catch {
      return "";
    }
  }

  function writeRaw(content: string): void {
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    const tmp = `${envFile}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, content, "utf-8");
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, envFile);
  }

  return {
    list(): EnvValueView[] {
      const parsed = parseEnvFile(readRaw());
      return ENV_EDITABLE_SPECS.map((spec) => {
        const raw = parsed[spec.key] ?? "";
        const isSecret = spec.type === "secret";
        return {
          key: spec.key,
          label: spec.label,
          description: spec.description,
          type: spec.type,
          group: spec.group,
          choices: spec.choices,
          default: spec.default,
          set: Boolean(raw),
          value: isSecret ? maskSecret(raw) : raw,
          restartRequired: !spec.hot,
        };
      });
    },
    set(key, value) {
      const spec = SPEC_BY_KEY.get(key);
      if (!spec) return { ok: false, error: "Variable non éditable depuis le panneau.", status: 400 };
      const trimmed = value.trim();
      if (!trimmed) {
        // Vide = supprimer (retour au défaut documenté) — même sémantique
        // que le menu `nebula env`.
        writeRaw(upsertEnvKey(readRaw(), key, null));
        return { ok: true, restartRequired: !spec.hot };
      }
      const err = validateEnvValue(spec, trimmed);
      if (err) return { ok: false, error: err, status: 400 };
      writeRaw(upsertEnvKey(readRaw(), key, trimmed));
      return { ok: true, restartRequired: !spec.hot };
    },
  };
}

export function registerEnvRoutes(app: Express, options: { editor?: EnvEditor; limiter?: any } = {}): void {
  const editor = options.editor || createEnvEditor();

  app.get("/api/system/env", (_req, res) => {
    res.json({ vars: editor.list() });
  });

  const post = (req: any, res: any) => {
    const key = String(req.body?.key || "");
    const value = String(req.body?.value ?? "");
    const result = editor.set(key, value);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true, restartRequired: result.restartRequired });
  };

  if (options.limiter) app.post("/api/system/env", options.limiter, post);
  else app.post("/api/system/env", post);
}
