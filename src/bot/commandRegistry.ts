import { BotCommand } from "./types.js";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import pingCommand from "./commands/ping.js";
import menuCommand from "./commands/menu.js";
import aiCommand from "./commands/ai.js";
import imageCommand from "./commands/image.js";
import jokeCommand from "./commands/joke.js";
import quoteCommand from "./commands/quote.js";
import ownerCommand from "./commands/owner.js";
import dareCommand from "./commands/dare.js";
import truthCommand from "./commands/truth.js";
import waifuCommand from "./commands/waifu.js";
import roastCommand from "./commands/roast.js";
import rpsCommand from "./commands/rps.js";
import triviaCommand from "./commands/trivia.js";
import weatherCommand from "./commands/weather.js";
import calcCommand from "./commands/calc.js";
import defineCommand from "./commands/define.js";
import downloadCommand from "./commands/download.js";
import translateCommand from "./commands/translate.js";
import hidetagCommand from "./commands/hidetag.js";
import antilinkCommand from "./commands/antilink.js";
import antitagCommand from "./commands/antitag.js";
import antibotCommand from "./commands/antibot.js";
import membersCommand from "./commands/members.js";
import kickCommand from "./commands/kick.js";
import promoteCommand from "./commands/promote.js";
import demoteCommand from "./commands/demote.js";
import helpCommand from "./commands/help.js";
import swebCommand from "./commands/sweb.js";
import videoCommand from "./commands/video.js";
import renewYouTubeCommand from "./commands/renewYouTube.js";
import watchCommand from "./commands/watch.js";
import animeCommand from "./commands/novabox.js";
import accessCommand from "./commands/access.js";
import { getCompiledPath } from "./commandCompiler.js";
import { loadImportedCommands } from "./importedBridge.js";

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
const BUILTIN_SOURCE_FILE_EXCEPTIONS = new Set(["novabox"]);

/** Commands loaded from disk (name -> module), kept in memory between reloads. */
const diskCommandCache = new Map<string, BotCommand>();

// Built-in commands are statically imported so they always work, including in
// the production bundle where dynamic .ts loading is unavailable.
const defaultCommands = [
  pingCommand,
  menuCommand,
  helpCommand,
  aiCommand,
  imageCommand,
  jokeCommand,
  quoteCommand,
  ownerCommand,
  dareCommand,
  truthCommand,
  waifuCommand,
  roastCommand,
  rpsCommand,
  triviaCommand,
  weatherCommand,
  calcCommand,
  defineCommand,
  downloadCommand,
  translateCommand,
  hidetagCommand,
  antilinkCommand,
  antitagCommand,
  antibotCommand,
  membersCommand,
  kickCommand,
  promoteCommand,
  demoteCommand,
  swebCommand,
  videoCommand,
  renewYouTubeCommand,
  watchCommand,
  animeCommand,
  accessCommand,
];

function register(cmd: BotCommand) {
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
async function loadCommandModule(name: string): Promise<BotCommand | null> {
  if (diskCommandCache.has(name)) {
    return diskCommandCache.get(name)!;
  }

  const tsPath = path.join(getCommandsDir(), `${name}.ts`);
  const compiledPath = getCompiledPath(name);
  const busted = (p: string) => `${pathToFileURL(p).href}?t=${Date.now()}`;

  // 1. Source .ts — works in dev (tsx) and under the test runner;
  //    production Node cannot parse TS so it falls through to the artifact.
  if (process.env.NODE_ENV !== "production" && fs.existsSync(tsPath)) {
    try {
      const mod = await import(busted(tsPath));
      const cmd = mod.default || mod;
      if (cmd && cmd.name) return cmd;
    } catch (e: any) {
      console.warn(`[Registry] Failed to load source command "${name}":`, e?.message || e);
    }
  }

  // 2. Compiled self-contained artifact — works everywhere.
  if (fs.existsSync(compiledPath)) {
    try {
      const mod = await import(busted(compiledPath));
      const cmd = mod.default || mod;
      if (cmd && cmd.name) return cmd;
    } catch (e: any) {
      console.warn(`[Registry] Failed to load compiled command "${name}":`, e?.message || e);
    }
  }

  return null;
}

/**
 * (Re)builds the registry: static built-ins first, then every command file
 * found on disk that does not collide with a built-in name.
 */
export async function initRegistry(): Promise<void> {
  commandsMap.clear();

  // 1. Register imported and bridged commands first
  try {
    const importedCmds = loadImportedCommands();
    importedCmds.forEach(register);
  } catch (err: any) {
    console.error("[Registry] Failed to load bridged commands:", err.message);
  }

  // 2. Register static built-in commands next so they take precedence over imported ones
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
    const cmd = await loadCommandModule(name);
    // L3: a disk file whose exported name is already registered (e.g.
    // novabox.ts exporting "anime", a static built-in) is a duplicate —
    // skip it instead of loading it twice.
    if (cmd && cmd.name && !commandsMap.has(cmd.name.toLowerCase())) {
      register(cmd);
      console.log(`🔮 [Registry] Loaded command from disk: ${cmd.name}`);
    } else if (cmd && cmd.name) {
      console.log(`[Registry] Skipped duplicate disk command: ${cmd.name}`);
    } else {
      console.warn(`[Registry] Skipped unloadable command file: ${file}`);
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
  console.log(`[Registry] Ready: ${uniqueCommands().length} commands registered.`);
}

export function getCommands(): BotCommand[] {
  return uniqueCommands();
}

export function getCommand(name: string): BotCommand | undefined {
  return commandsMap.get(name.toLowerCase());
}

export function registerCommand(cmd: BotCommand) {
  register(cmd);
  updateGlobalCommands();
}

export function removeCommand(name: string) {
  commandsMap.delete(name.toLowerCase());
  updateGlobalCommands();
}

/** Caches a freshly saved command module so the next initRegistry() picks it up. */
export function cacheDiskCommand(name: string, cmd: BotCommand) {
  diskCommandCache.set(name.toLowerCase(), cmd);
}

export function clearDiskCommandCache() {
  diskCommandCache.clear();
}
