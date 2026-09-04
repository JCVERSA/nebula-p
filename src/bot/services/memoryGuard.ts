/**
 * Memory guard (audit 8.50, 2026-09-02).
 *
 * Production evidence: a 4-episode heavy batch (~120 MB each) OOM-killed
 * the bot inside its ~954 MB cgroup despite --max-old-space-size=384 —
 * that flag caps the V8 heap, NOT external Buffer memory, and glibc's
 * per-thread arenas fragment under allocation churn (hundreds of MB of
 * transient segment buffers per episode). These helpers make the pressure
 * visible and give the kernel time to reclaim between episodes.
 */

export const RSS_PAUSE_THRESHOLD_MB = 700; // back off before the cgroup ceiling
export const RSS_CRITICAL_MB = 820;

export type MemoryPressure = "ok" | "high" | "critical";

export function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

/** Pure classification for tests + the batch worker's decision. */
export function memoryPressure(currentRssMb: number): MemoryPressure {
  if (currentRssMb >= RSS_CRITICAL_MB) return "critical";
  if (currentRssMb >= RSS_PAUSE_THRESHOLD_MB) return "high";
  return "ok";
}

/**
 * Logs the current footprint and, when pressure is high, forces GC and waits
 * briefly (the kernel reclaims freed pages asynchronously). Bounded — never
 * blocks the batch for more than ~12 s. Returns the pressure after waiting.
 */
export async function enforceMemoryHeadroom(label: string): Promise<MemoryPressure> {
  let mb = rssMb();
  let level = memoryPressure(mb);
  if (level === "ok") {
    console.log(`[MEM] ${label}: rss=${mb} MB — ok`);
    return level;
  }
  console.warn(`[MEM] ${label}: rss=${mb} MB — ${level}, forcing GC and pausing…`);
  for (let attempt = 0; attempt < 2 && level !== "ok"; attempt++) {
    try {
      (globalThis as any).gc?.();
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
    mb = rssMb();
    level = memoryPressure(mb);
  }
  console.warn(`[MEM] ${label}: rss=${mb} MB after headroom wait — ${level}`);
  return level;
}
