import fs from "fs";
import path from "path";

/**
 * Multi-bots (8.75) — configuration des « slots » bots.
 *
 * Décisions owner (2026-09-23) : option B = multi-processus dans UN seul
 * déploiement ; 3 bots au total ; identités personnalisables par session
 * (nom + persona) ; pairing d'abord (8.74), multi ensuite (ce module).
 *
 * Un « slot » = un process moteur enfant (engine.cjs) avec :
 *   - son dossier d'auth Baileys (authDir)  → NEBULA_AUTH_DIR
 *   - son dossier de données (dataDir)      → NEBULA_DATA_DIR (config.json,
 *     groupes, stats, quota IA, mémoire IA, commandes panneau…)
 *   - son port moteur local (enginePort, 127.0.0.1 uniquement)
 *   - sa persona IA optionnelle             → NEBULA_AI_PERSONALITY
 *
 * Compatibilité prod : SANS bots.json, la config par défaut définit UN seul
 * bot « nebula » pointant vers les chemins historiques (nebula_auth_info/
 * et database/) — le déploiement existant démarre à l'identique, et les bots
 * supplémentaires sont ajoutés progressivement en écrivant bots.json.
 */

export interface BotSlot {
  /** Identifiant CLI/API (slug). Le bot par défaut s'appelle « nebula ». */
  id: string;
  /** Libellé affiché dans le panneau / la CLI (identité de supervision). */
  name: string;
  /** Un slot désactivé n'est pas lancé au démarrage (config conservée). */
  enabled: boolean;
  /** Dossier d'authentification Baileys (relatif au répertoire app ou absolu). */
  authDir: string;
  /** Dossier de données (relatif au répertoire app ou absolu). */
  dataDir: string;
  /** Port HTTP local du moteur enfant — 127.0.0.1 uniquement. */
  enginePort: number;
  /** Plafond heap Node de l'enfant (--max-old-space-size, Mo). */
  maxOldSpaceMb: number;
  /** Remplace la persona IA de base (vide = persona par défaut du projet). */
  persona: string;
  /** Reconnexion automatique au démarrage si une session appairée existe. */
  autoStart: boolean;
}

export interface BotsConfig {
  bots: BotSlot[];
  /** D'où vient la config : fichier bots.json ou défaut mono-bot. */
  source: "default" | "file";
  /** Chemin du fichier lu (source "file"). */
  file?: string;
  /**
   * Erreur de validation fatale : aucun bot n'est lancé tant qu'elle n'est pas
   * corrigée (deux slots partageant un dossier d'auth corromprait les sessions).
   */
  error?: string;
}

export const DEFAULT_BOT_ID = "nebula";

/** Chemins historiques du déploiement mono-bot — jamais à modifier. */
const LEGACY_AUTH_DIR = "nebula_auth_info";
const LEGACY_DATA_DIR = "database";

const MAX_BOTS = 8;
const MIN_ENGINE_PORT = 1024;
const MAX_ENGINE_PORT = 65535;
const MIN_MEMORY_MB = 64;
const MAX_MEMORY_MB = 1024;
const MAX_PERSONA_LENGTH = 4000;

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export function defaultSingleBot(): BotSlot {
  return {
    id: DEFAULT_BOT_ID,
    name: "Nebula",
    enabled: true,
    authDir: LEGACY_AUTH_DIR,
    dataDir: LEGACY_DATA_DIR,
    enginePort: 4001,
    maxOldSpaceMb: 192,
    persona: "",
    autoStart: true,
  };
}

export function getBotsFile(): string {
  return process.env.NEBULA_BOTS_FILE || path.join(process.cwd(), "bots.json");
}

/** Résout un dossier relatif contre le répertoire de l'application. */
export function resolveAppDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide et normalise le contenu brut de bots.json. Pure (aucun accès disque)
 * pour rester testable. Retourne soit une config valide, soit une config
 * d'erreur — ne lance jamais.
 */
export function parseBotsConfig(raw: string): BotsConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return { bots: [], source: "file", error: `bots.json illisible (JSON invalide) : ${e?.message || e}` };
  }
  if (!isPlainObject(parsed) || !Array.isArray((parsed as any).bots)) {
    return { bots: [], source: "file", error: "bots.json doit contenir un objet { \"bots\": [ ... ] }" };
  }
  const entries = (parsed as any).bots as unknown[];
  if (entries.length === 0) {
    return { bots: [], source: "file", error: "bots.json : la liste \"bots\" est vide (supprime le fichier pour le bot par défaut)" };
  }
  if (entries.length > MAX_BOTS) {
    return { bots: [], source: "file", error: `bots.json : ${entries.length} bots déclarés, maximum ${MAX_BOTS}` };
  }

  const bots: BotSlot[] = [];
  const seenIds = new Set<string>();
  const seenPorts = new Set<number>();
  const seenAuthDirs = new Set<string>();
  const seenDataDirs = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const label = `bots[${i}]`;
    if (!isPlainObject(entry)) {
      return { bots: [], source: "file", error: `${label} : chaque bot doit être un objet` };
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!SLUG_RE.test(id)) {
      return {
        bots: [],
        source: "file",
        error: `${label} : "id" invalide (« ${id || "(vide)"} ») — slug minuscule de 1 à 24 caractères (a-z, 0-9, - et _)`,
      };
    }
    if (seenIds.has(id)) {
      return { bots: [], source: "file", error: `bots.json : identifiant « ${id} » dupliqué` };
    }
    seenIds.add(id);

    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 40) : id;

    // Le bot par défaut garde les chemins historiques ; les autres reçoivent
    // un préfixe dédié (bots/<id>/…) sauf indication explicite.
    const isDefault = id === DEFAULT_BOT_ID;
    const defaultAuthDir = isDefault ? LEGACY_AUTH_DIR : path.join("bots", id, "auth");
    const defaultDataDir = isDefault ? LEGACY_DATA_DIR : path.join("bots", id, "data");

    const authDir = typeof entry.authDir === "string" && entry.authDir.trim() ? entry.authDir.trim() : defaultAuthDir;
    const dataDir = typeof entry.dataDir === "string" && entry.dataDir.trim() ? entry.dataDir.trim() : defaultDataDir;

    const resolvedAuth = resolveAppDir(authDir);
    const resolvedData = resolveAppDir(dataDir);
    if (seenAuthDirs.has(resolvedAuth)) {
      return { bots: [], source: "file", error: `bots.json : « ${id} » partage son dossier d'auth avec un autre bot (${authDir})` };
    }
    if (seenDataDirs.has(resolvedData)) {
      return { bots: [], source: "file", error: `bots.json : « ${id} » partage son dossier de données avec un autre bot (${dataDir})` };
    }
    seenAuthDirs.add(resolvedAuth);
    seenDataDirs.add(resolvedData);

    const enginePort = entry.enginePort === undefined ? 4001 + i : Number(entry.enginePort);
    if (!Number.isInteger(enginePort) || enginePort < MIN_ENGINE_PORT || enginePort > MAX_ENGINE_PORT) {
      return {
        bots: [],
        source: "file",
        error: `${label} (« ${id} ») : "enginePort" doit être un entier entre ${MIN_ENGINE_PORT} et ${MAX_ENGINE_PORT}`,
      };
    }
    if (seenPorts.has(enginePort)) {
      return { bots: [], source: "file", error: `bots.json : port moteur ${enginePort} utilisé par plusieurs bots` };
    }
    seenPorts.add(enginePort);

    const maxOldSpaceMb = entry.maxOldSpaceMb === undefined ? 192 : Number(entry.maxOldSpaceMb);
    if (!Number.isInteger(maxOldSpaceMb) || maxOldSpaceMb < MIN_MEMORY_MB || maxOldSpaceMb > MAX_MEMORY_MB) {
      return {
        bots: [],
        source: "file",
        error: `${label} (« ${id} ») : "maxOldSpaceMb" doit être un entier entre ${MIN_MEMORY_MB} et ${MAX_MEMORY_MB}`,
      };
    }

    const persona = typeof entry.persona === "string" ? entry.persona.slice(0, MAX_PERSONA_LENGTH) : "";

    bots.push({
      id,
      name,
      enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
      authDir: resolvedAuth,
      dataDir: resolvedData,
      enginePort,
      maxOldSpaceMb,
      persona,
      autoStart: entry.autoStart === undefined ? true : Boolean(entry.autoStart),
    });
  }

  return { bots, source: "file" };
}

/**
 * Charge la configuration multi-bots. Sans bots.json (ou illisible) : bot par
 * défaut unique. En cas d'erreur de VALIDATION : config d'erreur — le
 * superviseur refusera de lancer quoi que ce soit (échec sûr).
 */
/**
 * Une session Baileys « appairée » existe-t-elle dans ce dossier d'auth ?
 * (creds.json avec registered/me) — utilisé par engine.ts pour la reconnexion
 * automatique au démarrage, et par les tests.
 */
export function hasRegisteredCreds(authDir: string): boolean {
  try {
    const credsFile = path.join(authDir, "creds.json");
    if (!fs.existsSync(credsFile)) return false;
    const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
    return Boolean(creds?.registered || creds?.me?.id);
  } catch {
    return false;
  }
}

export function loadBotsConfig(): BotsConfig {
  const file = getBotsFile();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { bots: [defaultSingleBot()], source: "default" };
  }
  const config = parseBotsConfig(raw);
  return { ...config, file };
}
