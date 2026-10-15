import { BotCommand } from "./types.js";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import pingCommand from "./commands/ping.js";
import tradCommand from "./commands/trad.js";
import resumeCommand from "./commands/resume.js";
import remindCommand from "./commands/remind.js";
import ttsCommand from "./commands/tts.js";
import ytvideoCommand from "./commands/ytvideo.js";
import songCommand from "./commands/song.js";
import ytlinkCommand from "./commands/ytlink.js";
import tiktokCommand from "./commands/tiktok.js";
import instagramCommand from "./commands/instagram.js";
import qrCommand from "./commands/qr.js";
import base64Command from "./commands/base64.js";
import getppCommand from "./commands/getpp.js";
import whoisCommand from "./commands/whois.js";
import purgeCommand from "./commands/purge.js";
import gceCommand from "./commands/gce.js";
import agentCommand from "./commands/agent.js";
import traceCommand from "./commands/trace.js";
import menuCommand from "./commands/menu.js";
import aiCommand from "./commands/ai.js";
import defineCommand from "./commands/define.js";
import searchCommand from "./commands/search.js";
import fetchCommand from "./commands/fetch.js";
import wikiCommand from "./commands/wiki.js";
import uploadCommand from "./commands/upload.js";
import helpCommand from "./commands/help.js";
import swebCommand from "./commands/sweb.js";
import watchCommand from "./commands/watch.js";
import animeCommand from "./commands/novabox.js";
import { getCompiledPath } from "./commandCompiler.js";

/**
 * Normalizes multi-level categories into a structured parent category
 * (e.g. 'Core', 'Media', 'Moderation', 'AI', 'Entertainment', 'Utility', 'Owner').
 */
export function getTopLevelCategory(category: string): string {
  if (!category || typeof category !== "string") return "Core";
  const trimmed = category.trim();

  // If formatted as "Parent / Sub" or "Parent/Sub"
  if (trimmed.includes("/")) {
    const parent = trimmed.split("/")[0].trim();
    if (parent) return parent;
  }

  const lower = trimmed.toLowerCase();

  if (["general", "core", "system", "info"].includes(lower)) return "Core";
  if (["admin", "moderation", "security", "safety", "group"].includes(lower)) return "Moderation";
  if (["media", "video", "image", "audio", "download", "textmaker"].includes(lower)) return "Media";
  if (["ai", "assistant", "creative"].includes(lower)) return "AI";
  if (["fun", "games", "anime", "entertainment", "social"].includes(lower)) return "Entertainment";
  if (["utility", "tools", "user", "calculator"].includes(lower)) return "Utility";
  if (["owner", "config", "settings"].includes(lower)) return "Owner";

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Directory where command source files live. Overridable via env for tests
 * and for deployments that keep commands in a different location.
 */
export function getCommandsDir(): string {
  return process.env.NEBULA_COMMANDS_DIR || path.join(process.cwd(), "src", "bot", "commands");
}

// Keep a map and list of registered commands
const commandsMap = new Map<string, BotCommand>();

/** Disk files that are the SOURCE of a statically-imported built-in command
 *  whose filename differs from its registered command name. */
const BUILTIN_SOURCE_FILE_EXCEPTIONS = new Set(["novabox", "watch"]);

/** Commands loaded from disk (name -> module), kept in memory between reloads. */
const diskCommandCache = new Map<string, BotCommand>();

// Built-in commands are statically imported so they always work, including in
// the production bundle where dynamic .ts loading is unavailable.
// 8.80 (audit harnais F1) : la liste est construite DANS une fonction, plus
// jamais au top-level du module. Le cycle registry -> commands/ai -> persona
// -> commandKnowledge -> registry rendait aiCommand indefini (TDZ) quand
// commands/ai.ts etait importe en premier ; differe au runtime, tous les
// ordres d'entree sont surs.
function getBuiltinCommands(): BotCommand[] {
  return [
    pingCommand,
    tradCommand,
    resumeCommand,
    remindCommand,
    ttsCommand,
    menuCommand,
    helpCommand,
    aiCommand,
    defineCommand,
    searchCommand,
    fetchCommand,
    wikiCommand,
    uploadCommand,
    swebCommand,
    watchCommand,
    animeCommand,
    ytvideoCommand,
    songCommand,
    ytlinkCommand,
    tiktokCommand,
    instagramCommand,
    qrCommand,
    base64Command,
    getppCommand,
    whoisCommand,
    traceCommand,
    purgeCommand,
    gceCommand,
    agentCommand,
  ];
}

function register(cmd: BotCommand) {
  const key = cmd.name.toLowerCase();
  // 8.80 (audit harnais F3) : ré-enregistrer une commande doit purger les
  // alias de la version PRÉCÉDENTE — sinon une mise à jour avec moins
  // d'alias laissait des entrées fantômes pointant sur l'ancien objet.
  const previous = commandsMap.get(key);
  if (previous?.aliases) {
    for (const alias of previous.aliases) {
      const aliasKey = alias.toLowerCase();
      if (aliasKey !== key && commandsMap.get(aliasKey) === previous) {
        commandsMap.delete(aliasKey);
      }
    }
  }
  const parentCategory = cmd.parentCategory || getTopLevelCategory(cmd.category);
  const normalizedCmd: BotCommand = {
    ...cmd,
    parentCategory,
  };

  commandsMap.set(normalizedCmd.name.toLowerCase(), normalizedCmd);
  if (normalizedCmd.aliases && Array.isArray(normalizedCmd.aliases)) {
    normalizedCmd.aliases.forEach((alias) => {
      commandsMap.set(alias.toLowerCase(), normalizedCmd);
    });
  }
}


function uniqueCommands(): BotCommand[] {
  const seen = new Set<string>();
  const out: BotCommand[] = [];
  for (const cmd of commandsMap.values()) {
    if (seen.has(cmd.name)) continue;
    seen.add(cmd.name);
    out.push(cmd);
  }
  return out;
}

function updateGlobalCommands() {
  // Set in global for access in commands like menu.ts (unique to avoid duplicate entries)
  (global as any).botCommands = uniqueCommands();
}

/**
 * Loads a single command module from disk.
 * Order: in-memory cache -> compiled .mjs artifact -> source .ts (dev/tsx only).
 */
async function loadCommandModule(name: string): Promise<{ cmd: BotCommand | null; error?: string }> {
  if (diskCommandCache.has(name)) {
    return { cmd: diskCommandCache.get(name)! };
  }

  const tsPath = path.join(getCommandsDir(), `${name}.ts`);
  const compiledPath = getCompiledPath(name);
  const busted = (p: string) => `${pathToFileURL(p).href}?t=${Date.now()}`;

  let lastError = "";
  // 1. Source .ts — works in dev (tsx) and under the test runner;
  //    production Node cannot parse TS so it falls through to the artifact.
  if (process.env.NODE_ENV !== "production" && fs.existsSync(tsPath)) {
    try {
      const mod = await import(busted(tsPath));
      const cmd = mod.default || mod;
      if (cmd && cmd.name) return { cmd };
    } catch (e: any) {
      lastError = String(e?.message || e);
      console.warn(`[Registry] Failed to load source command "${name}":`, lastError);
    }
  }

  // 2. Compiled self-contained artifact — works everywhere.
  if (fs.existsSync(compiledPath)) {
    try {
      const mod = await import(busted(compiledPath));
      const cmd = mod.default || mod;
      if (cmd && cmd.name) return { cmd };
    } catch (e: any) {
      lastError = String(e?.message || e);
      console.warn(`[Registry] Failed to load compiled command "${name}":`, lastError);
    }
  }

  return { cmd: null, error: lastError };
}

/**
 * (Re)builds the registry: static built-ins first, then every command file
 * found on disk that does not collide with a built-in name.
 */
/** True once initRegistry() has completed (call sites skip double boot init). */
export function isRegistryReady(): boolean {
  return registryInitialized;
}

let registryInitialized = false;

export async function initRegistry(): Promise<void> {
  commandsMap.clear();

  // Register the static built-ins (audit 8.56: the 145-file legacy corpus and
  // its CJS bridge were REMOVED — owner decision; native commands only).
  const defaultCommands = getBuiltinCommands();
  defaultCommands.forEach(register);

  const builtinNames = new Set(defaultCommands.map((cmd) => cmd.name.toLowerCase()));

  let files: string[] = [];
  try {
    files = fs.readdirSync(getCommandsDir()).filter((f) => f.endsWith(".ts"));
  } catch (e: any) {
    console.warn(`[Registry] Cannot scan commands directory:`, e?.message || e);
  }

  for (const file of files) {
    const name = file.replace(/\.ts$/, "").toLowerCase();
    if (builtinNames.has(name)) continue; // built-ins win to avoid duplicates
    // Some built-in commands live in a source file whose name differs from
    // the registered command name (novabox.ts exports the "anime" command).
    // Loading those from disk is redundant in dev (skipped as duplicate) and
    // impossible in production (plain Node cannot parse TS) — skip quietly.
    if (BUILTIN_SOURCE_FILE_EXCEPTIONS.has(name)) continue;
    const { cmd, error } = await loadCommandModule(name);
    // L3: a disk file whose exported name is already registered (e.g.
    // novabox.ts exporting "anime", a static built-in) is a duplicate —
    // skip it instead of loading it twice.
    if (cmd && cmd.name && !commandsMap.has(cmd.name.toLowerCase())) {
      register(cmd);
      console.log(`🔮 [Registry] Loaded command from disk: ${cmd.name}`);
    } else if (cmd && cmd.name) {
      console.log(`[Registry] Skipped duplicate disk command: ${cmd.name}`);
    } else {
      // 9.18hh (retour terrain 15/10 : tts.ts sauté SANS explication après
      // un sync sans npm install) — le message dit la cause et le remède.
      const missingDep = /Cannot find module\s+'?([^'\s]+)'?/i.exec(error || "")?.[1] || "";
      console.warn(
        `[Registry] ⚠️ Commande non chargée : ${file}` +
        (error ? `\n   Cause : ${error.slice(0, 200)}` : "") +
        (missingDep
          ? `\n   → Dépendance manquante (${missingDep}) — clique *Système → Mettre à jour* (npm install), PAS juste Redémarrer.`
          : `\n   → Vérifie le fichier (export default absent ?).`)
      );
    }
  }

  // Panel-authored commands (C4): data-driven, sandboxed, registered through
  // the safe runner — never loaded from disk as executable modules. Dynamic
  // import avoids a module cycle (panelCommands registers into this registry).
  try {
    const { registerPanelCommands } = await import("./panelCommands.js");
    registerPanelCommands();
  } catch (err: any) {
    console.warn("[Registry] Failed to register panel commands:", err?.message || err);
  }

  updateGlobalCommands();
  registryInitialized = true;
  console.log(`[Registry] Ready: ${uniqueCommands().length} commands registered.`);
}

export function getCommands(): BotCommand[] {
  return uniqueCommands();
}

/**
 * 9.11 (audit B1) : suggestion la plus proche d'une commande inconnue
 * (typo « .uv » → « .up »). Distance de Levenshtein ≤ 2 sur le nom
 * canonique ET les alias ; l'alias exact gagne toujours. Pur — testé.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function suggestClosestCommand(input: string): string | null {
  const q = (input || "").toLowerCase().trim();
  if (q.length < 2) return null;
  let commands: BotCommand[] = [];
  try {
    commands = getCommands();
  } catch {
    return null;
  }
  let best: string | null = null;
  let bestDist = 3; // > 2 = pas de suggestion
  for (const cmd of commands) {
    const candidates = [cmd.name, ...(cmd.aliases || [])];
    for (const cand of candidates) {
      const d = levenshtein(q, cand);
      if (d === 0) return cmd.name; // alias exact → canonique
      if (d < bestDist) {
        bestDist = d;
        best = cmd.name;
      }
    }
  }
  return best;
}

export function getCommand(name: string): BotCommand | undefined {
  return commandsMap.get(name.toLowerCase());
}

export function registerCommand(cmd: BotCommand) {
  register(cmd);
  updateGlobalCommands();
}

export function removeCommand(name: string) {
  const key = name.toLowerCase();
  const cmd = commandsMap.get(key);
  // 8.79: retirer une commande doit aussi retirer ses alias — sinon la
  // commande supprimée restait atteignable via `.alias` (trou trouvé par
  // les tests du harnais IA). On ne retire un alias que s'il pointe encore
  // sur CETTE commande (il a pu être ré-enregistré par une autre entre-temps).
  if (cmd?.aliases) {
    for (const alias of cmd.aliases) {
      const aliasKey = alias.toLowerCase();
      if (commandsMap.get(aliasKey) === cmd) commandsMap.delete(aliasKey);
    }
  }
  commandsMap.delete(key);
  updateGlobalCommands();
}

/** Caches a freshly saved command module so the next initRegistry() picks it up. */
export function cacheDiskCommand(name: string, cmd: BotCommand) {
  diskCommandCache.set(name.toLowerCase(), cmd);
}

export function clearDiskCommandCache() {
  diskCommandCache.clear();
}
