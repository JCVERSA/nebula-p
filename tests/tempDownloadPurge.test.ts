import { describe, expect, it } from "vitest";
import { purgeStartupOrphans } from "../src/bot/tempDownloadManager.js";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Audit 8.16 — OOM-killed runs leave debris (kernel kills bypass `finally`
 * cleanup): episode files in nebula_temp_downloads and cat_catch_* HLS staging
 * dirs in os.tmpdir(). Because the token registry is in-memory, after a
 * restart every stored file is unreachable anyway, so the startup purge may
 * remove them all — otherwise the quota saturates and fresh batches fail.
 *
 * 8.90 — le retour terrain « .p ne libère jamais » a révélé le vrai trou :
 * les épisodes .mp4 À LA RACINE du tmpdir (batch_*, nom d'anime brut) n'étaient
 * couverts par AUCUN nettoyage. La purge au boot les couvre désormais via
 * services/tmpDebris.ts (préfixes + filet fichiers média).
 *
 * Robustesse multi-workers : un claim vivant (PID = ce process) démarré APRÈS
 * la création de nos débris (antidatés) protège les fichiers FRAIS créés par
 * les autres workers de la suite (ex. novaboxBatchFlow) — la fenêtre du claim
 * les épargne, nos débris antidatés restent purgés.
 */
describe("purgeStartupOrphans (audit 8.16 + 8.90)", () => {
  const tempDir = path.join(os.tmpdir(), "nebula_temp_downloads");

  it("removes orphaned episodes, staging dirs AND root-level media debris", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const t = Date.now();
    const staleEpisode = path.join(tempDir, "deadtoken_S01_E09.mp4");
    fs.writeFileSync(staleEpisode, Buffer.alloc(2048, 1));

    const catCatchDir = path.join(os.tmpdir(), `cat_catch_${t}_test`);
    fs.mkdirSync(path.join(catCatchDir, "segments"), { recursive: true });
    fs.writeFileSync(path.join(catCatchDir, "segments", "segment_000000.ts"), Buffer.alloc(512, 2));

    const zipStaging = path.join(os.tmpdir(), `batch_zip_${t}_test`);
    fs.mkdirSync(zipStaging, { recursive: true });

    // 8.90 : épisodes racine (antidatés 10 min — AVANT le claim ci-dessous)
    const backdate = (p: string) => fs.utimesSync(p, new Date(t - 10 * 60 * 1000), new Date(t - 10 * 60 * 1000));
    const rootBatchMp4 = path.join(os.tmpdir(), `batch_${t}_0_Nebula_S01E01.mp4`);
    fs.writeFileSync(rootBatchMp4, "episode-bytes");
    backdate(rootBatchMp4);
    const rootSingleMp4 = path.join(os.tmpdir(), `Mushoku_Tensei_S03E13_480P_${t}.mp4`);
    fs.writeFileSync(rootSingleMp4, "episode-bytes");
    backdate(rootSingleMp4);

    // Innocent bystanders must survive: unrelated tmp entries are untouched.
    const bystander = path.join(os.tmpdir(), `unrelated_${t}.txt`);
    fs.writeFileSync(bystander, "keep me");
    const bystanderJson = path.join(os.tmpdir(), `nebula_notes_${t}.json`);
    fs.writeFileSync(bystanderJson, "{}"); // cache/notes : PAS un média

    // Claim vivant démarré après nos débris : fenêtre = protection des
    // fichiers frais (autres workers), pas des nôtres (antidatés).
    const claimsSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "claims-test-"));
    const prevClaimsDir = process.env.NEBULA_CLAIMS_DIR;
    process.env.NEBULA_CLAIMS_DIR = claimsSandbox;
    fs.writeFileSync(
      path.join(claimsSandbox, "purge-startup-guard.json"),
      JSON.stringify({ jobId: "purge-startup-guard", botId: "test", pid: process.pid, expectedBytes: 1, createdAt: Date.now() })
    );

    try {
      const result = purgeStartupOrphans();

      expect(fs.existsSync(staleEpisode)).toBe(false);
      expect(fs.existsSync(catCatchDir)).toBe(false);
      expect(fs.existsSync(zipStaging)).toBe(false);
      expect(fs.existsSync(rootBatchMp4)).toBe(false); // 8.90 : épisode batch racine
      expect(fs.existsSync(rootSingleMp4)).toBe(false); // 8.90 : épisode single (filet média)
      expect(fs.existsSync(bystander)).toBe(true);
      expect(fs.existsSync(bystanderJson)).toBe(true); // .json jamais touché
      expect(result.cleanedItems).toBeGreaterThanOrEqual(5);
      expect(result.freedBytes).toBeGreaterThan(0);
    } finally {
      if (prevClaimsDir === undefined) delete process.env.NEBULA_CLAIMS_DIR;
      else process.env.NEBULA_CLAIMS_DIR = prevClaimsDir;
      try { fs.rmSync(claimsSandbox, { recursive: true, force: true }); } catch {}
      for (const f of [catCatchDir, zipStaging, rootBatchMp4, rootSingleMp4, bystander, bystanderJson]) {
        try { fs.rmSync(f, { recursive: true, force: true }); } catch {}
      }
    }
  });
});
