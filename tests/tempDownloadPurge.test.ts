import { describe, expect, it } from "vitest";
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
 * 9.18m (audit Novabox) — DEUX durcissements :
 *
 *  1. HERMÉTISME CI : les workers vitest d'un runner partagent le VRAI
 *     /tmp — le store nebula_temp_downloads réel était balayé par tous, dans
 *     les deux sens (un worker volait les débris d'un autre → cleanedItems
 *     flaky ; notre purge supprimait les fichiers en vol des autres tests).
 *     Ce fichier réserve donc un TMPDIR PRIVÉ avant l'import dynamique du
 *     module (os.tmpdir() se résout à l'appel sur Linux) : débris, témoins
 *     et purge vivent tous dans le bac à sable.
 *  2. FENÊTRE DES CLAIMS SUR LE STORE : la purge boot épargne désormais les
 *     fichiers du store créés APRÈS le début du batch vivant le plus ancien
 *     (autre moteur en pleine exécution) — comme elle le faisait déjà pour
 *     les débris racine. En production multi-bots, le redémarrage d'un bot
 *     ne supprime plus les téléchargements en vol de l'autre.
 */

// Bac à sable AVANT tout usage de os.tmpdir() par le module testé (constante
// module-level TEMP_DOWNLOAD_DIR figée à l'import) → import dynamique requis.
const hermeticTmp = fs.mkdtempSync(path.join(os.tmpdir(), "purge-hermetic-"));
process.env.TMPDIR = hermeticTmp;

const { purgeStartupOrphans } = await import("../src/bot/tempDownloadManager.js");

describe("purgeStartupOrphans (audit 8.16 + 8.90 + 9.18m)", () => {
  const tempDir = path.join(os.tmpdir(), "nebula_temp_downloads");

  it("removes orphaned episodes, staging dirs AND root-level media debris", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const t = Date.now();
    // Antidatage explicite (helper local — les temps DOIVENT être distincts
    // pour rester déterministes : débris morts AVANT le claim vivant, fichier
    // en vol APRÈS ; à l'échelle de la milliseconde, Date.now() ne suffit pas).
    const backdateTo = (p: string, when: number) =>
      fs.utimesSync(p, new Date(when), new Date(when));
    const staleEpisode = path.join(tempDir, "deadtoken_S01_E09.mp4");
    fs.writeFileSync(staleEpisode, Buffer.alloc(2048, 1));
    // Débris MORT d'un run crashé : antidaté 2 min AVANT le claim vivant
    // ci-dessous (sans antidatage, sa mtime « maintenant » tomberait dans
    // la fenêtre du claim → épargné à tort).
    backdateTo(staleEpisode, t - 2 * 60 * 1000);

    const catCatchDir = path.join(os.tmpdir(), `cat_catch_${t}_test`);
    fs.mkdirSync(path.join(catCatchDir, "segments"), { recursive: true });
    fs.writeFileSync(path.join(catCatchDir, "segments", "segment_000000.ts"), Buffer.alloc(512, 2));
    backdateTo(catCatchDir, t - 5 * 60 * 1000); // staging d'un run crashé : avant le claim

    const zipStaging = path.join(os.tmpdir(), `batch_zip_${t}_test`);
    fs.mkdirSync(zipStaging, { recursive: true });
    backdateTo(zipStaging, t - 5 * 60 * 1000); // idem

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
      // createdAt 1 s dans le passé : le batch vivant a commencé AVANT le
      // fichier en vol créé ci-dessous (et APRÈS tous les débris antidatés).
      JSON.stringify({ jobId: "purge-startup-guard", botId: "test", pid: process.pid, expectedBytes: 1, createdAt: t - 1000 })
    );

    // 9.18m : fichier FRAIS du store créé APRÈS le claim vivant — simule un
    // autre moteur en pleine exécution → la purge boot doit l'ÉPARGNER
    // (fenêtre des claims désormais appliquée au store, pas seulement aux
    // débris racine). C'est la sémantique qui manquait au multi-bots.
    const inFlightEpisode = path.join(tempDir, `livebatch_S01_E02.mp4`);
    fs.writeFileSync(inFlightEpisode, Buffer.alloc(1024, 3));

    try {
      const result = purgeStartupOrphans();

      expect(fs.existsSync(staleEpisode)).toBe(false);
      expect(fs.existsSync(catCatchDir)).toBe(false);
      expect(fs.existsSync(zipStaging)).toBe(false);
      expect(fs.existsSync(rootBatchMp4)).toBe(false); // 8.90 : épisode batch racine
      expect(fs.existsSync(rootSingleMp4)).toBe(false); // 8.90 : épisode single (filet média)
      expect(fs.existsSync(inFlightEpisode)).toBe(true); // 9.18m : en vol → épargné
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
      try { fs.rmSync(hermeticTmp, { recursive: true, force: true }); } catch {}
    }
  });
});
