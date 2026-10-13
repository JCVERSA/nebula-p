import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  isTikTokShortLink,
  isTikTokUrl,
  parseTikTokPageHtml
} from "../src/bot/services/tiktokExtractor.js";

/**
 * 9.18q — filet TikTok préventif (leçon 9.18p : la mort d'igdl a montré
 * qu'un extracteur à point de défaillance unique meurt en silence le jour
 * où son site tiers change). La commande garde tikwm en primaire et gagne
 * l'extracteur maison (page TikTok → JSON d'hydratation) en filet.
 *
 * Tests POURS (sans réseau) : validation d'URL, résolution de forme courte,
 * et surtout le parseur HTML avec les DEUX formats d'hydratation que TikTok
 * a utilisés (fixtures réalistes minimalistes).
 */

const UNIVERSAL_FIXTURE = `<!DOCTYPE html><html><head><title>tiktok</title></head><body>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
  __DEFAULT_SCOPE__: {
    "webapp.video-detail": {
      itemInfo: {
        itemStruct: {
          id: "7400000000000000001",
          desc: "Retour terrain du bot",
          video: {
            playAddr: "https://v16-webapp-prime.tiktok.com/video/tos/-useast2a/play.mp4",
            downloadAddr: "https://v16-webapp-prime.tiktok.com/video/tos/download.mp4",
            cover: "https://p16-sign-va.tiktokcdn.com/cover.jpeg",
            duration: 27
          },
          author: { nickname: "Dark Neon" }
        }
      }
    }
  }
})}</script>
</body></html>`;

const SIGI_FIXTURE = `<html><body>
<script id="SIGI_STATE" type="application/json">${JSON.stringify({
  ItemModule: {
    "7400000000000000002": {
      desc: "Ancien format",
      video: {
        playAddr: "https://v16.tiktokcdn.com/old/play.mp4",
        cover: "https://p16.tiktokcdn.com/old-cover.jpeg",
        duration: 12
      },
      author: { nickname: "Ancien Auteur" }
    }
  }
})}</script>
</body></html>`;

describe("9.18q — parseTikTokPageHtml (pur, fixtures)", () => {
  it("format actuel __UNIVERSAL_DATA_FOR_REHYDRATION__ : playAddr, cover, auteur, durée", () => {
    const item = parseTikTokPageHtml(UNIVERSAL_FIXTURE);
    expect(item).not.toBeNull();
    expect(item!.videoUrl).toBe("https://v16-webapp-prime.tiktok.com/video/tos/-useast2a/play.mp4");
    expect(item!.coverUrl).toContain("cover.jpeg");
    expect(item!.author).toBe("Dark Neon");
    expect(item!.durationSec).toBe(27);
    expect(item!.title).toBe("Retour terrain du bot");
  });

  it("ancien format SIGI_STATE : toujours couvert (TikTok A/B ses formats)", () => {
    const item = parseTikTokPageHtml(SIGI_FIXTURE);
    expect(item).not.toBeNull();
    expect(item!.videoUrl).toBe("https://v16.tiktokcdn.com/old/play.mp4");
    expect(item!.author).toBe("Ancien Auteur");
  });

  it("HTML vide ou sans script → null", () => {
    expect(parseTikTokPageHtml("<html>rien ici</html>")).toBeNull();
    expect(parseTikTokPageHtml("")).toBeNull();
  });

  it("JSON illisible dans le script → null propre (pas de throw)", () => {
    const broken = UNIVERSAL_FIXTURE.replace('{"__DEFAULT_SCOPE__"', '{__DEFAULT_SCOPE__'); // JSON réellement invalide
    expect(parseTikTokPageHtml(broken)).toBeNull();
  });
});

describe("9.18q — validation d'URL (zéro SSRF : TikTok uniquement)", () => {
  it("liens courts vm/vt détectés", () => {
    expect(isTikTokShortLink("https://vm.tiktok.com/ZMabcdef/")).toBe(true);
    expect(isTikTokShortLink("https://vt.tiktok.com/ZS123/")).toBe(true);
    expect(isTikTokShortLink("https://www.tiktok.com/@user/video/123")).toBe(false);
  });

  it("hôtes acceptés vs rejetés", () => {
    expect(isTikTokUrl("https://www.tiktok.com/@user/video/7401")).toBe(true);
    expect(isTikTokUrl("https://m.tiktok.com/v/7401")).toBe(true);
    expect(isTikTokUrl("https://vm.tiktok.com/ZM/")).toBe(true);
    expect(isTikTokUrl("https://evil-tiktok.com.evil.io/x")).toBe(false);
    expect(isTikTokUrl("https://instagram.com/reel/x")).toBe(false);
    expect(isTikTokUrl("pas une url")).toBe(false);
  });
});

describe("9.18q — chaîne de la commande (structure)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/tiktok.ts"), "utf-8");

  it("tikwm reste primaire, l'extracteur maison en filet — dans cet ordre", () => {
    const tikwm = src.indexOf("tikwm.com/api/");
    const own = src.indexOf("await extractTikTokMedia(url)");
    expect(tikwm).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(tikwm);
  });

  it("l'échec de tikwm n'interrompt plus la commande (try/catch avant le filet)", () => {
    expect(src).toContain("[TT] tikwm failed:");
    expect(src).toContain("[TT] extractor failed:");
  });

  it("la source retenue est journalisée ; l'échec total reste honnête", () => {
    expect(src).toContain("[TT] media source:");
    expect(src).toContain("TikTok limite le serveur");
    expect(src).toContain("réessaie dans quelques minutes");
  });

  it("les timeouts sont bornés (20 s tikwm, 15 s extracteur)", () => {
    expect(src).toContain("timeout: 20000");
    const extractor = fs.readFileSync(
      path.resolve(process.cwd(), "src/bot/services/tiktokExtractor.ts"),
      "utf-8"
    );
    expect(extractor).toContain("REQUEST_TIMEOUT_MS = 15000");
  });
});
