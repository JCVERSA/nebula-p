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
    expect(src).toContain("await fetchMediaToTempFile(mediaUrl, (received, total) => {");
    expect(src).toContain("registerMediaLink(local,");
  });

  it("l'envoi part du fichier du store, avec repli URL distante", () => {
    expect(src).toContain("sendPath = rec.filePath");
    expect(src).toContain("let sendPath = mediaUrl");
    expect(src).toContain("sendPath = local; // quota du store atteint");
  });

  it("UN SEUL message final liste tous les liens (fini les .up manuels)", () => {
    // 9.18t : le push porte { url, cached } pour marquer ⚡ les hits cache.
    expect(src).toContain("collectedLinks.push({ url: rec.downloadUrl, cached: true });");
    expect(src).toContain("collectedLinks.push({ url: rec.downloadUrl, cached: false });");
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
    expect(src).toContain("await fetchMediaToTempFile(videoUrl, (received, total) => {");
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
    expect(tt).toContain("const ttFilename = `${safeTitle}.mp4`;");
    expect(tt).toContain("registerMediaLink(local, ttFilename)");
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

describe("9.18t — caches sociaux 5 h : IG, TikTok, musique (structure)", () => {
  const ig = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/instagram.ts"), "utf-8");
  const tt = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/tiktok.ts"), "utf-8");
  const song = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/song.ts"), "utf-8");

  it("IG : lookup AVANT le fetch, store 5 h après enregistrement, marque ⚡ honnête", () => {
    expect(ig).toContain("const cachedHit = cacheKey ? lookupMediaReuse(cacheKey) : null;");
    expect(ig.indexOf("lookupMediaReuse(cacheKey)")).toBeLessThan(ig.indexOf("await fetchMediaToTempFile(mediaUrl,"));
    expect(ig).toContain("storeMediaReuse(cacheKey, rec.filePath, linkName, { ttlMs: SOCIAL_REUSE_TTL_MS })");
    expect(ig).toContain("Marqué déjà en cache (5 h)");
    expect(ig).toContain('${l.cached ? "⚡ " : ""}${l.url}');
  });

  it("TikTok : id depuis URL/tikwm/extracteur, hit → noCopy + note, store 5 h sinon", () => {
    expect(tt).toContain("let ttId = (url.match(/\\/video\\/(\\d+)/) || [])[1] || \"\";");
    expect(tt).toContain("if (data.id) ttId = String(data.id);");
    expect(tt).toContain("if (own.videoId) ttId = own.videoId;");
    expect(tt).toContain("lookupMediaReuse(ttCacheKey)");
    expect(tt).toContain("registerTempDownload(ttHit.filePath, ttFilename, { noCopy: true })");
    expect(tt).toContain("Déjà en cache (5 h)");
    expect(tt).toContain("storeMediaReuse(ttCacheKey, rec.filePath, ttFilename, { ttlMs: SOCIAL_REUSE_TTL_MS })");
  });

  it("musique : hit → livraison instantanée (zéro re-téléchargement ni conversion), store 5 h", () => {
    expect(song).toContain("const mKey = songReuseKey(videoUrl);");
    expect(song.indexOf("const cachedSong = mKey ? lookupMediaReuse(mKey) : null;"))
      .toBeLessThan(song.indexOf("const initialCaption"));
    expect(song).toContain("Déjà en cache (5 h)");
    expect(song).toContain("storeMediaReuse(mKey, rec.filePath, `${safeName}.m4a`, { ttlMs: SOCIAL_REUSE_TTL_MS })");
  });

  it("le cache YT vidéo reste au régime 24 h par défaut (aucun TTL social dans ytv)", () => {
    const ytv = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/ytvideo.ts"), "utf-8");
    expect(ytv).toContain("storeMediaReuse(reuseKey");
    expect(ytv).not.toContain("SOCIAL_REUSE_TTL_MS");
  });
});
