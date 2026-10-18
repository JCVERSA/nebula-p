/**
 * 9.18ggg (audit 17/10 §6) — registre des sous-processus média.
 *
 * À l'arrêt d'un moteur, le balayage de manage.sh ne tue que les process
 * engine.cjs : leurs petits-fils ffmpeg/yt-dlp survivaient en orphelins et
 * continuaient de consommer le cœur unique du VPS. Les sites de spawn
 * média s'enregistrent ici ; le shutdown du moteur termine tout le
 * registre (SIGTERM → grâce → SIGKILL).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { trackSpawn, trackedSpawnCount, terminateTrackedSpawns } from "../src/bot/services/spawnRegistry.js";

interface FakeChild {
  signals: string[];
  once(event: string, cb: () => void): FakeChild;
  emit(event: string): void;
  kill(signal?: string): boolean;
}

function fakeChild(opts: { exitOnTerm?: boolean } = {}): FakeChild & { handlers: Map<string, () => void> } {
  const handlers = new Map<string, () => void>();
  const child: any = {
    signals: [] as string[],
    once(event: string, cb: () => void) {
      handlers.set(event, cb);
      return child;
    },
    emit(event: string) {
      handlers.get(event)?.();
    },
    kill(signal = "SIGTERM") {
      child.signals.push(signal);
      if (opts.exitOnTerm && signal === "SIGTERM") child.emit("exit");
      return true;
    },
  };
  child.handlers = handlers;
  return child;
}

describe("9.18ggg — spawnRegistry (unité)", () => {
  it("trackSpawn enregistre, exit libère", () => {
    const before = trackedSpawnCount();
    const child = fakeChild();
    trackSpawn(child as any);
    expect(trackedSpawnCount()).toBe(before + 1);
    child.emit("exit");
    expect(trackedSpawnCount()).toBe(before);
  });

  it("un spawn raté (event error, jamais d'exit) libère aussi le registre", () => {
    const before = trackedSpawnCount();
    const child = fakeChild();
    trackSpawn(child as any);
    expect(trackedSpawnCount()).toBe(before + 1);
    child.emit("error");
    expect(trackedSpawnCount()).toBe(before);
  });

  it("terminateTrackedSpawns : SIGTERM, grâce, puis SIGKILL sur le récalcitrant", async () => {
    const before = trackedSpawnCount();
    const stubborn = fakeChild(); // ignore SIGTERM
    trackSpawn(stubborn as any);
    await terminateTrackedSpawns(150); // grâce courte pour le test
    expect(stubborn.signals).toContain("SIGTERM");
    expect(stubborn.signals).toContain("SIGKILL");
    expect(trackedSpawnCount()).toBe(before);
  });

  it("terminateTrackedSpawns : un enfant poli (exit au SIGTERM) ne reçoit PAS de SIGKILL", async () => {
    const before = trackedSpawnCount();
    const polite = fakeChild({ exitOnTerm: true });
    trackSpawn(polite as any);
    await terminateTrackedSpawns(400);
    expect(polite.signals).toEqual(["SIGTERM"]);
    expect(trackedSpawnCount()).toBe(before);
  });

  it("registre vide : terminate ne jette pas et ne tue rien", async () => {
    await terminateTrackedSpawns(50);
    expect(true).toBe(true);
  });
});

describe("9.18ggg — câblage des spawns (source)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

  it("chaque site de spawn média enregistre son enfant", () => {
    // import + appels : ffprobe durée, ffprobe audio, runFfmpegKit (mediaToolkit)
    expect(read("src/bot/services/mediaToolkit.ts").split("trackSpawn").length - 1).toBe(4);
    expect(read("src/bot/services/hlsDownloader.ts").split("trackSpawn").length - 1).toBe(2);
    expect(read("src/bot/services/animeStreamExtractor.ts").split("trackSpawn").length - 1).toBe(2);
    expect(read("src/bot/services/ytDlp.ts").split("trackSpawn").length - 1).toBe(2);
    expect(read("src/bot/services/ttsService.ts").split("trackSpawn").length - 1).toBe(2);
  });

  it("le shutdown du moteur termine le registre avant de sortir", () => {
    const src = read("engine.ts");
    expect(src).toContain("terminateTrackedSpawns(2000)");
    // l'arrêt des enfants vient AVANT process.exit
    expect(src.indexOf("terminateTrackedSpawns(2000)")).toBeLessThan(src.indexOf("process.exit(code)"));
  });
});
