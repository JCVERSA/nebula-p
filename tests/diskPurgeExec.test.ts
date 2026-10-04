import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { executeDiskPurge } from "../src/bot/services/diskPurge.js";
import { getTempDownloadDir, purgeTempRecords, registerTempDownload } from "../src/bot/tempDownloadManager.js";

/**
 * 8.88 — executeDiskPurge en conditions RÉELLES (pas de mock), périmètres
 * injectés : stagingRoot = sandbox, claims vivants injectés. Le store livré
 * est le vrai dossier : notre record est enregistré via l'API réelle.
 *
 * Sécurité inter-tests : les autres workers de la suite ne créent que des
 * fichiers FRAIS (< grâce 5 min) → jamais purgés par ce test ; notre
 * orphelin est antidaté à 45 min avec un nom unique.
 */
describe("8.88 — executeDiskPurge (intégration réelle, périmètres injectés)", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "purge-exec-"));
  });

  afterAll(() => {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
  });

  it("épargne le batch vivant (jobId + fenêtre + grâce), purge l'ancien", async () => {
    const t = Date.now();

    const mkStaging = (prefix: string, ageMs: number): string => {
      const d = path.join(sandbox, `${prefix}_${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, "seg.ts"), "x");
      const ts = new Date(t - ageMs);
      fs.utimesSync(d, ts, ts);
      return d;
    };
    const oldStaging = mkStaging("cat_catch", 40 * 60 * 1000); // avant le claim → purgé
    const freshStaging = mkStaging("batch_zip", 60 * 1000); // grâce 5 min → épargné
    const duringStaging = mkStaging("cat_catch", 20 * 60 * 1000); // pendant le batch → épargné

    // 8.90 : épisodes .mp4 À LA RACINE du tmpdir (le trou du retour terrain)
    const mkRootFile = (name: string, ageMs: number | null): string => {
      const f = path.join(sandbox, name);
      fs.writeFileSync(f, Buffer.alloc(2048));
      if (ageMs !== null) {
        const ts = new Date(t - ageMs);
        fs.utimesSync(f, ts, ts);
      }
      return f;
    };
    const oldRootMp4 = mkRootFile(`batch_${t}_0_Solo_Leveling_S01E01.mp4`, 45 * 60 * 1000); // avant claim + > grâce → purgé
    const bareRootMp4 = mkRootFile(`Mushoku_Tensei_S03E13_480P.mp4`, 45 * 60 * 1000); // épisode single SANS préfixe → filet média
    const freshRootMp4 = mkRootFile(`Neuve_Serie_E01.mp4`, null); // frais → grâce 5 min

    // Claim vivant : job démarré il y a 30 min (claim fictif injecté)
    const claim = { jobId: `purge-test-${t}`, createdAt: t - 30 * 60 * 1000 };

    // Record livré de CE job (doit être épargné) — enregistrement réel
    const src = path.join(sandbox, "episode.mp4");
    fs.writeFileSync(src, Buffer.alloc(2048));
    const rec = registerTempDownload(src, "Episode_Test_8_88.mp4", {
      moveFile: true,
      jobId: claim.jobId,
      ttlMinutes: 30
    });

    // Orphelin ancien dans le VRAI store livré (antidéjà-purge : mtime 45 min)
    const orphan = path.join(getTempDownloadDir(), `purge_test_orphan_${t}.bin`);
    fs.writeFileSync(orphan, Buffer.alloc(1024));
    fs.utimesSync(orphan, new Date(t - 45 * 60 * 1000), new Date(t - 45 * 60 * 1000));

    try {
      const r = await executeDiskPurge({ stagingRoot: sandbox, liveClaims: [claim] });

      expect(r.activeBatches).toBe(1);
      expect(r.sparedDelivered).toBeGreaterThanOrEqual(1); // au moins notre record
      expect(fs.existsSync(rec.filePath)).toBe(true); // épargné physiquement
      expect(fs.existsSync(orphan)).toBe(false); // orphelin ancien purgé
      expect(fs.existsSync(oldStaging)).toBe(false); // débris ancien purgé
      expect(fs.existsSync(oldRootMp4)).toBe(false); // 8.90 : épisode batch racine purgé
      expect(fs.existsSync(bareRootMp4)).toBe(false); // 8.90 : épisode SANS préfixe purgé (filet média)
      expect(fs.existsSync(freshRootMp4)).toBe(true); // 8.90 : frais → grâce
      expect(fs.existsSync(freshStaging)).toBe(true); // grâce 5 min
      expect(fs.existsSync(duringStaging)).toBe(true); // fenêtre du claim vivant
      expect(r.deletedDirs).toBeGreaterThanOrEqual(1);
      expect(r.deletedFiles).toBeGreaterThanOrEqual(1); // au moins l'orphelin
    } finally {
      purgeTempRecords([rec.token]); // nettoyage du record épargné
      try { fs.rmSync(orphan, { force: true }); } catch {}
    }
  });
});
