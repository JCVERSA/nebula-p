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
import fs from "fs";

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

// ── 9.18vvv : la limite qui compte est celle du CGROUP, pas de l'hôte ──────
// Terrain 18/10 : le VPS est un conteneur (Docker/LXC). os.totalmem() peut y
// voir la RAM de l'HÔTE (dizaines de Go) alors que le kernel tue le moteur à
// la limite du conteneur (~1 Go) — les seuils adaptatifs uuu restaient alors
// calés sur 700/820 Mo et le garde était sourd. On lit la limite cgroup
// (v2 puis v1) et on prend le MIN avec la RAM vue.
const CGROUP_UNLIMITED_BYTES = 1024 * 1024 * 1024 * 1024; // ≥ 1 To = illimité

export function readCgroupMemLimitBytes(
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf-8")
): number | null {
  // cgroup v2 : /sys/fs/cgroup/memory.max — "max" ou un nombre d'octets.
  try {
    const t = (readFile("/sys/fs/cgroup/memory.max") || "").trim();
    if (/^\d+$/.test(t)) {
      const v = Number(t);
      if (v > 0 && v < CGROUP_UNLIMITED_BYTES) return v;
    }
  } catch {}
  // cgroup v1 : /sys/fs/cgroup/memory/memory.limit_in_bytes.
  try {
    const t = (readFile("/sys/fs/cgroup/memory/memory.limit_in_bytes") || "").trim();
    if (/^\d+$/.test(t)) {
      const v = Number(t);
      if (v > 0 && v < CGROUP_UNLIMITED_BYTES) return v;
    }
  } catch {}
  return null;
}

/** Pur : la limite effective entre cgroup et RAM vue (le kernel tue au plus bas). */
export function pickEffectiveMemBytes(totalMemBytes: number, cgroupBytes: number | null): number {
  if (cgroupBytes !== null && cgroupBytes > 0 && cgroupBytes < totalMemBytes) return cgroupBytes;
  return totalMemBytes;
}

/** Limite mémoire effective de CE process (cgroup si présent, sinon RAM vue). */
export function effectiveTotalMemBytes(): number {
  return pickEffectiveMemBytes(os.totalmem(), readCgroupMemLimitBytes());
}

// ── 9.18www : surveiller le CONTENEUR ENTIER, pas seulement le moteur ──────
// Terrain 18/10 : limite cgroup = 999 997 440 octets (953,7 Mo) pour TOUT le
// conteneur — panneau + superviseur + moteurs + ffmpeg. L'ancien garde ne
// regardait que le RSS du moteur (396 Mo « ok ») pendant que panneau ~200 Mo
// + ffmpeg ~150 Mo saturait le conteneur → SIGKILL. On lit désormais
// l'usage du cgroup ENTIER (moins le cache de pages, récupérable) : c'est LE
// chiffre que le kernel compare à la limite.

/** Usage mémoire du cgroup entier (v2 memory.current / v1 usage_in_bytes). */
export function readCgroupMemUsageBytes(
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf-8")
): number | null {
  try {
    const t = (readFile("/sys/fs/cgroup/memory.current") || "").trim();
    if (/^\d+$/.test(t)) return Number(t);
  } catch {}
  try {
    const t = (readFile("/sys/fs/cgroup/memory/memory.usage_in_bytes") || "").trim();
    if (/^\d+$/.test(t)) return Number(t);
  } catch {}
  return null;
}

/**
 * Cache de pages du cgroup (récupérable — pas de la vraie pression).
 * 9.18zzz : TOUT le cache de pages, inactive_file + active_file. Terrain
 * 18/10 : le premier batch lancé 39 s après un `nebula update` voyait
 * « usage conteneur=730 MB — critical » alors que le même engine fraîchement
 * démarré mesurait 556 MB à l'instant T du run précédent — le build (git +
 * tsc + écriture de dist) laisse ~175 Mo de page cache CHAUDE (active_file)
 * que l'ancienne soustraction (inactive_file seul) ne captait pas. Ces pages
 * sont sur la LRU fichier : le kernel les évince aussi facilement que les
 * inactives — ce n'est jamais de la pression réelle.
 */
export function readCgroupPageCacheBytes(
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf-8")
): number {
  try {
    const stat = readFile("/sys/fs/cgroup/memory.stat");
    const m = stat.match(/^inactive_file (\d+)$/m);
    if (m) {
      const a = stat.match(/^active_file (\d+)$/m);
      return Number(m[1]) + (a ? Number(a[1]) : 0);
    }
  } catch {}
  try {
    const stat = readFile("/sys/fs/cgroup/memory/memory.stat");
    const m = stat.match(/^total_inactive_file (\d+)$/m);
    if (m) {
      const a = stat.match(/^total_active_file (\d+)$/m);
      return Number(m[1]) + (a ? Number(a[1]) : 0);
    }
  } catch {}
  return 0;
}

/** Seuils du chemin « conteneur » : fractions de la limite (70 % / 80 %). */
export const CONTAINER_PAUSE_FRACTION = 0.7;
export const CONTAINER_CRITICAL_FRACTION = 0.8;

/** Pur : pression de l'usage CONTENEUR (Mo) contre la limite (Mo). */
export function containerPressure(usageMb: number, limitMb: number): MemoryPressure {
  const envPause = Number(process.env.NEBULA_RSS_PAUSE_MB);
  const envCritical = Number(process.env.NEBULA_RSS_CRITICAL_MB);
  const pause = Number.isFinite(envPause) && envPause > 0 ? envPause : Math.round(limitMb * CONTAINER_PAUSE_FRACTION);
  const critical = Number.isFinite(envCritical) && envCritical > 0 ? envCritical : Math.round(limitMb * CONTAINER_CRITICAL_FRACTION);
  if (usageMb >= critical) return "critical";
  if (usageMb >= pause) return "high";
  return "ok";
}

export function rssPauseThresholdMb(totalMemBytes: number = effectiveTotalMemBytes()): number {
  const env = Number(process.env.NEBULA_RSS_PAUSE_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  if (totalMemBytes >= SMALL_HOST_BYTES) return RSS_PAUSE_THRESHOLD_MB;
  return Math.max(200, Math.round((totalMemBytes / 1048576) * 0.42));
}

export function rssCriticalThresholdMb(totalMemBytes: number = effectiveTotalMemBytes()): number {
  const env = Number(process.env.NEBULA_RSS_CRITICAL_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  if (totalMemBytes >= SMALL_HOST_BYTES) return RSS_CRITICAL_MB;
  return Math.max(260, Math.round((totalMemBytes / 1048576) * 0.5));
}

export function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

/** Pure classification for tests + the batch worker's decision. */
export function memoryPressure(currentRssMb: number, totalMemBytes: number = effectiveTotalMemBytes()): MemoryPressure {
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
  totalMemBytes?: number
): Promise<MemoryPressure> {
  // 9.18www : en production (pas de paramètre explicite), on surveille
  // l'usage du CONTENEUR ENTIER si le cgroup est lisible — c'est ce que le
  // kernel compare à la limite. Un paramètre explicite (tests/override)
  // garde le chemin RSS historique, déterministe.
  const limitBytes = totalMemBytes ?? effectiveTotalMemBytes();
  const useContainer = totalMemBytes === undefined;
  const measure = (): { mb: number; level: MemoryPressure; describe: string } => {
    if (useContainer) {
      const usage = readCgroupMemUsageBytes();
      if (usage !== null) {
        const cache = readCgroupPageCacheBytes();
        const wsMb = Math.max(0, Math.round((usage - cache) / 1048576));
        const limitMb = Math.floor(limitBytes / 1048576);
        // 9.18zzz : décomposition visible — le prochain terrain SAURA si la
        // pression vient du working set réel (brut − cache) ou du résidu de
        // build (cache), au lieu de deviner.
        const rawMb = Math.round(usage / 1048576);
        const cacheMb = Math.round(cache / 1048576);
        return {
          mb: wsMb,
          level: containerPressure(wsMb, limitMb),
          describe: `usage conteneur=${wsMb} MB (brut ${rawMb} MB, dont cache fichier ${cacheMb} MB) / limite ${limitMb} MB`
        };
      }
    }
    const mb = rssMb();
    return { mb, level: memoryPressure(mb, limitBytes), describe: `rss=${mb} MB` };
  };

  let { level, describe } = measure();
  if (level === "ok") {
    console.log(`[MEM] ${label}: ${describe} — ok`);
    return level;
  }
  console.warn(`[MEM] ${label}: ${describe} — ${level}, forcing GC and pausing…`);
  for (let attempt = 0; attempt < 2 && level !== "ok"; attempt++) {
    try {
      (globalThis as any).gc?.();
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
    ({ level, describe } = measure());
  }
  console.warn(`[MEM] ${label}: ${describe} after headroom wait — ${level}`);
  return level;
}
