/**
 * Isolates every test file into its own temporary data + commands directory
 * and fixes the panel token, so tests never touch real runtime state and the
 * API is always exercised in authenticated mode.
 *
 * IMPORTANT: Vitest runs test files in parallel workers, and this setup file
 * is executed once per test file. A single shared temp dir was racy — every
 * worker wiped the directory another worker was actively writing into (the
 * CI run exposed this as `zipai.ts` ENOENT / `diskcmd` disappearing).
 * Each worker therefore gets its own unique subdirectory.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

/** Test directories live inside the repo root (gitignored via `.test-tmp/`). */
const tmpRoot = path.join(process.cwd(), ".test-tmp");

// Unique per worker process (worker threads/forks have distinct PIDs, and the
// random suffix guards against PID reuse between runs).
const runId = `run-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const tmpDir = path.join(tmpRoot, runId);

process.env.NEBULA_DATA_DIR = path.join(tmpDir, "data");
process.env.NEBULA_COMMANDS_DIR = path.join(tmpDir, "commands");
process.env.NEBULA_ENV_FILE = path.join(tmpDir, "data", ".env");
process.env.PANEL_TOKEN = "test-panel-token";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.NODE_ENV = "test";

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(process.env.NEBULA_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.NEBULA_COMMANDS_DIR, { recursive: true });

// Best-effort sweep of stale per-run directories (older than 1 day) so local
// runs do not accumulate them; never touches the current run's dir.
try {
  const now = Date.now();
  for (const entry of fs.readdirSync(tmpRoot)) {
    if (entry === runId) continue;
    const full = path.join(tmpRoot, entry);
    try {
      if (now - fs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {}
  }
} catch {}
