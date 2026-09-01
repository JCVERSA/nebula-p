import fs from "fs";
import path from "path";
import { getCommandsDir } from "./commandRegistry.js";

/**
 * Compiles a command TypeScript file into a self-contained ESM artifact
 * (dependencies bundled, npm packages external) that plain Node can load.
 *
 * Dev servers load the original .ts through tsx; production loads the
 * compiled .mjs artifact so saved commands work without a TS runtime.
 */
export const COMPILED_DIR_NAME = ".compiled";

export function getCompiledDir(): string {
  return path.join(getCommandsDir(), COMPILED_DIR_NAME);
}

export function getCompiledPath(commandName: string): string {
  return path.join(getCompiledDir(), `${commandName}.mjs`);
}

/**
 * Compiles <name>.ts into <name>.mjs inside the .compiled directory.
 * Returns true on success, false when esbuild is unavailable or compilation fails.
 */
export async function compileCommandToMjs(name: string, tsPath: string): Promise<boolean> {
  try {
    const { build } = await import("esbuild");
    fs.mkdirSync(getCompiledDir(), { recursive: true });
    await build({
      entryPoints: [tsPath],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node18",
      packages: "external",
      outfile: getCompiledPath(name),
      logLevel: "silent",
    });
    return true;
  } catch (e: any) {
    console.warn(`[CommandCompiler] Failed to compile "${name}":`, e?.message || e);
    return false;
  }
}
