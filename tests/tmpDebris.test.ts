import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DEBRIS_FILE_EXTENSIONS,
  PROTECTED_ROOT_NAMES,
  TMP_DEBRIS_PREFIXES,
  isTmpRootDebrisCandidate,
  planTmpRootDebris,
  scanTmpRoot,
  type TmpRootEntry
} from "../src/bot/services/tmpDebris.js";

/**
 * 8.90 — patterns des débris animés à la racine du tmpdir.
 *
 * Source de vérité partagée par les TROIS nettoyeurs (.purge owner, nettoyage
 * périodique 3 h, purge au boot âge 0). Retour terrain : les épisodes .mp4
 * racine (batch_*, nom d'anime brut) n'étaient couverts par personne.
 */

const mkEntry = (name: string, mtimeMs: number, opts: Partial<TmpRootEntry> = {}): TmpRootEntry => ({
  name,
  fullPath: `/tmp/${name}`,
  mtimeMs,
  isDir: false,
  sizeBytes: 1024,
  ...opts
});

describe("8.90 — isTmpRootDebrisCandidate : classification", () => {
  it("chaque préfixe connu est un candidat (fichier OU dossier)", () => {
    for (const p of TMP_DEBRIS_PREFIXES) {
      expect(isTmpRootDebrisCandidate(`${p}123_Anime_E01.mp4`, false)).toBe(true);
      expect(isTmpRootDebrisCandidate(`${p}workdir`, true)).toBe(true);
    }
  });

  it("filet média : un fichier vidéo/audio/zip SANS préfixe est un candidat (épisode single)", () => {
    for (const ext of DEBRIS_FILE_EXTENSIONS) {
      expect(isTmpRootDebrisCandidate(`Mushoku_Tensei_S03E13_480P${ext}`, false)).toBe(true);
    }
  });

  it("un fichier non-média sans préfixe n'est PAS candidat (json de cache, txt, inconnu)", () => {
    expect(isTmpRootDebrisCandidate("franime-catalog.json", false)).toBe(false);
    expect(isTmpRootDebrisCandidate("notes.txt", false)).toBe(false);
    expect(isTmpRootDebrisCandidate("sans-extension", false)).toBe(false);
  });

  it("un dossier inconnu sans préfixe n'est PAS candidat", () => {
    expect(isTmpRootDebrisCandidate("un-truc-aleatoire", true)).toBe(false);
    expect(isTmpRootDebrisCandidate("systemd-private", true)).toBe(false);
  });

  it("les noms protégés ne sont JAMAIS candidats (store, claims)", () => {
    for (const name of PROTECTED_ROOT_NAMES) {
      expect(isTmpRootDebrisCandidate(name, true)).toBe(false);
      expect(isTmpRootDebrisCandidate(name, false)).toBe(false);
    }
  });
});

describe("8.90 — planTmpRootDebris : politiques d'âge et fenêtre claims", () => {
  const now = 2_000_000_000_000;

  it("minAgeMs 0 (boot) : tout candidat hors fenêtre est purgé", () => {
    const plan = planTmpRootDebris([mkEntry("batch_1_A_E01.mp4", now - 1000)], { liveClaims: [], now, minAgeMs: 0 });
    expect(plan.toDelete).toHaveLength(1);
    expect(plan.spared).toBe(0);
  });

  it("minAgeMs 3 h (nettoyage périodique) : un débris d'1 h est épargné", () => {
    const plan = planTmpRootDebris([mkEntry("batch_1_A_E01.mp4", now - 60 * 60 * 1000)], {
      liveClaims: [],
      now,
      minAgeMs: 3 * 60 * 60 * 1000
    });
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.spared).toBe(1);
  });

  it("minAgeMs 5 min (.purge) : un débris de 10 min est purgé, un de 2 min épargné", () => {
    const plan = planTmpRootDebris(
      [mkEntry("vieux.mp4", now - 10 * 60 * 1000), mkEntry("frais.mp4", now - 2 * 60 * 1000)],
      { liveClaims: [], now, minAgeMs: 5 * 60 * 1000 }
    );
    expect(plan.toDelete.map(e => e.name)).toEqual(["vieux.mp4"]);
    expect(plan.spared).toBe(1);
  });

  it("fenêtre claims : un débris créé PENDANT un batch vivant est épargné, même vieux pour la politique", () => {
    const claim = { jobId: "job-live", createdAt: now - 30 * 60 * 1000 };
    const plan = planTmpRootDebris([mkEntry("pendant.mp4", now - 20 * 60 * 1000)], {
      liveClaims: [claim],
      now,
      minAgeMs: 0 // même la politique la plus agressive épargne la fenêtre
    });
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.spared).toBe(1);
  });
});

describe("8.90 — scanTmpRoot : scan réel d'un répertoire", () => {
  it("ne retourne QUE les candidats, avec leurs stat réels", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmpdebris-scan-"));
    try {
      fs.writeFileSync(path.join(dir, "batch_1_A_E01.mp4"), "x");
      fs.writeFileSync(path.join(dir, "Anime_Single_E02.mkv"), "x");
      fs.writeFileSync(path.join(dir, "franime-catalog.json"), "{}");
      fs.mkdirSync(path.join(dir, "nebula_temp_downloads"));
      fs.mkdirSync(path.join(dir, "dossier-inconnu"));
      fs.mkdirSync(path.join(dir, "cat_catch_staging"));

      const found = scanTmpRoot(dir).map(e => e.name).sort();
      expect(found).toEqual(["Anime_Single_E02.mkv", "batch_1_A_E01.mp4", "cat_catch_staging"]);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it("répertoire inexistant → liste vide, pas de crash", () => {
    expect(scanTmpRoot("/chemin/qui/nexiste/pas")).toEqual([]);
  });
});

describe("8.90 — intégration structurelle : les trois nettoyeurs branchés", () => {
  const read = (f: string): string => fs.readFileSync(path.resolve(process.cwd(), "src", f), "utf8");

  it("tempDownloadManager : nettoyage périodique (3 h) ET purge au boot (âge 0) utilisent le module", () => {
    const src = read("bot/tempDownloadManager.ts");
    expect(src).toContain("minAgeMs: ORPHAN_MAX_AGE_MS"); // périodique : 3 h
    expect(src).toContain("minAgeMs: 0"); // boot
    expect((src.match(/planTmpRootDebris\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("diskPurge (.purge) : scanTmpRoot + politique de grâce 5 min", () => {
    const src = read("bot/services/diskPurge.ts");
    expect(src).toContain("scanTmpRoot(stagingRoot)");
    expect(src).toContain("minAgeMs: PURGE_GRACE_MS");
  });

  it("l'appel à l'import est désactivé sous vitest (workers parallèles protégés)", () => {
    const src = read("bot/tempDownloadManager.ts");
    expect(src).toContain("if (!process.env.VITEST)");
  });
});
