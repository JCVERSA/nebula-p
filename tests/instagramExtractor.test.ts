import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { instagramShortcode, mediaPkFromShortcode } from "../src/bot/services/instagramExtractor.js";

/**
 * 9.18p — retour terrain 14/10 03:06 : reel Instagram DeZL1mfhKjw, « Aucun
 * média trouvé » sur les DEUX tentatives (URL brute puis URL nettoyée du
 * paramètre de tracking via la confirmation agent). Cause : les backends
 * obfusqués du paquet ruhend-scraper parsent le HTML de sites tiers — muets
 * dès que ces sites changent. Correctif : chaîne igdl → igdl2 → extracteur
 * maison (embed public + API web Instagram).
 *
 * Tests purs (pas de réseau en CI) : parsing du shortcode, conversion
 * shortcode → pk (vecteurs déterministes), et structure de la chaîne.
 */

describe("9.18p — instagramShortcode : toutes les formes d'URL", () => {
  it("reel avec paramètre de tracking (le cas du retour terrain)", () => {
    expect(
      instagramShortcode("https://www.instagram.com/reel/DeZL1mfhKjw/?exln=MXB4cThqaXFrMHRtcw==")
    ).toBe("DeZL1mfhKjw");
  });

  it("formes /p/, /tv/, /reels/ et /share/reel/", () => {
    expect(instagramShortcode("https://www.instagram.com/p/CxYzAbCdEfG/")).toBe("CxYzAbCdEfG");
    expect(instagramShortcode("https://www.instagram.com/tv/AbCdEfGhIjK")).toBe("AbCdEfGhIjK");
    expect(instagramShortcode("https://www.instagram.com/reels/QrStUvWxYz/")).toBe("QrStUvWxYz");
    expect(instagramShortcode("https://www.instagram.com/share/reel/MnOpQrStUv")).toBe("MnOpQrStUv");
  });

  it("URL vrac, texte libre, non-Instagram → null", () => {
    expect(instagramShortcode("https://tiktok.com/@x/video/123")).toBeNull();
    expect(instagramShortcode("télécharge le reel de hier")).toBeNull();
    expect(instagramShortcode("")).toBeNull();
  });
});

describe("9.18p — mediaPkFromShortcode : base64 → BigInt", () => {
  it("vecteurs déterministes (alphabet A=0, B=1, a=26…)", () => {
    expect(mediaPkFromShortcode("A")).toBe("0");
    expect(mediaPkFromShortcode("B")).toBe("1");
    expect(mediaPkFromShortcode("AB")).toBe("1"); // 0×64 + 1
    expect(mediaPkFromShortcode("BA")).toBe("64"); // 1×64 + 0
    expect(mediaPkFromShortcode("AAA")).toBe("0");
    expect(mediaPkFromShortcode("_")).toBe("63");
    expect(mediaPkFromShortcode("-")).toBe("62");
  });

  it("shortcode réel du retour terrain → pk numérique exploitable", () => {
    const pk = mediaPkFromShortcode("DeZL1mfhKjw");
    expect(pk).toBeTruthy();
    expect(pk!).toMatch(/^\d+$/);
  });

  it("caractère hors alphabet ou vide → null (jamais de valeur fausse)", () => {
    expect(mediaPkFromShortcode("ABC$")).toBeNull();
    expect(mediaPkFromShortcode("")).toBeNull();
    expect(mediaPkFromShortcode("avec espace")).toBeNull();
  });
});

describe("9.18p — chaîne de repli de la commande (structure)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/instagram.ts"), "utf-8");

  it("les trois étages sont branchés dans l'ordre igdl → igdl2 → extracteur maison", () => {
    // 9.18r : la boucle backend itère orderIgBackends() (mémoire du gagnant)
    // — l'ordre structurel reste igdl/igdl2 PUIS extracteur maison.
    const loop = src.indexOf("for (const label of backends)");
    const own = src.indexOf("await extractInstagramMedia(text)");
    expect(loop).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(loop);
    expect(src).toContain('label === "igdl" ? mod.igdl : mod.igdl2');
  });

  it("l'échec total reste honnête (rate-limit mentionné, pas de promesse)", () => {
    expect(src).toContain("Instagram limite le serveur");
    expect(src).toContain("réessaie dans quelques minutes");
  });

  it("chaque étage a son timeout 30 s (leçon 8.84)", () => {
    expect(src).toContain("30000");
  });

  it("la source retenue est journalisée (diagnostic terrain sans contenu privé)", () => {
    expect(src).toContain("media source:");
  });
});
