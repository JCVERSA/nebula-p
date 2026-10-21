import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import { buildConcatDemuxerList, hlsSegmentConcurrency } from "../src/bot/services/hlsDownloader.js";

/**
 * 9.18dddd — pack vitesse (recherche 18/10, décision owner « on va faire ça »).
 * P2 : concurrence du pool de segments réglable (défaut 16).
 * P3 : demuxer concat ffmpeg sur liste de segments, flux consolidé en repli.
 * P5 : agent keep-alive épinglé partagé par le pool.
 * P1 : chronomètre par phase ; P4 garde adaptative (memoryGuard.test.ts) ;
 * débit réel servi par /d/ (app.ts) — câblages épinglés ci-dessous.
 */

afterEach(() => {
  delete process.env.NEBULA_HLS_CONCURRENCY;
});

describe("P2 : hlsSegmentConcurrency (NEBULA_HLS_CONCURRENCY)", () => {
  it("défaut 16 — terrain 18/10 : les 8 en dur bornaient E03 à ~11 Mo/s (limité par la latence)", () => {
    expect(hlsSegmentConcurrency()).toBe(16);
  });

  it("l'environnement surcharge la concurrence", () => {
    process.env.NEBULA_HLS_CONCURRENCY = "24";
    expect(hlsSegmentConcurrency()).toBe(24);
  });

  it("plafonné à 32 (>32 = throttling CDN documenté) ; valeur invalide → défaut", () => {
    process.env.NEBULA_HLS_CONCURRENCY = "64";
    expect(hlsSegmentConcurrency()).toBe(32);
    process.env.NEBULA_HLS_CONCURRENCY = "0";
    expect(hlsSegmentConcurrency()).toBe(16);
    process.env.NEBULA_HLS_CONCURRENCY = "pas-un-nombre";
    expect(hlsSegmentConcurrency()).toBe(16);
  });
});

describe("P3 : buildConcatDemuxerList (liste pour -f concat -safe 0)", () => {
  it("un « file » par segment, saut de ligne final, noms relatifs au dossier de la liste", () => {
    expect(buildConcatDemuxerList(["segment_000000.ts", "segment_000001.ts"])).toBe(
      "file 'segment_000000.ts'\nfile 'segment_000001.ts'\n"
    );
  });

  it("échappement du format concat : une apostrophe devient '\\''", () => {
    expect(buildConcatDemuxerList(["seg'x.ts"])).toBe("file 'seg'\\''x.ts'\n");
  });

  it("liste vide acceptée sans collision (défense en profondeur)", () => {
    expect(buildConcatDemuxerList([])).toBe("\n");
  });
});

describe("câblage (leçon 8.49b : vert localement ≠ câblé en production)", () => {
  it("hlsDownloader : concurrence env + liste concat + repli consolidé + agent keep-alive + chrono", () => {
    const src = fs.readFileSync("src/bot/services/hlsDownloader.ts", "utf-8");
    expect(src).toContain("const CONCURRENCY = hlsSegmentConcurrency();");
    expect(src).toContain("concat_list.txt");
    expect(src).toContain('"-f", "concat", "-safe", "0"');
    expect(src).toContain("buildConsolidatedInput"); // repli éprouvé conservé
    expect(src).toContain("consolidated_stream.ts");
    expect(src).toContain("createKeepAliveDownloadAgent");
    expect(src).toContain("keepAliveAgent?.destroy();");
    expect(src).toContain("⏱️");
  });

  it("memoryGuard : 1ʳᵉ attente high = 3 s, 2ᵉ seulement si rien ne s'améliore, critical 5 s inchangé", () => {
    const src = fs.readFileSync("src/bot/services/memoryGuard.ts", "utf-8");
    const enforce = src.slice(src.indexOf("export async function enforceMemoryHeadroom"));
    expect(enforce).toContain('level === "high" && attempt === 0 ? 3000 : 5000');
    expect(enforce).toContain('level === "high" && attempt === 0 && mb < mbBeforeWait');
    expect(enforce).toContain("readCgroupMemUsageBytes()");
    expect(enforce).toContain("dont cache fichier");
  });

  it("novabox : chrono travail/garde par épisode dans le worker batch", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    const workerLoop = src.slice(
      src.indexOf("const worker = async () => {"),
      src.indexOf("const worker = async () => {") + 1200
    );
    expect(workerLoop).toContain("await enforceMemoryHeadroom(");
    expect(src).toContain("⏱️ ép.");
  });

  it("app.ts : le débit réel servi par /d/ est journalisé (Mo/s, complet/interrompu)", () => {
    const src = fs.readFileSync("app.ts", "utf-8");
    expect(src).toContain("trackServeRate");
    expect(src).toContain("[MEDIA]");
    expect(src).toContain("Mo/s");
  });
});
