import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { orderIgBackends } from "../src/bot/commands/instagram.js";

/**
 * 9.18r — livraison AVEC LIENS des médias Instagram/TikTok.
 *
 * Retour terrain 14/10 04:54 : sept reels livrés sans liens → l'owner a
 * répondu `.up` à chaque vidéo (7 fois) pour en obtenir. Désormais chaque
 * média passe par le serveur (fichier temporaire → store TTL glissant) et
 * la livraison inclut ses liens, comme Novabox.
 */

describe("9.18r — orderIgBackends (mémoire du backend gagnant)", () => {
  it("défaut : igdl d'abord (ordre historique)", () => {
    expect(orderIgBackends(null)).toEqual(["igdl", "igdl2"]);
    expect(orderIgBackends("igdl")).toEqual(["igdl", "igdl2"]);
  });

  it("igdl2 a gagné la dernière fois → essayé en premier (le cas terrain)", () => {
    // Terrain 14/10 : igdl mort, igdl2 a sauvé 7/7 reels — inutile de
    // retenter le mort en premier à chaque requête.
    expect(orderIgBackends("igdl2")).toEqual(["igdl2", "igdl"]);
  });
});

describe("9.18r — service mediaLinkDelivery (structure)", () => {
  const svc = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/mediaLinkDelivery.ts"), "utf-8");

  it("plafond 200 Mo et timeout 60 s — un média ne remplit pas le disque ni ne bloque", () => {
    expect(svc).toContain("MAX_MEDIA_BYTES = 200 * 1024 * 1024");
    expect(svc).toContain("FETCH_TIMEOUT_MS = 60000");
  });

  it("l'échec de téléchargement retombe sur null (l'appelant envoie l'URL distante)", () => {
    expect(svc).toContain("Promise<string | null>");
  });

  it("l'échec d'enregistrement (quota store) retombe sur null, fichier préservé", () => {
    expect(svc).toContain("MediaLinkRecord | null");
    expect(svc).toContain("} catch {");
  });
});

describe("9.18r — Instagram : liens automatiques (structure)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/instagram.ts"), "utf-8");

  it("chaque média est téléchargé localement puis enregistré dans le store", () => {
    expect(src).toContain("await fetchMediaToTempFile(mediaUrl)");
    expect(src).toContain("registerMediaLink(local,");
  });

  it("l'envoi part du fichier du store, avec repli URL distante", () => {
    expect(src).toContain("sendPath = rec.filePath");
    expect(src).toContain("let sendPath = mediaUrl");
    expect(src).toContain("sendPath = local; // quota du store atteint");
  });

  it("UN SEUL message final liste tous les liens (fini les .up manuels)", () => {
    expect(src).toContain("collectedLinks.push(rec.downloadUrl)");
    expect(src).toContain("Liens de téléchargement");
    expect(src).toContain("max 2 h");
  });

  it("le backend gagnant est mémorisé pour la requête suivante", () => {
    expect(src).toContain("lastWorkingIgBackend = label");
    expect(src).toContain("orderIgBackends(lastWorkingIgBackend)");
  });
});

describe("9.18r — TikTok : lien dans la caption (structure)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/tiktok.ts"), "utf-8");

  it("vidéo téléchargée localement, lien ajouté à la caption, repli distant", () => {
    expect(src).toContain("await fetchMediaToTempFile(videoUrl)");
    expect(src).toContain("sendPath = rec.filePath");
    expect(src).toContain("let sendPath = videoUrl");
    expect(src).toContain("🔗 *Lien :*");
  });
});

describe("9.18r — log de nettoyage honnête (un mp4 n'est pas un ZIP)", () => {
  it("le sweeper ne parle plus de « ZIP file(s) » pour des fichiers quelconques", () => {
    const mgr = fs.readFileSync(path.resolve(process.cwd(), "src/bot/tempDownloadManager.ts"), "utf-8");
    expect(mgr).not.toContain("ZIP file(s) deleted");
    expect(mgr).toContain("expired file(s) deleted");
  });
});

describe("9.18s — parité complète : noms lisibles + liens sur YT seul et musique", () => {
  const ig = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/instagram.ts"), "utf-8");
  const tt = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/tiktok.ts"), "utf-8");
  const ytv = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/ytvideo.ts"), "utf-8");
  const song = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/song.ts"), "utf-8");

  it("IG : fichier nommé reel_<shortcode> (plus d'instagram_<timestamp>)", () => {
    expect(ig).toContain("instagramShortcode(text)");
    expect(ig).toContain('`${isVideo ? "reel" : "post"}_${shortcode}`');
    expect(ig).not.toContain("instagram_${Date.now()}");
  });

  it("TikTok : fichier nommé du titre nettoyé (plus de tiktok_<timestamp>)", () => {
    expect(tt).toContain("const safeTitle = (title || author || \"tiktok\")");
    expect(tt).toContain("registerMediaLink(local, `${safeTitle}.mp4`)");
    expect(tt).not.toContain("tiktok_${Date.now()}.mp4");
  });

  it("YTV vidéo seule : lien dans la caption, cache servi sans copie, fichier frais mové", () => {
    expect(ytv).toContain("let singleLink");
    expect(ytv).toContain("reusedHit ? { noCopy: true } : { moveFile: true }");
    expect(ytv).toContain("mediaUrl = rec.filePath");
    expect(ytv).toContain("🔗 *Lien :* ${singleLink}");
  });

  it("Musique : l'audio converti part du store et le lien suit l'envoi", () => {
    expect(song).toContain("let songLink");
    expect(song).toContain("registerTempDownload(tmpOut, `${safeName}.m4a`, { moveFile: true })");
    expect(song).toContain("audio: fs.readFileSync(sendFile)");
    expect(song).toContain("if (songLink) {");
  });
});
