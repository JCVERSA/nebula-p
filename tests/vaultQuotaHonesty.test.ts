/**
 * 9.18yyy — un coffre plein ne ment plus « la source les refuse ».
 *
 * Terrain 18/10, run 2 (build xxx) : les liens du run 1 (1,81 Go) restaient
 * vivants dans le coffre — sidecars uuu restaurés au boot — quand le batch
 * a redescendu E05-E08. registerTempDownload a jeté « quota reached »
 * (plafond 2 Go) pour E05 (725 Mo), E07 (90 Mo) et E08 (710 Mo) : E06 était
 * passé à 56 Mo près, E7 dépassait de 33 Mo. Le catch générique comptait
 * ces épisodes « refusés par la source » — faux, la source avait livré — et
 * bot.log ne montrait RIEN (mensonge par omission).
 *
 * Correctifs testés ici :
 * 1. wouldExceedTempQuota : lecture pure du plafond (chemin prudent).
 * 2. Le fallback noCopy : le fichier vient d'entrer au cache de
 *    réutilisation → lien servi TEL QUEL, zéro octet de coffre.
 * 3. Le wiring novabox : défér honnête + ligne « Coffre de livraison
 *    plein » + différés exclus des « Épisodes échoués » + qualité réelle
 *    annoncée seulement pour les liens réellement livrés.
 *
 * Pattern hermétique (comme tempDownloadPersistence.test.ts) : TMPDIR privé
 * réservé AVANT l'import dynamique du module — os.tmpdir() se résout à
 * l'appel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const hermeticTmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-quota-"));
process.env.TMPDIR = hermeticTmp;
process.env.NEBULA_CLAIMS_DIR = path.join(hermeticTmp, "claims");
fs.mkdirSync(process.env.NEBULA_CLAIMS_DIR, { recursive: true });

const TEMP_DIR = () => path.join(hermeticTmp, "nebula_temp_downloads");

async function loadManager() {
  vi.resetModules();
  return await import("../src/bot/tempDownloadManager.js");
}

function writeSourceFile(name: string, bytes: number): string {
  const p = path.join(hermeticTmp, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

beforeEach(() => {
  fs.rmSync(TEMP_DIR(), { recursive: true, force: true });
  delete process.env.NEBULA_TEMP_MAX_BYTES;
});

afterEach(() => {
  delete process.env.NEBULA_TEMP_MAX_BYTES;
});

describe("9.18yyy — wouldExceedTempQuota (lecture pure, jamais de throw)", () => {
  it("coffre vide : un épisode terrain de 725 Mo passe", async () => {
    const mod = await loadManager();
    expect(mod.wouldExceedTempQuota(725_592_829)).toBe(false);
  });

  it("coffre proche du plafond : détecté AVANT register (plus d'erreur muette)", async () => {
    const mod = await loadManager();
    process.env.NEBULA_TEMP_MAX_BYTES = String(1024 * 1024); // 1 Mo pour le test
    const src = writeSourceFile("a.mp4", 600 * 1024);
    mod.registerTempDownload(src, "a.mp4", { moveFile: true }); // 600 Ko entrent au coffre
    expect(mod.wouldExceedTempQuota(600 * 1024)).toBe(true); // 600 + 600 > 1 Mo
    expect(mod.wouldExceedTempQuota(400 * 1024)).toBe(false); // 600 + 400 ≤ 1 Mo
    // le register classique jette toujours (le prédicat ne change pas la garde)
    const big = writeSourceFile("b.mp4", 600 * 1024);
    expect(() => mod.registerTempDownload(big, "b.mp4", { moveFile: true })).toThrow(/quota/);
  });

  it("noCopy ne compte pas dans le quota du coffre (cap dédié du cache de réutilisation)", async () => {
    const mod = await loadManager();
    process.env.NEBULA_TEMP_MAX_BYTES = String(1024 * 1024);
    const src = writeSourceFile("c.mp4", 600 * 1024);
    const rec = mod.registerTempDownload(src, "c.mp4", { moveFile: true });
    // le MÊME fichier servi sans copie (chemin du cache) passe alors que le
    // coffre est plein — c'est le fallback qui sauve l'épisode différé.
    const noCopy = mod.registerTempDownload(rec.filePath, "c.mp4", { noCopy: true });
    expect(noCopy.filePath).toBe(rec.filePath);
    expect(mod.wouldExceedTempQuota(600 * 1024)).toBe(true); // le coffre n'a pas bougé d'un octet
  });
});

describe("9.18yyy — wiring novabox : le refus de coffre est honnête (source pins)", () => {
  const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");

  it("chemin prudent : wouldExceedTempQuota AVANT register, fallback noCopy depuis le cache", () => {
    expect(src).toContain("wouldExceedTempQuota(episodeBytes)");
    expect(src).toContain("const cachedNow = lookupMediaReuse(reuseKeyFor(epNum));");
    expect(src).toContain("registerTempDownload(cachedNow.filePath, filename, { noCopy: true, jobId: batchJob.id })");
    expect(src).toContain("zéro octet de coffre");
  });

  it("défér honnête : le quota est classifié dans le catch, jamais compté « refusé »", () => {
    expect(src).toContain('String(err?.message || "").includes("Temporary download storage quota")');
    expect(src).toContain("deferForFullVault(caughtBytes)");
    expect(src).toContain("vaultDeferredEpisodes.push({ epNum, sizeMB: Math.round(sizeBytes / 1e6) })");
  });

  it("rapport : ligne « Coffre de livraison plein » + différés exclus des « Épisodes échoués »", () => {
    expect(src).toContain("Coffre de livraison plein :");
    expect(src).toContain("Ce n'est pas la source qui refuse");
    expect(src).toContain(".filter(n => !vaultDeferredSet.has(n))");
    expect(src).toContain("const attemptedEpNums = indices");
  });

  it("qualité réelle annoncée SEULEMENT pour les liens livrés (run 2 : liens fantômes)", () => {
    expect(src).toContain("const deliveredLies = qualityLies.filter(q => deliveredEpSet.has(q.epNum));");
    expect(src).toContain("deliveredLies.length > 0");
    expect(src).toContain("liens étiquetés avec la qualité réelle");
  });

  it("honnêteté qualité AUSSI depuis le cache (E08 1080P resservi « 480P » au run suivant)", () => {
    expect(src).toContain("fastLaneMismatch(resolution, cachedEp.bytes, null)");
    expect(src).toContain("fastLaneMismatch(resolution, cachedEp.bytes, probedCache.height)");
    expect(src).toContain("let cacheFilename = filename;");
  });
});

describe("9.18cccc — audit : le flux SINGLE a le même chemin prudent que le batch", () => {
  const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");

  it("coffre plein en single : lien noCopy depuis le cache (plus de livraison SANS lien >100 Mo)", () => {
    expect(src).toContain("const cachedSingleNow = lookupMediaReuse(reuseKeyFor(epNum));");
    expect(src).toContain("registerTempDownload(cachedSingleNow.filePath, deliveredFilename, { noCopy: true })");
    expect(src).toContain("épisode servi sans copie depuis le cache de réutilisation");
  });

  it("l'ordre est bon : store au cache AVANT la pré-vérification du quota", () => {
    const storePos = src.indexOf("storeMediaReuse(reuseKeyFor(epNum), activeSendPath, deliveredFilename)");
    const checkPos = src.indexOf("wouldExceedTempQuota(singleBytes)");
    expect(storePos).toBeGreaterThan(-1);
    expect(checkPos).toBeGreaterThan(storePos);
  });
});
