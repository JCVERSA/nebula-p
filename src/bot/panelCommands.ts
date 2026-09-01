import fs from "fs";
import path from "path";
import { registerCommand, getCommand, getCommandsDir } from "./commandRegistry.js";
import { recordAudit } from "./auditTrail.js";
import {
  analyzePanelCommandSource,
  compilePanelCommandSource,
  executePanelCommandCode,
  PANEL_COMMANDS_ENABLED,
} from "./panelCommandSandbox.js";

/**
 * Panel-command store + safe registration (C4).
 *
 * Saved commands are data (JSON in the data dir), never source files on disk,
 * and are executed through the capability-limited runner
 * (panelCommandSandbox.ts) instead of dynamic `import()`.
 */

export interface PanelCommandDefinition {
  name: string; // validated: [a-z0-9]+
  category: string;
  description: string;
  usage?: string;
  aliases: string[];
  source: string;
  createdAt?: number;
  updatedAt?: number;
}

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getStoreFile(): string {
  return path.join(getDataDir(), "panel_commands.json");
}

let store: PanelCommandDefinition[] = [];
try {
  if (fs.existsSync(getStoreFile())) {
    const raw = JSON.parse(fs.readFileSync(getStoreFile(), "utf-8"));
    if (Array.isArray(raw)) {
      store = raw
        .filter((r) => r && typeof r.name === "string" && typeof r.source === "string")
        .map((r) => ({
          name: r.name,
          category: String(r.category || "Utility").slice(0, 40),
          description: String(r.description || "").slice(0, 200),
          usage: typeof r.usage === "string" ? r.usage.slice(0, 120) : undefined,
          aliases: Array.isArray(r.aliases) ? r.aliases.map((a: any) => String(a).slice(0, 32)) : [],
          source: r.source,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
    }
  }
} catch (e: any) {
  console.warn("[PanelCommands] Failed to load panel command store:", e?.message || e);
}

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    const tmp = `${getStoreFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, getStoreFile());
  } catch (e: any) {
    console.warn("[PanelCommands] Failed to persist store:", e?.message || e);
  }
}
function schedulePersist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 200);
}

/** Try to delete any legacy disk artifact the old (C4) flow could have left. */
function purgeLegacyArtifacts(name: string) {
  try {
    const tsPath = path.join(getCommandsDir(), `${name}.ts`);
    if (fs.existsSync(tsPath)) fs.unlinkSync(tsPath);
    const compiledDir = path.join(getCommandsDir(), ".compiled");
    const mjsPath = path.join(compiledDir, `${name}.mjs`);
    if (fs.existsSync(mjsPath)) fs.unlinkSync(mjsPath);
  } catch (e: any) {
    console.warn(`[PanelCommands] Could not purge legacy artifact for "${name}":`, e?.message || e);
  }
}

// In-memory compiled cache so we do not re-transform on every invocation.
const compiledCache = new Map<string, { source: string; compiled: { code: string } }>();

function makeExecute(def: PanelCommandDefinition) {
  return async (sock: any, msg: any, context: any) => {
    if (!PANEL_COMMANDS_ENABLED) {
      await context.reply("⚠️ Panel-created commands are disabled on this server.");
      return;
    }
    let compiled = compiledCache.get(def.name);
    if (!compiled || compiled.source !== def.source) {
      const analysis = analyzePanelCommandSource(def.source);
      if (!analysis.ok) {
        await context.reply(`⚠️ Panel command was rejected by safety analysis: ${analysis.error}`);
        return;
      }
      compiled = { source: def.source, compiled: compilePanelCommandSource(def.source, def.name) };
      compiledCache.set(def.name, compiled);
    }
    const module = executePanelCommandCode(compiled.compiled, def.name);
    // Wall-clock bound for runaway async loops (sync is bounded in the VM).
    await Promise.race([
      Promise.resolve(module.execute(sock, msg, context)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Panel command timed out (30s).")), 30_000)),
    ]);
  };
}

export function registerPanelCommands(): void {
  if (!PANEL_COMMANDS_ENABLED) return;
  for (const def of store) {
    // A pre-upgrade install may have left compiled/executable artifacts for
    // this panel command in the source tree; delete them so disk-based
    // dynamic import can never execute panel code at full privileges.
    purgeLegacyArtifacts(def.name);
    const wrapped = {
      name: def.name,
      category: def.category || "Utility",
      description: def.description || "Panel-created command",
      usage: def.usage || `.${def.name}`,
      aliases: def.aliases || [],
      execute: makeExecute(def),
    };
    registerCommand(wrapped as any);
  }
}

export interface SavePanelCommandResult {
  ok: boolean;
  loaded: boolean;
  error?: string;
  message: string;
}

export function savePanelCommand(def: PanelCommandDefinition): SavePanelCommandResult {
  if (!/^[a-z0-9]+$/.test(def.name)) {
    return { ok: false, loaded: false, error: "Invalid command name: use letters and digits only.", message: "Invalid command name." };
  }
  const existing = getCommand(def.name);

  const analysis = analyzePanelCommandSource(def.source);
  if (!analysis.ok) {
    return { ok: false, loaded: false, error: analysis.error, message: analysis.error || "Source rejected." };
  }

  // Compile once now so a syntax error surfaces at save time, not at runtime.
  let compiled;
  try {
    compiled = compilePanelCommandSource(def.source, def.name);
  } catch (e: any) {
    return {
      ok: false,
      loaded: false,
      error: `Command source does not compile: ${e?.message || e}`,
      message: `Command source does not compile: ${e?.message || e}`,
    };
  }

  const now = Date.now();
  const idx = store.findIndex((r) => r.name === def.name);
  const record: PanelCommandDefinition = {
    name: def.name,
    category: def.category.slice(0, 40),
    description: def.description.slice(0, 200),
    usage: def.usage?.slice(0, 120),
    aliases: def.aliases.slice(0, 20),
    source: def.source,
    createdAt: idx >= 0 ? store[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) store[idx] = record;
  else store.push(record);

  // The old flow could have dropped executable artifacts in the source tree;
  // remove them so initRegistry can never load panel code as a real module.
  purgeLegacyArtifacts(def.name);
  compiledCache.set(def.name, { source: record.source, compiled });
  registerCommand(makeRegistered(record));
  recordAudit("panel", "panel_command.save", def.name, `category=${record.category} source=${record.source.length} chars`);
  schedulePersist();
  return {
    ok: true,
    loaded: true,
    message: existing
      ? `Command "${def.name}" updated and loaded (sandboxed).`
      : `Command "${def.name}" saved and loaded (sandboxed).`,
  };
}

function makeRegistered(record: PanelCommandDefinition) {
  return {
    name: record.name,
    category: record.category || "Utility",
    description: record.description || "Panel-created command",
    usage: record.usage || `.${record.name}`,
    aliases: record.aliases || [],
    execute: makeExecute(record),
  };
}

export function deletePanelCommand(name: string): boolean {
  const idx = store.findIndex((r) => r.name === name);
  if (idx < 0) return false;
  store.splice(idx, 1);
  compiledCache.delete(name);
  purgeLegacyArtifacts(name);
  schedulePersist();
  return true;
}

/** Backup/restore support: validate + replace all panel commands (bounded). */
export function replaceAllPanelCommands(defs: Array<Partial<PanelCommandDefinition>>): { count: number; errors: string[] } {
  const errors: string[] = [];
  const next: PanelCommandDefinition[] = [];
  const seen = new Set<string>();
  for (const d of (defs || []).slice(0, 100)) {
    if (!d || typeof d.name !== "string" || !/^[a-z0-9]+$/.test(d.name) || seen.has(d.name)) {
      if (d?.name) errors.push(`Invalid/duplicate name "${String(d.name)}"`);
      continue;
    }
    if (typeof d.source !== "string" || d.source.length > 50_000) {
      errors.push(`Invalid source for "${d.name}"`);
      continue;
    }
    const analysis = analyzePanelCommandSource(d.source);
    if (!analysis.ok) {
      errors.push(`Rejected "${d.name}": ${analysis.error}`);
      continue;
    }
    try {
      compilePanelCommandSource(d.source, d.name);
    } catch (e: any) {
      errors.push(`Rejected "${d.name}": ${e?.message || "compile error"}`);
      continue;
    }
    seen.add(d.name);
    next.push({
      name: d.name,
      category: String(d.category || "Utility").slice(0, 40),
      description: String(d.description || "").slice(0, 200),
      usage: typeof d.usage === "string" ? d.usage.slice(0, 120) : `.${d.name}`,
      aliases: Array.isArray(d.aliases) ? d.aliases.map((a) => String(a).slice(0, 32)) : [],
      source: d.source,
      createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
      updatedAt: Date.now(),
    });
  }
  store = next;
  compiledCache.clear();
  for (const def of store) purgeLegacyArtifacts(def.name);
  // Re-register under the safe runner.
  store.forEach((def) => registerCommand(makeRegistered(def)));
  persist();
  return { count: store.length, errors };
}

export function getPanelCommandSource(name: string): string | undefined {
  return store.find((r) => r.name === name)?.source;
}

export function listPanelCommands(): Array<{ name: string; category: string; description: string }> {
  return store.map(({ name, category, description }) => ({ name, category, description }));
}

/** Backup support: full definitions (including source) for a lossless round-trip. */
export function exportAllPanelCommands(): PanelCommandDefinition[] {
  return store.map((d) => ({ ...d }));
}
