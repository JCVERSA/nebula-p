import vm from "vm";
import { transformSync } from "esbuild";

/**
 * Capability-limited runner for panel-authored commands (C4).
 *
 * Panel commands used to be written to src/bot/commands/*.ts, compiled and
 * dynamically `import()`ed — i.e. arbitrary Node code executed with the full
 * privileges of the server process. Anything the panel could save became RCE.
 *
 * New model:
 *  - saved sources are stored as *data* (database/panel_commands.json)
 *  - they are NOT written into source trees and never built into a module
 *  - at execution time the source is esbuild-transformed to CJS and run in a
 *    `vm` context that has NO require/process/fs/network; only the documented
 *    Baileys command API is reachable through the call arguments
 *  - static analysis rejects dangerous imports and constructs before run
 *
 * Honest limitation: a same-process `vm` context that the host calls with
 * callbacks is not a cryptographic boundary (constructor-chain escape is
 * theoretically possible when host function objects are reachable). This is
 * why panel-command creation additionally requires panel auth + CSRF checks
 * and is intended for the trusted panel operator. Set
 * NEBULA_PANEL_COMMANDS=off to disable the feature entirely.
 */

export const PANEL_COMMANDS_ENABLED = String(process.env.NEBULA_PANEL_COMMANDS || "on") !== "off";

const MAX_SOURCE_BYTES = 50_000;

/** Specifiers that may remain as `require()` calls after transform. */
const ALLOWED_SPECIFIERS = new Set([
  "../types.js",
  "../types",
  "./types.js",
  "./types",
  "nebula:command",
  "nebula:types",
]);

/** Word-boundary checks on comment-stripped source (fail-closed on matches). */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bprocess\b/, label: "process" },
  { re: /\brequire\s*\(/, label: "require()" },
  { re: /\bimport\s*\(/, label: "dynamic import()" },
  { re: /\bchild_process\b/, label: "child_process" },
  { re: /\bworker_threads\b/, label: "worker_threads" },
  { re: /\bnode:fs\b/, label: "node:fs" },
  { re: /\bnode:path\b/, label: "node:path" },
  { re: /\bnode:os\b/, label: "node:os" },
  { re: /\bnode:net\b/, label: "node:net" },
  { re: /\bnode:http\b/, label: "node:http" },
  { re: /\bnode:https\b/, label: "node:https" },
  { re: /\bnode:dns\b/, label: "node:dns" },
  { re: /\bnode:vm\b/, label: "node:vm" },
  { re: /\bnode:crypto\b/, label: "node:crypto" },
  { re: /\bnode:buffer\b/, label: "node:buffer" },
  { re: /\bnode:zlib\b/, label: "node:zlib" },
  { re: /\bnode:stream\b/, label: "node:stream" },
  { re: /\bnode:events\b/, label: "node:events" },
  { re: /\bglobalThis\b/, label: "globalThis" },
  { re: /\bglobal\b/, label: "global" },
  { re: /\bBuffer\b/, label: "Buffer" },
  { re: /\bDeno\b/, label: "Deno" },
  { re: /\b__dirname\b/, label: "__dirname" },
  { re: /\b__filename\b/, label: "__filename" },
  { re: /\beval\s*\(/, label: "eval()" },
  { re: /\bnew\s+Function\b/, label: "new Function" },
  { re: /\bFunction\s*\(/, label: "Function()" },
  { re: /\bfetch\s*\(/, label: "fetch()" },
  { re: /\baxios\b/, label: "axios" },
  { re: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, label: "WebSocket" },
  { re: /\bchild_process\b|\bexec\s*\(|\bspawn\s*\(|\bfork\s*\(/, label: "process execution" },
  { re: /\bunlink\b|\brmdir\b|\bchmod\b|\bwriteFile|\breadFile|\bcreateServer\b/, label: "filesystem/server API" },
  { re: /\bReflect\b/, label: "Reflect" },
  { re: /\bProxy\b/, label: "Proxy" },
];

function stripComments(source: string): string {
  // Minimal stripper — being over-eager here only makes the sandbox stricter.
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1")
  );
}

function analyzeSpecifiers(source: string): string | null {
  // import { x } from "..." / import x from '...' / require("...") / require('...')
  const specifierRe = /(?:from\s*|require\s*\()\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = specifierRe.exec(source)) !== null) {
    const spec = m[1].replace(/^node:/, "");
    if (!ALLOWED_SPECIFIERS.has(spec) && !ALLOWED_SPECIFIERS.has(`../${spec}`)) {
      return `Importing "${spec}" is not allowed. Panel commands may only use the built-in command API.`;
    }
  }
  return null;
}

export interface SourceAnalysis {
  ok: boolean;
  error?: string;
}

/**
 * Static review of panel-command source. Fail-closed: any suspicious token
 * rejects the source with a readable reason.
 */
export function analyzePanelCommandSource(source: string): SourceAnalysis {
  if (!PANEL_COMMANDS_ENABLED) {
    return { ok: false, error: "Panel-created commands are disabled on this server." };
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    return { ok: false, error: "Command source is empty." };
  }
  if (source.length > MAX_SOURCE_BYTES) {
    return { ok: false, error: `Command source is too large (max ${MAX_SOURCE_BYTES} characters).` };
  }
  if (source.includes("#!")) {
    return { ok: false, error: "Shebang lines are not allowed." };
  }

  const specError = analyzeSpecifiers(source);
  if (specError) return { ok: false, error: specError };

  const cleaned = stripComments(source);
  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(cleaned)) {
      return { ok: false, error: `Forbidden construct detected: "${label}". Panel commands run sandboxed and cannot access the server, filesystem or network.` };
    }
  }
  return { ok: true };
}

export interface CompiledPanelCommand {
  code: string;
}

/**
 * Transforms TS → CJS. Imports are NOT resolved: the only specifiers that
 * survive are the ones allowed by analyzePanelCommandSource, and the sandbox
 * `require` maps them to a stub module.
 */
export function compilePanelCommandSource(source: string, name: string): CompiledPanelCommand {
  const result = transformSync(source, {
    loader: "ts",
    format: "cjs",
    target: "node18",
    sourcefile: `panel-${name}.ts`,
    logLevel: "silent",
  });
  return { code: result.code };
}

/** Sandbox require: only the (type-only) module API stub exists. */
function makeSandboxRequire() {
  const apiModule = { exports: {} };
  const fn = (specifier: string) => {
    const norm = specifier.replace(/^\.\.?\//, "").replace(/\.js$/, "");
    if (ALLOWED_SPECIFIERS.has(specifier) || ["types", "nebula:command", "nebula:types"].includes(norm)) {
      return apiModule.exports;
    }
    throw new Error(`Panel commands cannot import "${specifier}".`);
  };
  return fn;
}

export interface PanelCommandModule {
  name: string;
  category: string;
  description: string;
  usage?: string;
  aliases?: string[];
  execute: (sock: any, msg: any, context: any) => Promise<void> | void;
}

/**
 * Executes transformed panel-command CJS in a locked-down VM context.
 * `name` is only used for diagnostics/filenames (never for filesystem access).
 */
export function executePanelCommandCode(
  compiled: CompiledPanelCommand,
  name: string
): PanelCommandModule {
  const sandbox: Record<string, any> = {
    module: { exports: {} },
    exports: {},
    require: makeSandboxRequire(),
    console: {
      log: (...args: any[]) => console.log(`[Panel:${name}]`, ...args),
      info: (...args: any[]) => console.info(`[Panel:${name}]`, ...args),
      warn: (...args: any[]) => console.warn(`[Panel:${name}]`, ...args),
      error: (...args: any[]) => console.error(`[Panel:${name}]`, ...args),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };
  const context = vm.createContext(sandbox, { name: `panel:${name}` });
  // Synchronous timeout prevents infinite loops; async work is bounded by the
  // caller's wall-clock race.
  vm.runInContext(compiled.code, context, { timeout: 3000, filename: `panel-${name}.cjs` });
  const mod = sandbox.module.exports;
  const command = mod?.default || mod;
  if (!command || typeof command.execute !== "function") {
    throw new Error("Panel command must export a default object with an execute() function.");
  }
  return command as PanelCommandModule;
}
