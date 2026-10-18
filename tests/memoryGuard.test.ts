import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import {
  RSS_CRITICAL_MB,
  RSS_PAUSE_THRESHOLD_MB,
  containerPressure,
  enforceMemoryHeadroom,
  memoryPressure,
  pickEffectiveMemBytes,
  readCgroupMemLimitBytes,
  readCgroupMemUsageBytes,
  readCgroupPageCacheBytes,
  rssCriticalThresholdMb,
  rssMb,
  rssPauseThresholdMb
} from "../src/bot/services/memoryGuard.js";

/**
 * Audit 8.50 — the bot was OOM-killed (kernel "Killed", no stack) mid-batch
 * inside its ~954 MB cgroup even though --max-old-space-size=384 was set:
 * that flag caps the V8 heap only, while external Buffers + glibc arena
 * fragmentation kept growing the RSS. These tests pin the guard contract:
 * classification thresholds, bounded back-off, and the actual wiring in the
 * batch worker + manage.sh startup env.
 */

const MB = 1048576;
/** Hôte GROS (≥ 1,4 Go) : seuils historiques 8.50. Total explicite partout :
 * les tests restent hermétiques quel que soit l'hôte qui les exécute. */
const BIG_HOST = 8 * 1024 * MB;
/** Hôte PETIT (VPS 1 Go du terrain 18/10) : seuils adaptés 9.18uuu. */
const SMALL_HOST = 1024 * MB;

const fakeRss = (mb: number) => ({ rss: mb * MB }) as NodeJS.MemoryUsage;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { gc?: unknown }).gc;
});

describe("memoryPressure (pure classification)", () => {
  it("classifies ok below the pause threshold", () => {
    expect(memoryPressure(0, BIG_HOST)).toBe("ok");
    expect(memoryPressure(RSS_PAUSE_THRESHOLD_MB - 1, BIG_HOST)).toBe("ok");
  });

  it("classifies high from the pause threshold up to critical", () => {
    expect(memoryPressure(RSS_PAUSE_THRESHOLD_MB, BIG_HOST)).toBe("high");
    expect(memoryPressure(RSS_CRITICAL_MB - 1, BIG_HOST)).toBe("high");
  });

  it("classifies critical at and beyond the critical threshold", () => {
    expect(memoryPressure(RSS_CRITICAL_MB, BIG_HOST)).toBe("critical");
    expect(memoryPressure(5000, BIG_HOST)).toBe("critical");
  });

  it("keeps thresholds below the ~954 MB cgroup ceiling with headroom", () => {
    // Pause must trigger early enough that two pauses still fit the budget;
    // critical must leave the kernel room before the hard kill at ~954 MB.
    expect(RSS_PAUSE_THRESHOLD_MB).toBeLessThan(750);
    expect(RSS_CRITICAL_MB).toBeGreaterThan(RSS_PAUSE_THRESHOLD_MB);
    expect(RSS_CRITICAL_MB).toBeLessThan(900);
  });
});

describe("9.18uuu — seuils adaptés à l'hôte (terrain : crash à chaque batch sur un VPS 1 Go)", () => {
  it("hôte 1 Go : pause ≈ 430 Mo, critique ≈ 512 Mo — le garde réagit AVANT le kernel", () => {
    expect(rssPauseThresholdMb(SMALL_HOST)).toBe(430);
    expect(rssCriticalThresholdMb(SMALL_HOST)).toBe(512);
    expect(memoryPressure(396, SMALL_HOST)).toBe("ok"); // le RSS vu sur le terrain
    expect(memoryPressure(430, SMALL_HOST)).toBe("high"); // pause + GC désormais
    expect(memoryPressure(512, SMALL_HOST)).toBe("critical"); // déferlement des épisodes
  });

  it("gros hôte (≥ 1,4 Go) : seuils historiques 8.50 inchangés", () => {
    expect(rssPauseThresholdMb(BIG_HOST)).toBe(RSS_PAUSE_THRESHOLD_MB);
    expect(rssCriticalThresholdMb(BIG_HOST)).toBe(RSS_CRITICAL_MB);
  });

  it("surcharge opérateur : NEBULA_RSS_PAUSE_MB / NEBULA_RSS_CRITICAL_MB gagnent", () => {
    process.env.NEBULA_RSS_PAUSE_MB = "300";
    process.env.NEBULA_RSS_CRITICAL_MB = "350";
    try {
      expect(rssPauseThresholdMb(SMALL_HOST)).toBe(300);
      expect(rssCriticalThresholdMb(BIG_HOST)).toBe(350);
    } finally {
      delete process.env.NEBULA_RSS_PAUSE_MB;
      delete process.env.NEBULA_RSS_CRITICAL_MB;
    }
  });
});

describe("9.18vvv — cgroup : la limite du conteneur, pas la RAM de l'hôte", () => {
  it("readCgroupMemLimitBytes : v2 numérique, « max », v1 géant (illimité), absent", () => {
    const reader = (content: Record<string, string>) => (p: string) => {
      if (!(p in content)) throw new Error("ENOENT");
      return content[p];
    };
    // v2 lisible → la limite.
    expect(readCgroupMemLimitBytes(reader({ "/sys/fs/cgroup/memory.max": "1073741824\n" }))).toBe(1073741824);
    // v2 « max » (illimité) et pas de v1 → null.
    expect(readCgroupMemLimitBytes(reader({ "/sys/fs/cgroup/memory.max": "max\n" }))).toBeNull();
    // v1 seul, lisible → la limite.
    expect(
      readCgroupMemLimitBytes(reader({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "1000343040\n" }))
    ).toBe(1000343040);
    // v1 géant = « illimité » → null (le garde retombe sur la RAM vue).
    expect(
      readCgroupMemLimitBytes(reader({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712\n" }))
    ).toBeNull();
    // Rien de lisible → null, jamais d'exception.
    expect(readCgroupMemLimitBytes(reader({}))).toBeNull();
  });

  it("pickEffectiveMemBytes : le MIN gagne (le kernel tue au plus bas)", () => {
    expect(pickEffectiveMemBytes(64 * 1024 * MB, 1024 * MB)).toBe(1024 * MB);
    expect(pickEffectiveMemBytes(1024 * MB, 64 * 1024 * MB)).toBe(1024 * MB); // cgroup > RAM vue → RAM
    expect(pickEffectiveMemBytes(1024 * MB, null)).toBe(1024 * MB); // pas de cgroup → RAM vue
  });

  it("LE cas terrain : hôte Docker de 64 Go VU, conteneur limité à 1 Go — sans cgroup le garde était sourd", () => {
    const hostSeen = 64 * 1024 * MB;
    const cgroup = 1024 * MB;
    // Sans lecture cgroup : seuils « gros hôte » 700/820 → sourd (le bug).
    expect(rssPauseThresholdMb(hostSeen)).toBe(RSS_PAUSE_THRESHOLD_MB);
    // Avec la limite cgroup : seuils adaptés au conteneur réel.
    const effective = pickEffectiveMemBytes(hostSeen, cgroup);
    expect(rssPauseThresholdMb(effective)).toBe(430);
    expect(rssCriticalThresholdMb(effective)).toBe(512);
    expect(memoryPressure(430, effective)).toBe("high");
    expect(memoryPressure(512, effective)).toBe("critical");
  });
});

describe("9.18www — surveiller le CONTENEUR ENTIER (limite terrain : 999 997 440 o = 953,7 Mo)", () => {
  const reader = (content: Record<string, string>) => (p: string) => {
    if (!(p in content)) throw new Error("ENOENT");
    return content[p];
  };

  it("readCgroupMemUsageBytes : v2 memory.current, v1 usage_in_bytes, absent → null", () => {
    expect(readCgroupMemUsageBytes(reader({ "/sys/fs/cgroup/memory.current": "700000000\n" }))).toBe(700000000);
    expect(readCgroupMemUsageBytes(reader({ "/sys/fs/cgroup/memory/memory.usage_in_bytes": "650000000\n" }))).toBe(650000000);
    expect(readCgroupMemUsageBytes(reader({}))).toBeNull();
  });

  it("readCgroupPageCacheBytes : v2 inactive_file, v1 total_inactive_file, absent → 0", () => {
    expect(
      readCgroupPageCacheBytes(reader({ "/sys/fs/cgroup/memory.stat": "anon 100\ninactive_file 250000000\n" }))
    ).toBe(250000000);
    expect(
      readCgroupPageCacheBytes(reader({ "/sys/fs/cgroup/memory/memory.stat": "total_inactive_file 150000000\n" }))
    ).toBe(150000000);
    expect(readCgroupPageCacheBytes(reader({}))).toBe(0);
  });

  it("9.18zzz : le cache CHAUD (active_file) compte aussi — résidu de build post-update", () => {
    expect(
      readCgroupPageCacheBytes(
        reader({ "/sys/fs/cgroup/memory.stat": "anon 500\ninactive_file 100000000\nactive_file 175000000\n" })
      )
    ).toBe(275000000);
    expect(
      readCgroupPageCacheBytes(
        reader({ "/sys/fs/cgroup/memory/memory.stat": "total_inactive_file 100000000\ntotal_active_file 175000000\n" })
      )
    ).toBe(275000000);
  });

  it("9.18zzz — LE cas terrain : premier batch 39 s après un update, faux « critical »", () => {
    // Run 3 (18/10 07:06, build frais) : brut 870 Mo dont 315 de cache de
    // pages laissé par le build → l'ancienne garde (inactive seul = 140)
    // voyait 730-763 « high/critical » et déférait 7 épisodes sur 8.
    const usageBytes = 870 * MB;
    const cacheBytes = readCgroupPageCacheBytes(
      reader({ "/sys/fs/cgroup/memory.stat": `inactive_file ${140 * MB}\nactive_file ${175 * MB}\n` })
    );
    expect(cacheBytes).toBe(315 * MB);
    const wsMb = Math.max(0, Math.round((usageBytes - cacheBytes) / MB));
    expect(wsMb).toBe(555); // ≈ le 556 du run précédent (engine frais sans build)
    expect(containerPressure(wsMb, 953)).toBe("ok"); // le batch CONTINUE au lieu de se déférer
    // À l'ancienne métrique (inactive seul) le même instant affichait 730 → high.
    const oldWs = Math.round((usageBytes - 140 * MB) / MB);
    expect(oldWs).toBe(730); // exactement le chiffre du log terrain
    expect(containerPressure(oldWs, 953)).toBe("high");
  });

  it("containerPressure : 70 % pause / 80 % critique de la limite — réagit AVANT le kernel (953 Mo)", () => {
    expect(containerPressure(600, 953)).toBe("ok");
    expect(containerPressure(667, 953)).toBe("high"); // 0,7 × 953 — moteur 400 + panneau 200 + ffmpeg…
    expect(containerPressure(762, 953)).toBe("critical"); // 0,8 × 953 — déferlement, il reste ~190 Mo de marge
    expect(containerPressure(900, 953)).toBe("critical");
  });

  it("surcharge opérateur : les seuils absolus NEBULA_RSS_* s'appliquent aussi au chemin conteneur", () => {
    process.env.NEBULA_RSS_PAUSE_MB = "500";
    process.env.NEBULA_RSS_CRITICAL_MB = "600";
    try {
      expect(containerPressure(499, 953)).toBe("ok");
      expect(containerPressure(500, 953)).toBe("high");
      expect(containerPressure(600, 953)).toBe("critical");
    } finally {
      delete process.env.NEBULA_RSS_PAUSE_MB;
      delete process.env.NEBULA_RSS_CRITICAL_MB;
    }
  });

  it("câblage : enforceMemoryHeadroom mesure le conteneur en production (paramètre explicite = chemin RSS des tests)", () => {
    const src = fs.readFileSync("src/bot/services/memoryGuard.ts", "utf-8");
    const enforce = src.slice(src.indexOf("export async function enforceMemoryHeadroom"));
    expect(enforce).toContain("readCgroupMemUsageBytes()");
    expect(enforce).toContain("usage conteneur=");
    expect(enforce).toContain("containerPressure(wsMb, limitMb)");
    // 9.18zzz : décomposition brut/cache visible dans le log de production.
    expect(enforce).toContain("dont cache fichier");
    expect(enforce).toContain("readCgroupPageCacheBytes()");
    // Le paramètre explicite reste le chemin RSS déterministe (tests uuu).
    expect(enforce).toContain("totalMemBytes?: number");
  });
});

describe("rssMb", () => {
  it("reports the live RSS as a positive integer in MB", () => {
    const value = rssMb();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThan(20); // any running Node process
  });
});

describe("enforceMemoryHeadroom", () => {
  it("returns ok immediately without pausing when pressure is low", async () => {
    const memSpy = vi.spyOn(process, "memoryUsage").mockReturnValue(fakeRss(300));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const gc = vi.fn();
    (globalThis as { gc?: unknown }).gc = gc;

    const result = await enforceMemoryHeadroom("unit-ok", BIG_HOST);

    expect(result).toBe("ok");
    expect(gc).not.toHaveBeenCalled();
    expect(memSpy).toHaveBeenCalled();
    // Signature log: [MEM] label: rss=X MB — level
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[MEM\] unit-ok: rss=300 MB — ok$/));
  });

  it("pauses, forces GC and reports ok once RSS drops back", async () => {
    const gc = vi.fn();
    (globalThis as { gc?: unknown }).gc = gc;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // High on entry, healthy again after the first 5 s pause.
    vi.spyOn(process, "memoryUsage")
      .mockReturnValueOnce(fakeRss(750))
      .mockReturnValueOnce(fakeRss(400));

    const pending = enforceMemoryHeadroom("unit-recover", BIG_HOST);
    await vi.advanceTimersByTimeAsync(5100);
    const result = await pending;

    expect(result).toBe("ok");
    expect(gc).toHaveBeenCalledTimes(1); // single recovery attempt
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("rss=750 MB — high, forcing GC and pausing")
    );
  });

  it("keeps pausing but stays bounded (max 2 attempts) while pressure persists", async () => {
    const gc = vi.fn();
    (globalThis as { gc?: unknown }).gc = gc;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process, "memoryUsage").mockReturnValue(fakeRss(900));

    const pending = enforceMemoryHeadroom("unit-stuck", BIG_HOST);
    await vi.advanceTimersByTimeAsync(30_000); // far beyond the guard's budget
    const result = await pending;

    expect(result).toBe("critical");
    expect(gc).toHaveBeenCalledTimes(2); // bounded — no infinite retry loop
  });
});

describe("8.50/8.51 wiring (the 8.49b lesson: green locally ≠ wired in production)", () => {
  it("the novabox batch worker calls enforceMemoryHeadroom between episodes", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    expect(source).toContain('from "../services/memoryGuard.js"');
    // Called inside the worker loop, after each episode completes.
    const workerLoop = source.slice(
      source.indexOf("const worker = async () => {"),
      source.indexOf("const worker = async () => {") + 1200
    );
    expect(workerLoop).toContain("await enforceMemoryHeadroom(");
  });

  it("8.51: the batch stops claiming episodes when RSS stays critical", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    // Worker breaks on the memory flag + the flag is set on critical.
    expect(source).toContain("if (quotaExceeded || memoryStop) break;");
    expect(source).toContain('if (level === "critical")');
    // Deferred episodes are counted from unclaimed indices (exact, race-free)
    // and surfaced to the user + the batch job status.
    expect(source).toContain("const memoryDeferredCount = memoryStop ? indices.length - nextEpisodeIdx : 0;");
    expect(source).toContain("Garde mémoire:");
  });

  it("8.51: the single-episode flow also runs the headroom check", () => {
    const source = fs.readFileSync("src/bot/commands/novabox.ts", "utf8");
    expect(source).toContain("enforceMemoryHeadroom(`single E");
  });

  it("manage.sh caps glibc arenas at startup and ships a watchdog command", () => {
    const script = fs.readFileSync("manage.sh", "utf8");
    expect(script).toContain('MALLOC_ARENA_MAX="${NEBULA_MALLOC_ARENA_MAX:-2}"');
    expect(script).toContain("cmd_watchdog() {");
    // Registered in the dispatch case + documented in help.
    expect(script).toMatch(/\bwatchdog\) cmd_watchdog "\$@" ;;/);
    expect(script).toContain("watchdog${C_RESET}");
  });

  it("8.51: the watchdog cannot start two bots concurrently (cron overlap lock)", () => {
    const script = fs.readFileSync("manage.sh", "utf8");
    expect(script).toContain('WATCHDOG_LOCK_DIR="${TMPDIR:-/tmp}/nebula-watchdog.lock"');
    // Staleness cleanup so a dead lock can never disable the watchdog forever.
    expect(script).toContain("wl_age");
    expect(script).toMatch(/rmdir "\$\{WATCHDOG_LOCK_DIR\}"/);
  });

  it("8.51: doctor inspects the real node process, not npm's sh wrapper", () => {
    const script = fs.readFileSync("manage.sh", "utf8");
    expect(script).toContain('/proc/${pid_}/comm');
    expect(script).toContain('= "node"');
  });

  it("8.51: setup installs weekly log rotation for the bot log", () => {
    const script = fs.readFileSync("manage.sh", "utf8");
    expect(script).toContain("/etc/logrotate.d/nebula-bot");
    // copytruncate is REQUIRED: nohup keeps its fd on the moved file.
    expect(script).toContain("copytruncate");
    expect(script).toContain("Rotation du log active (logrotate hebdo)");
  });

  it("8.52: the panel port comes from .env first (containers exporting PORT must not win)", () => {
    const script = fs.readFileSync("manage.sh", "utf8");
    // .env wins over the container environment (ex: web-desktop PORT=6080),
    // else environment, else 3000 — and it is exported so npm start + the
    // app + wait_http/doctor all agree on the same port.
    expect(script).toContain("_port_from_env");
    expect(script).toMatch(/^export PORT$/m);
  });
});
