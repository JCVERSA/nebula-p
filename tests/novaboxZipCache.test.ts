import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * 9.18m — audit complet Novabox (13/10) : correctifs Z1 + Z2.
 *
 *  Z1 (critique, actif sur le VPS où NEBULA_BATCH_ZIP=1) : le ZIP de saison
 *  était construit par generatedLinks.map((item, idx) =>
 *  downloadedFilePaths[idx]) — or les épisodes servis par le CACHE 24 h (9.15)
 *  alimentent generatedLinks SANS alimenter downloadedFilePaths. Dès le
 *  premier hit cache, tous les fichiers suivants étaient décalés d'un cran :
 *  épisode 2 étiqueté 1, et les dernières entrées pointaient sur undefined.
 *  Fix : liste APPARIÉE zipEpisodeFiles ({ epNum, filePath }) alimentée par
 *  les DEUX chemins (cache + téléchargement frais) — et le ZIP inclut
 *  désormais les épisodes cachés (lien physique, zéro octet).
 *
 *  Z2 (cosmétique) : l'écran « liens directs » (single_stream_choice, choix 2)
 *  codait _1080P_ en dur dans le nom de fichier même quand la détection
 *  avait trouvé une autre résolution.
 *
 * Tests structurels (le moteur WhatsApp ne se lance pas en CI) — même
 * convention que fieldFixes.test.ts.
 */

const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");

describe("9.18m Z1 — ZIP de saison : plus de désalignement cache/téléchargement", () => {
  it("l'ancienne construction par index décalé a disparu", () => {
    expect(src).not.toContain("filePath: downloadedFilePaths[idx]");
    expect(src).not.toContain("generatedLinks.map((item, idx)");
    expect(src).not.toContain("downloadedFilePaths.push(");
    expect(src).not.toContain("downloadedFilePaths.length");
  });

  it("la liste ZIP est APPARIÉE (epNum ↔ filePath), pas un tableau de chemins nus", () => {
    expect(src).toContain(
      "const zipEpisodeFiles: Array<{ epNum: number; filePath: string }> = [];"
    );
  });

  it("le chemin CACHÉ alimente le ZIP (les hits 24 h ne sont plus exclus de l'archive)", () => {
    const cachedPush = src.indexOf("zipEpisodeFiles.push({ epNum, filePath: cachedEp.filePath })");
    const cacheHit = src.indexOf("const cachedEp = lookupMediaReuse(reuseKeyFor(epNum));");
    expect(cacheHit).toBeGreaterThan(-1);
    expect(cachedPush).toBeGreaterThan(cacheHit); // poussé DANS la branche cache
    // et avant la fin de cette branche (le return du cache est APRÈS le push)
    const cacheBranchReturn = src.indexOf("cacheHits++", cachedPush);
    expect(cacheBranchReturn).toBeGreaterThan(cachedPush);
  });

  it("le chemin TÉLÉCHARGÉ alimente la même liste appariée", () => {
    const freshPush = src.indexOf("zipEpisodeFiles.push({ epNum, filePath: tempDownload.filePath })");
    const register = src.indexOf("registerTempDownload(localPath, filename, {", freshPush - 4000);
    expect(freshPush).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(-1);
    expect(freshPush).toBeGreaterThan(register); // après l'enregistrement du fichier mové
  });

  it("la porte ZIP et le compteur de packaging utilisent la liste appariée", () => {
    expect(src).toContain("batchZipEnabled && zipEpisodeFiles.length > 1");
    expect(src).toContain("Packaging ${zipEpisodeFiles.length} episodes");
    expect(src).toContain(
      "const episodeInputs = zipEpisodeFiles.map((entry) => ({"
    );
    expect(src).toContain("filePath: entry.filePath");
    expect(src).toContain("episodeNumber: entry.epNum");
  });
});

describe("9.18m Z2 — liens directs : le nom de fichier suit la résolution détectée", () => {
  it("plus de _1080P_ codé en dur dans le template du nom de fichier", () => {
    expect(src).not.toContain("${animeClean}_${lang}_1080P_");
  });

  it("le label détecté (repli 1080P) pilote le nom", () => {
    const detected = src.indexOf("detectedResForName");
    const filename = src.indexOf("`${animeClean}_${lang}_${detectedResForName}_");
    expect(detected).toBeGreaterThan(-1);
    expect(filename).toBeGreaterThan(detected);
    // repli honnête si la détection est vide
    expect(src).toMatch(/singleStreamDetected\?\.label[^;]*\|\| "1080P"/);
  });
});

describe("9.18m Z3 — ffmpeg novabox unifié dans runFfmpegKit (stderr visible)", () => {
  it("plus AUCUN spawn ffmpeg brut dans novabox (les deux spawns sont partis)", () => {
    expect(src).not.toContain("spawn(resolvedFfmpegPath");
    expect(src).not.toContain('import { spawn } from "child_process";');
    expect(src).not.toContain('import { resolvedFfmpegPath } from "../ffmpeg.js";');
  });

  it("runFfmpegKit est importé depuis mediaToolkit et pilote les deux chemins", () => {
    expect(src).toMatch(/import \{[^}]*runFfmpegKit[^}]*\} from "\.\.\/services\/mediaToolkit\.js";/);
    expect(src).toContain("await runFfmpegKit(args, timeoutMs)"); // remux HLS de secours
    expect(src).toContain("await runFfmpegKit(ffmpegArgs, 120000)"); // compression WhatsApp-fit
  });

  it("la compression re-encodante porte les flags TS durcis 9.18k (comme videoSlim)", () => {
    expect(src).toContain('"+genpts"');
    expect(src).toContain('"aresample=async=1:first_pts=0"');
    expect(src).toContain('"make_zero"');
  });

  it("le remux -c copy de secours reste SANS filtre audio (exactement une seule occurrence aresample)", () => {
    expect(src.match(/aresample=async=1:first_pts=0/g)?.length).toBe(1);
    expect(src).toContain('"-bsf:a"');
    expect(src).toContain('"aac_adtstoasc"');
  });

  it("les échecs loggent la FIN de stderr (fenêtre glissante), plus jamais muets", () => {
    expect(src).toContain("Legacy network FFmpeg failed: ${res.stderr.slice(-600)}");
    expect(src).toContain("compressRes.stderr.slice(-600)");
  });
});
