/**
 * 9.18uuu — le registre des téléchargements survit au crash (sidecars JSON).
 *
 * Terrain 18/10 : le moteur était OOM-tué juste après la livraison des liens
 * (HTML « Tout télécharger »). Au redémarrage, la purge boot supprimait les
 * fichiers « orphelins » — leur record vivait en mémoire — donc l'owner
 * perdait TOUT sans avoir purgé, et devait attendre le redémarrage pour
 * rien : les liens étaient morts.
 *
 * Désormais : chaque record vit dans <tmp>/nebula_temp_downloads/<token>.json
 * (écriture atomique) ; au boot on RESTAURE les records vivants AVANT de
 * purger, et la purge ne touche plus les fichiers restaurés ni les sidecars.
 *
 * Pattern hermétique (comme tempDownloadPurge.test.ts) : TMPDIR privé réservé
 * AVANT l'import dynamique du module — os.tmpdir() se résout à l'appel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const hermeticTmp = fs.mkdtempSync(path.join(os.tmpdir(), "temp-persist-"));
process.env.TMPDIR = hermeticTmp;
process.env.NEBULA_CLAIMS_DIR = path.join(hermeticTmp, "claims");
fs.mkdirSync(process.env.NEBULA_CLAIMS_DIR, { recursive: true });

const TEMP_DIR = () => path.join(hermeticTmp, "nebula_temp_downloads");

async function loadManager() {
  vi.resetModules();
  return await import("../src/bot/tempDownloadManager.js");
}

function writeSourceFile(name: string, bytes = 2048): string {
  const p = path.join(hermeticTmp, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

beforeEach(() => {
  // Nettoyage du coffre entre tests (pas de state partagé).
  fs.rmSync(TEMP_DIR(), { recursive: true, force: true });
});

describe("9.18uuu — sidecars : les liens livrés survivent au crash", () => {
  it("register écrit un sidecar ; crash simulé (module rechargé) → le lien est RESTAURÉ et sert le fichier", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("episode.mp4");
    const reg = mod.registerTempDownload(src, "Episode_01.mp4", { ttlMinutes: 30 });

    // Le sidecar existe sur disque à côté du fichier.
    expect(fs.existsSync(path.join(TEMP_DIR(), `${reg.token}.json`))).toBe(true);

    // CRASH simulé : nouvelle instance du module (Map vide), même disque.
    const mod2 = await loadManager();
    expect(mod2.getTempDownload(reg.token)).toBeNull(); // registry en mémoire perdu…

    const restored = mod2.loadPersistedTempRegistry(); // …et ressuscité par les sidecars
    expect(restored).toBe(1);
    const rec = mod2.getTempDownload(reg.token);
    expect(rec).not.toBeNull();
    expect(rec!.filename).toBe("Episode_01.mp4");
    expect(fs.existsSync(rec!.filePath)).toBe(true); // le fichier est TOUJOURS là

    // La purge boot ne touche NI le fichier restauré NI le sidecar.
    mod2.purgeStartupOrphans();
    expect(fs.existsSync(rec!.filePath)).toBe(true);
    expect(fs.existsSync(path.join(TEMP_DIR(), `${reg.token}.json`))).toBe(true);
  });

  it("la purge boot supprime toujours les VRAIS orphelins (fichier sans sidecar)", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("episode.mp4");
    const reg = mod.registerTempDownload(src, "Episode_01.mp4", { ttlMinutes: 30 });
    const orphan = path.join(TEMP_DIR(), "deadbeef_orphan_de_crash.mp4");
    fs.writeFileSync(orphan, Buffer.alloc(1024, 1));

    const mod2 = await loadManager();
    mod2.loadPersistedTempRegistry();
    mod2.purgeStartupOrphans();

    expect(fs.existsSync(orphan)).toBe(false); // vrai orphelin → purgé
    const rec = mod2.getTempDownload(reg.token);
    expect(rec).not.toBeNull(); // lien restauré → intact
  });

  it("sidecar périmé (TTL dépassé) au boot → record ET fichier nettoyés", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("episode.mp4");
    const reg = mod.registerTempDownload(src, "Episode_01.mp4", { ttlMinutes: 30 });
    // Vieille le TTL : on vieillit le sidecar (createdAt/expiresAt au passé).
    const sidecar = path.join(TEMP_DIR(), `${reg.token}.json`);
    const aged = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    aged.createdAt = Date.now() - 3 * 60 * 60 * 1000;
    aged.expiresAt = Date.now() - 30 * 60 * 1000;
    fs.writeFileSync(sidecar, JSON.stringify(aged));

    const mod2 = await loadManager();
    expect(mod2.loadPersistedTempRegistry()).toBe(0);
    expect(mod2.getTempDownload(reg.token)).toBeNull();
    // Le fichier périmé est emporté par le load (plus personne ne le sert).
    expect(fs.existsSync(path.join(TEMP_DIR(), `${reg.token}_Episode_01.mp4`))).toBe(false);
  });

  it("noCopy (cache de réutilisation) : PAS de sidecar — cycle de vie du cache", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("cache-file.mp4");
    const reg = mod.registerTempDownload(src, "Cached.mp4", { noCopy: true });
    expect(fs.existsSync(path.join(TEMP_DIR(), `${reg.token}.json`))).toBe(false);
    expect(fs.existsSync(reg.filePath)).toBe(true); // servi tel quel, jamais purgé comme orphelin du coffre
  });

  it("touch (TTL glissant) met le sidecar à jour — le nouveau délai survit aussi", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("episode.mp4");
    const reg = mod.registerTempDownload(src, "Episode_01.mp4", { ttlMinutes: 30 });
    expect(mod.touchTempDownload(reg.token)).toBe(true);
    const sidecar = JSON.parse(fs.readFileSync(path.join(TEMP_DIR(), `${reg.token}.json`), "utf-8"));
    expect(sidecar.expiresAt).toBeGreaterThan(Date.now() + 25 * 60 * 1000); // délai relancé

    const mod2 = await loadManager();
    mod2.loadPersistedTempRegistry();
    expect(mod2.getTempDownload(reg.token)).not.toBeNull();
  });

  it("purge explicite (purgeTempRecords) emporte le sidecar : plus de résurrection fantôme", async () => {
    const mod = await loadManager();
    const src = writeSourceFile("episode.mp4");
    const reg = mod.registerTempDownload(src, "Episode_01.mp4", { ttlMinutes: 30 });
    mod.purgeTempRecords([reg.token]);

    const mod2 = await loadManager();
    expect(mod2.loadPersistedTempRegistry()).toBe(0);
    expect(fs.existsSync(path.join(TEMP_DIR(), `${reg.token}.json`))).toBe(false);
  });
});
