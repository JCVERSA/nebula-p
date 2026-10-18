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

import os from "os";

export const RSS_PAUSE_THRESHOLD_MB = 700; // gros hôtes (≥ 1,4 Go) — audit 8.50
export const RSS_CRITICAL_MB = 820;

/**
 * 9.18uuu (terrain 18/10) : ces seuils étaient calibrés pour un conteneur
 * ~954 Mo DÉDIÉ au moteur. Sur un VPS 1 Go PARTAGÉ (panneau + superviseur +
 * ffmpeg + OS), le kernel tuait le moteur vers 400-500 Mo de RSS alors que
 * le garde croyait tout « ok » — crash à CHAQUE batch, fichiers livrés
 * perdus au redémarrage. Sous 1,4 Go de RAM totale, les seuils s'adaptent à
 * l'hôte (pause ≈ 42 % de la RAM, critique ≈ 50 %) ; surcharge possible par
 * NEBULA_RSS_PAUSE_MB / NEBULA_RSS_CRITICAL_MB.
 */
const SMALL_HOST_BYTES = 1.4 * 1024 * 1024 * 1024;

export type MemoryPressure = "ok" | "high" | "critical";

export function rssPauseThresholdMb(totalMemBytes: number = os.totalmem()): number {
  const env = Number(process.env.NEBULA_RSS_PAUSE_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  if (totalMemBytes >= SMALL_HOST_BYTES) return RSS_PAUSE_THRESHOLD_MB;
  return Math.max(200, Math.round((totalMemBytes / 1048576) * 0.42));
}

export function rssCriticalThresholdMb(totalMemBytes: number = os.totalmem()): number {
  const env = Number(process.env.NEBULA_RSS_CRITICAL_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  if (totalMemBytes >= SMALL_HOST_BYTES) return RSS_CRITICAL_MB;
  return Math.max(260, Math.round((totalMemBytes / 1048576) * 0.5));
}

export function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

/** Pure classification for tests + the batch worker's decision. */
export function memoryPressure(currentRssMb: number, totalMemBytes: number = os.totalmem()): MemoryPressure {
  if (currentRssMb >= rssCriticalThresholdMb(totalMemBytes)) return "critical";
  if (currentRssMb >= rssPauseThresholdMb(totalMemBytes)) return "high";
  return "ok";
}

/**
 * Logs the current footprint and, when pressure is high, forces GC and waits
 * briefly (the kernel reclaims freed pages asynchronously). Bounded — never
 * blocks the batch for more than ~12 s. Returns the pressure after waiting.
 */
export async function enforceMemoryHeadroom(
  label: string,
  totalMemBytes: number = os.totalmem()
): Promise<MemoryPressure> {
  let mb = rssMb();
  let level = memoryPressure(mb, totalMemBytes);
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
    level = memoryPressure(mb, totalMemBytes);
  }
  console.warn(`[MEM] ${label}: rss=${mb} MB after headroom wait — ${level}`);
  return level;
}
