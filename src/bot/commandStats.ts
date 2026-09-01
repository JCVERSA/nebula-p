import fs from "fs";
import path from "path";

// In-memory command usage statistics, persisted to disk so real usage
// survives restarts. Starts empty (no fabricated seed data).
let commandStats: Record<string, number> = {};

function getStatsFile(): string {
  const dir = process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
  return path.join(dir, "stats.json");
}

function loadStats() {
  try {
    if (fs.existsSync(getStatsFile())) {
      const parsed = JSON.parse(fs.readFileSync(getStatsFile(), "utf-8"));
      Object.assign(commandStats, parsed);
    }
  } catch (e: any) {
    console.error("[Stats] Failed to load stats file:", e?.message || e);
  }
}

let saveTimer: NodeJS.Timeout | null = null;

function persistStats() {
  try {
    const dir = process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write so a crash cannot leave a truncated stats file.
    const tmp = `${getStatsFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(commandStats, null, 2), "utf-8");
    fs.renameSync(tmp, getStatsFile());
  } catch (e: any) {
    console.error("[Stats] Failed to persist stats:", e?.message || e);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistStats();
  }, 500);
}

loadStats();

export function getCommandStats(): Record<string, number> {
  return { ...commandStats };
}

export function incrementCommandStats(commandName: string) {
  const cleanName = commandName.toLowerCase().trim();
  if (cleanName) {
    commandStats[cleanName] = (commandStats[cleanName] || 0) + 1;
    scheduleSave();
  }
}

/** Backup/restore support: replace all counters (bounded, sanitized). */
export function replaceStats(entries: Record<string, number>): number {
  commandStats = {};
  for (const [name, count] of Object.entries(entries || {})) {
    const clean = name.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 64);
    const n = Number(count);
    if (clean && Number.isFinite(n) && n > 0) commandStats[clean] = Math.min(Math.floor(n), 1_000_000_000);
  }
  persistStats();
  return Object.keys(commandStats).length;
}

export function flushCommandStats() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistStats();
}

// Best-effort flush so debounced counters are not lost on graceful shutdown.
// A signal handler suppresses the default exit, so we explicitly exit after
// flushing (the flush itself is best-effort and never throws).
for (const event of ["SIGINT", "SIGTERM"] as const) {
  process.once(event, () => {
    try { flushCommandStats(); } catch {}
    process.exit(0);
  });
}
