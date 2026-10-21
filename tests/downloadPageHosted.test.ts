import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import { buildDownloadPage, registerDownloadPage } from "../src/bot/services/downloadPage.js";
import { getTempDownload } from "../src/bot/tempDownloadManager.js";

/**
 * 9.18ffff — la page HTML en DOCUMENT WhatsApp ne s'ouvre plus (terrain
 * 21/10 : WhatsApp filtre silencieusement les documents text/html — vecteur
 * phishing classique ; PDF/ZIP passent, HTML non). La page vit désormais sur
 * NOTRE serveur (route /d/ existante + tunnel, servie en inline) et le bot
 * envoie un LIEN : le pipeline document de WhatsApp n'intervient plus.
 */

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.PUBLIC_URL;
});

describe("registerDownloadPage (page hébergée, lien inline)", () => {
  it("avec APP_URL : renvoie un LIEN absolu ?inline=true et enregistre la page en text/html", () => {
    process.env.APP_URL = "https://dash2.exemple.com";
    const html = buildDownloadPage({
      title: "Test — Saison 1",
      subtitle: "VF · 480P · 2 épisodes prêts",
      entries: [
        { label: "Épisode 1", url: "https://dash2.exemple.com/api/media/download/tok1", sizeMB: 10 },
        { label: "Épisode 2", url: "https://dash2.exemple.com/api/media/download/tok2", sizeMB: 10 }
      ],
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    const link = registerDownloadPage(html, "nebula-test-saison-1.html");
    expect(link).toBeTruthy();
    expect(link).toMatch(/^https:\/\/dash2\.exemple\.com\/api\/media\/download\/[a-z0-9]+\?inline=true$/);

    // Le record sert la page en text/html → le navigateur l'AFFICHE (inline),
    // il ne la télécharge pas.
    const token = String(link).split("/").pop()!.split("?")[0]!;
    const rec = getTempDownload(token) as { mimeType: string; filename: string; filePath: string } | null;
    expect(rec).toBeTruthy();
    expect(rec!.mimeType).toBe("text/html");
    expect(rec!.filename).toBe("nebula-test-saison-1.html");
    expect(fs.existsSync(rec!.filePath)).toBe(true);
    expect(fs.readFileSync(rec!.filePath, "utf8")).toContain("Tout télécharger");
  });

  it("sans base absolue (APP_URL absent) : null → l'appelant replie sur le document", () => {
    const link = registerDownloadPage("<!DOCTYPE html><html><body>x</body></html>", "nebula-relative.html");
    expect(link).toBeNull();
  });
});

describe("câblage (leçon 8.49b : vert localement ≠ câblé en production)", () => {
  const readSrc = (rel: string) => fs.readFileSync(rel, "utf8");

  it("novabox : lien hébergé AVANT le document, document conservé en repli, jobId du batch transmis", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    const linkIdx = src.indexOf("registerDownloadPage(html, pageFilename");
    const docIdx = src.indexOf("document: Buffer.from(html");
    expect(linkIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(linkIdx); // lien d'abord, document en repli
    expect(src).toContain("registerDownloadPage(html, pageFilename, { jobId: batchJob.id })");
    expect(src).toContain("HOSTED LINK");
    expect(src).toContain("pageMode"); // le recap s'adapte au mode de livraison
  });

  it("ytvideo : même traitement pour la page playlist", () => {
    const src = readSrc("src/bot/commands/ytvideo.ts");
    const linkIdx = src.indexOf("registerDownloadPage(html, pageFilename");
    const docIdx = src.indexOf("document: Buffer.from(html");
    expect(linkIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(linkIdx);
    expect(src).toContain("HOSTED LINK");
  });

  it("la route /d/ sert l'inline pour ?inline=true (affichage page, pas de téléchargement forcé)", () => {
    const src = readSrc("app.ts");
    expect(src).toContain('req.query.inline === "true" ? "inline" : "attachment"');
  });

  it("le helper rend la page via le magasin temporaire (TTL glissant + purge + restauration gratuits)", () => {
    const src = readSrc("src/bot/services/downloadPage.ts");
    expect(src).toContain("registerTempDownload(tmpPath, filename, {");
    expect(src).toContain('mimeType: "text/html"');
    expect(src).toContain("moveFile: true");
    expect(src).toContain("?inline=true");
    // Un record inutilisable (base relative) n'est pas laissé derrière nous.
    expect(src).toContain("purgeTempRecords([rec.token])");
  });
});
