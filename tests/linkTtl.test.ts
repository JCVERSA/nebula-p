import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 8.83 — TTL glissant des liens de téléchargement.
 *
 * Décisions owner : les liens expirent après 30 min d'INACTIVITÉ (au lieu
 * de 2 h fixes) pour limiter l'occupation disque ; chaque téléchargement
 * relance le délai ; la vie TOTALE d'un lien reste plafonnée à 2 h
 * (préserve l'invariant multi-bots du scan orphelin : seuil 3 h > vie 2 h).
 * Plafond du dossier livré abaissé à 2 Go (conteneurs 7-8 Go).
 *
 * Le store vit dans NEBULA_DATA_DIR + os.tmpdir() → env isolée AVANT
 * l'import dynamique du module (comme les tests 8.80).
 */

const ORIGINAL_ENV = { ...process.env };
let tmpDataDir: string;
let mod: typeof import("../src/bot/tempDownloadManager.js");

function writeSourceFile(name: string, bytes: number): string {
  const p = path.join(tmpDataDir, `${name}.bin`);
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
}

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  tmpDataDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp", "linkttl-"));
  process.env.NEBULA_DATA_DIR = tmpDataDir;
  delete process.env.NEBULA_LINK_TTL_MIN;
  delete process.env.NEBULA_TEMP_MAX_BYTES;
  mod = await import("../src/bot/tempDownloadManager.js");
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

describe("getLinkTtlMinutes — TTL glissant par défaut", () => {
  it("défaut 30 min, borné [5, 120]", () => {
    expect(mod.getLinkTtlMinutes()).toBe(30);
    process.env.NEBULA_LINK_TTL_MIN = "3";
    expect(mod.getLinkTtlMinutes()).toBe(5); // plancher
    process.env.NEBULA_LINK_TTL_MIN = "999";
    expect(mod.getLinkTtlMinutes()).toBe(120); // plafond
    process.env.NEBULA_LINK_TTL_MIN = "15";
    expect(mod.getLinkTtlMinutes()).toBe(15);
    process.env.NEBULA_LINK_TTL_MIN = "abc";
    expect(mod.getLinkTtlMinutes()).toBe(30); // invalide → défaut
  });
});

describe("registerTempDownload — TTL appliqué à la création", () => {
  it("défaut = TTL glissant (30 min), plus 120 fixes", () => {
    const src = writeSourceFile("ep1", 1024);
    const rec = mod.registerTempDownload(src, "ep1.mp4", { moveFile: true });
    expect(rec.ttlMinutes).toBe(30);
    expect(rec.expiresAt).toBeGreaterThan(Date.now());
  });

  it("valeur explicite honorée et bornée [5, 120] (compat callers/tests)", () => {
    const s1 = writeSourceFile("ep2", 1024);
    expect(mod.registerTempDownload(s1, "ep2.mp4", { ttlMinutes: 60, moveFile: true }).ttlMinutes).toBe(60);
    const s2 = writeSourceFile("ep3", 1024);
    expect(mod.registerTempDownload(s2, "ep3.mp4", { ttlMinutes: 180, moveFile: true }).ttlMinutes).toBe(120);
  });

  it("plafond du dossier livré : défaut 2 Go (petits conteneurs), env respecté", () => {
    const src = fs.readFileSync("src/bot/tempDownloadManager.ts", "utf-8");
    expect(src).toContain("2 * 1024 * 1024 * 1024");
    expect(src).not.toContain("4 * 1024 * 1024 * 1024)");
    // .env.example aligné
    const env = fs.readFileSync(".env.example", "utf-8");
    expect(env).toContain('NEBULA_TEMP_MAX_BYTES="2147483648"');
  });
});

describe("touchTempDownload — glissement par téléchargement (temps contrôlé)", () => {
  const T0 = new Date("2026-09-26T12:00:00Z").getTime();
  const at = (min: number) => vi.setSystemTime(new Date(T0 + min * 60 * 1000));

  it("prolonge un lien vivant du TTL courant (30 min après le dernier clic)", () => {
    vi.useFakeTimers();
    at(0);
    const s = writeSourceFile("live", 1024);
    const rec = mod.registerTempDownload(s, "live.mp4", { moveFile: true });
    const before = rec.expiresAt; // T0 + 30 min

    at(10); // l'utilisateur télécharge 10 min plus tard
    expect(mod.touchTempDownload(rec.token)).toBe(true);
    expect(mod.getTempDownload(rec.token)!.expiresAt).toBe(before + 10 * 60 * 1000); // T0+40

    at(25); // encore 15 min plus tard
    expect(mod.touchTempDownload(rec.token)).toBe(true);
    expect(mod.getTempDownload(rec.token)!.expiresAt).toBe(before + 25 * 60 * 1000); // T0+55
  });

  it("ne dépasse JAMAIS createdAt + 2 h (vie totale plafonnée)", () => {
    vi.useFakeTimers();
    at(0);
    const s = writeSourceFile("capped", 1024);
    // TTL explicite 120 min : création à T0, vie totale = T0+2 h.
    const rec = mod.registerTempDownload(s, "capped.mp4", { ttlMinutes: 120, moveFile: true });
    const expectedCap = rec.expiresAt; // == T0 + 120 min

    at(90); // maintenant now+30 min == cap pile
    expect(mod.touchTempDownload(rec.token)).toBe(true);
    expect(mod.getTempDownload(rec.token)!.expiresAt).toBe(expectedCap);

    at(95); // même en re-téléchargeant, pas un ms de plus
    expect(mod.touchTempDownload(rec.token)).toBe(true);
    expect(mod.getTempDownload(rec.token)!.expiresAt).toBe(expectedCap);
  });

  it("ne ressuscite pas un lien expiré ni un jeton inconnu", () => {
    vi.useFakeTimers();
    expect(mod.touchTempDownload("jeton-inconnu")).toBe(false);

    at(0);
    const s = writeSourceFile("dead", 1024);
    const rec = mod.registerTempDownload(s, "dead.mp4", { moveFile: true }); // TTL 30
    at(31); // expiré depuis 1 min
    expect(mod.touchTempDownload(rec.token)).toBe(false);
    // getTempDownload a purgé le record expiré et son fichier.
    expect(mod.getTempDownload(rec.token)).toBeNull();
    expect(fs.existsSync(rec.filePath)).toBe(false);
  });
});

describe("scan orphelin — épargne les fichiers à record vivant (multi-bots)", () => {
  it("un fichier VIEUX mais vivant (record présent) n'est pas purgé", () => {
    const s = writeSourceFile("oldbutalive", 2048);
    const rec = mod.registerTempDownload(s, "oldbutalive.mp4", { moveFile: true });
    // Vieillir le FICHIER au-delà du seuil orphelin (3 h) — le record reste
    // vivant : c'est la situation cross-moteur où un autre engine sert
    // encore le fichier (dossier partagé). Le scan ne doit PAS le toucher.
    const oldTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    fs.utimesSync(rec.filePath, oldTime, oldTime);

    mod.cleanupExpiredZipFiles();
    expect(fs.existsSync(rec.filePath)).toBe(true);
    expect(mod.getTempDownload(rec.token)).not.toBeNull();
  });

  it("un vrai orphelin (sans record) est toujours purgé à 3 h", () => {
    const orphanDir = path.join(os.tmpdir(), "nebula_temp_downloads");
    fs.mkdirSync(orphanDir, { recursive: true });
    const orphan = path.join(orphanDir, "orphelin_debris.mp4");
    fs.writeFileSync(orphan, Buffer.alloc(512, 1));
    const oldTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    fs.utimesSync(orphan, oldTime, oldTime);

    mod.cleanupExpiredZipFiles();
    expect(fs.existsSync(orphan)).toBe(false);
  });
});

describe("câblage 8.83", () => {
  it("app.ts touche le lien à chaque téléchargement servi", () => {
    const src = fs.readFileSync("app.ts", "utf-8");
    expect(src).toContain("touchTempDownload(token)");
    expect(src).toContain("touchTempDownload,");
  });

  it("novabox n'a plus de TTL codé dur (120/180) et affiche le TTL dynamique", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).not.toContain("ttlMinutes: 120");
    expect(src).not.toContain("ttlMinutes: 180");
    expect(src.match(/\$\{getLinkTtlMinutes\(\)\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("batchZipManager laisse le défaut glissant s'appliquer", () => {
    const src = fs.readFileSync("src/bot/services/batchZipManager.ts", "utf-8");
    expect(src).not.toContain("ttlMinutes = 60");
  });

  it("la fiche IA décrit le TTL glissant (l'IA reste exacte)", () => {
    const src = fs.readFileSync("src/bot/commandKnowledge.ts", "utf-8");
    expect(src).toContain("30 min d'inactivité");
    expect(src).toContain("chaque téléchargement relance le délai");
    expect(src).not.toContain("expirent après 2 h (archive ZIP");
  });
});
