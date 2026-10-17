import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  backupFileName,
  backupsToDelete,
  createDataBackup,
  listBackupNames,
  shouldSkipBootBackup
} from "../src/bot/services/backupService.js";

// 9.18yy — sauvegarde quotidienne du data-dir (recommandation audit 16/10).
// Les fonctions pures sont testées à plat ; createDataBackup est testé sur
// un vrai dossier temporaire (tar est présent sur Linux, VPS comme CI).

describe("9.18yy — backupFileName (pur)", () => {
  it("produit le format data-YYYYMMDD-HHmmss.tar.gz", () => {
    const name = backupFileName(new Date(2026, 9, 17, 4, 15, 9));
    expect(name).toBe("data-20261017-041509.tar.gz");
  });

  it("reste stable pour un instant fixé", () => {
    const now = new Date(2026, 0, 2, 23, 5, 0);
    expect(backupFileName(now)).toBe(backupFileName(now));
  });
});

describe("9.18yy — backupsToDelete (rétention, pur)", () => {
  it("garde les keep plus récentes, purge les autres", () => {
    const names = ["data-20261010-040000.tar.gz", "data-20261011-040000.tar.gz", "data-20261012-040000.tar.gz", "data-20261013-040000.tar.gz"];
    expect(backupsToDelete(names, 2)).toEqual(["data-20261010-040000.tar.gz", "data-20261011-040000.tar.gz"]);
  });

  it("ne purge rien tant que le compte tient", () => {
    expect(backupsToDelete(["data-20261010-040000.tar.gz"], 7)).toEqual([]);
    expect(backupsToDelete([], 7)).toEqual([]);
  });

  it("trie avant de trancher et ignore les noms invalides", () => {
    const names = ["data-20261013-040000.tar.gz", "data-20261011-040000.tar.gz", "notes.txt", "data-20261012-040000.tar.gz"];
    expect(backupsToDelete(names, 1)).toEqual(["data-20261011-040000.tar.gz", "data-20261012-040000.tar.gz"]);
  });

  it("keep minimum 1 (jamais 0 ni négatif)", () => {
    const names = ["data-20261010-040000.tar.gz", "data-20261011-040000.tar.gz"];
    expect(backupsToDelete(names, 0)).toEqual(["data-20261010-040000.tar.gz"]);
  });
});

describe("9.18yy — shouldSkipBootBackup (anti-spam redémarrage, pur)", () => {
  it("saute si la dernière sauvegarde a moins de 12 h", () => {
    const now = Date.now();
    expect(shouldSkipBootBackup(now - 3 * 3600 * 1000, now)).toBe(true);
    expect(shouldSkipBootBackup(now - 11 * 3600 * 1000, now)).toBe(true);
  });

  it("ne saute pas si elle est plus vieille (ou inconnue)", () => {
    const now = Date.now();
    expect(shouldSkipBootBackup(now - 13 * 3600 * 1000, now)).toBe(false);
    expect(shouldSkipBootBackup(null, now)).toBe(false);
  });
});

describe("9.18yy — createDataBackup (IO, dossier temporaire réel)", () => {
  const makeDataDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-backup-test-"));
    fs.writeFileSync(path.join(dir, "quota.json"), JSON.stringify({ used: 3 }));
    fs.writeFileSync(path.join(dir, "voice-mode.json"), JSON.stringify({ on: true }));
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    return dir;
  };

  it("archive l'état, exclut backups/, et journalise la taille", async () => {
    const dir = makeDataDir();
    try {
      const res = await createDataBackup({ dataDir: dir, keep: 7, now: new Date(2026, 9, 17, 4, 15, 0) });
      expect(res.ok).toBe(true);
      expect(res.file).toBe("data-20261017-041500.tar.gz");
      expect(res.bytes).toBeGreaterThan(0);
      expect(res.pruned).toEqual([]);

      const out = path.join(dir, "backups", res.file!);
      expect(fs.existsSync(out)).toBe(true);
      // Le contenu de l'archive : les états, PAS le dossier backups.
      const listing = execFileSync("tar", ["-tzf", out], { encoding: "utf8" });
      expect(listing).toContain("quota.json");
      expect(listing).toContain("voice-mode.json");
      expect(listing).not.toContain("backups/data-");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("purge au-delà de la rétention", async () => {
    const dir = makeDataDir();
    try {
      // 3 sauvegardes existantes + 1 nouvelle, keep=2 → 2 purgées.
      for (const n of ["data-20261014-040000.tar.gz", "data-20261015-040000.tar.gz", "data-20261016-040000.tar.gz"]) {
        fs.writeFileSync(path.join(dir, "backups", n), "old");
      }
      const res = await createDataBackup({ dataDir: dir, keep: 2, now: new Date(2026, 9, 17, 4, 15, 0) });
      expect(res.ok).toBe(true);
      expect(res.pruned).toEqual(["data-20261014-040000.tar.gz", "data-20261015-040000.tar.gz"]);
      const remaining = listBackupNames(path.join(dir, "backups"));
      expect(remaining).toEqual(["data-20261016-040000.tar.gz", "data-20261017-041500.tar.gz"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("échoue honnêtement (sans jeter) si le dossier est absent", async () => {
    const res = await createDataBackup({ dataDir: path.join(os.tmpdir(), "nebula-backup-absent-xyz"), keep: 7 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.pruned).toEqual([]);
  });
});

describe("9.18yy — listBackupNames (IO)", () => {
  it("filtre les noms invalides et trie anciens → récents", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-backup-list-"));
    try {
      for (const n of ["data-20261012-040000.tar.gz", "whatever.tar.gz", "data-20261011-040000.tar.gz", "data-20261013-040000.tar.gz.txt"]) {
        fs.writeFileSync(path.join(dir, n), "x");
      }
      expect(listBackupNames(dir)).toEqual(["data-20261011-040000.tar.gz", "data-20261012-040000.tar.gz"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dossier absent → liste vide (pas de crash)", () => {
    expect(listBackupNames(path.join(os.tmpdir(), "nebula-backup-nope-xyz"))).toEqual([]);
  });
});
