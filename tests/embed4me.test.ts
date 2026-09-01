import { describe, it, expect } from "vitest";
import { createCipheriv } from "crypto";
import {
  decryptEmbed4MeResponse,
  unpackDeanEdwards,
  hostPriority
} from "../src/bot/services/animeStreamExtractor.js";
import { resolveRequestedSeason } from "../src/bot/utils/quickAnimeParser.js";

/** Encrypts a JSON payload exactly the way embed4me's API does. */
function encryptLikeEmbed4me(payload: object): string {
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from("kiemtienmua911ca", "utf8"),
    Buffer.from("1234567890oiuytr", "utf8")
  );
  return Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final()
  ]).toString("hex");
}

describe("embed4me / Lplayer encrypted API player", () => {
  it("decrypts an AES-128-CBC hex response and extracts the source URL", () => {
    const hex = encryptLikeEmbed4me({ cfNative: "https://cdn.example.com/hls/master.m3u8?tok=abc" });
    expect(decryptEmbed4MeResponse(hex)).toBe("https://cdn.example.com/hls/master.m3u8?tok=abc");
  });

  it("prefers cfNative, then cf, then hls/source/url/file", () => {
    expect(decryptEmbed4MeResponse(encryptLikeEmbed4me({ cf: "https://a/cf.m3u8" }))).toBe("https://a/cf.m3u8");
    expect(decryptEmbed4MeResponse(encryptLikeEmbed4me({ hls: "https://a/hls.m3u8" }))).toBe("https://a/hls.m3u8");
    expect(decryptEmbed4MeResponse(encryptLikeEmbed4me({ source: "https://a/source.m3u8" }))).toBe("https://a/source.m3u8");
    expect(decryptEmbed4MeResponse(encryptLikeEmbed4me({ file: "https://a/file.m3u8" }))).toBe("https://a/file.m3u8");
  });

  it("tolerates a JSON-quoted hex body and rejects garbage", () => {
    const hex = encryptLikeEmbed4me({ source: "https://a/x.m3u8" });
    expect(decryptEmbed4MeResponse(`"${hex}"`)).toBe("https://a/x.m3u8");
    expect(decryptEmbed4MeResponse("not-hex-at-all")).toBeNull();
    expect(decryptEmbed4MeResponse("")).toBeNull();
    expect(decryptEmbed4MeResponse("00112233")).toBeNull(); // invalid padding
  });
});

describe("Dean Edwards unpacker — canonical packer form", () => {
  it("unpacks scripts ending with .split('|'),0,{})) (standard packer output)", () => {
    // Canonical form emitted by the standard p.a.c.k.e.r (with the ,0,{} tail).
    const packed = `<script>eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 1=\\'2://3.4/5.6\\';',7,7,'var|sources|https|cdn|host|stream|m3u8'.split('|'),0,{}))</script>`;
    const unpacked = unpackDeanEdwards(packed);
    expect(unpacked).toContain("https://cdn.host/stream.m3u8");
  });

  it("still unpacks the reduced form without the tail", () => {
    const packed = `<script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0:\\'1://2.3/4.5\\'',6,6,'file|https|vidmoly|to|stream|m3u8'.split('|')))</script>`;
    const unpacked = unpackDeanEdwards(packed);
    expect(unpacked).toContain("https://vidmoly.to/stream.m3u8");
  });
});

describe("mirror priority for the 2026 player ecosystem", () => {
  it("ranks current live hosts above retired ones", () => {
    const urls = [
      "https://smoothpre.com/x",                     // retired
      "https://video.sibnet.ru/shell.php?videoid=1", // live
      "https://ansembed.net/embed-x.html",           // live
      "https://lpayer.embed4me.com/#abc",            // live (Lecteur 1)
      "https://uqload.is/embed-x.html"               // live, no dedicated extractor
    ];
    const ranked = [...urls].sort((a, b) => hostPriority(a) - hostPriority(b));
    expect(ranked[0]).toContain("ansembed");
    expect(ranked[1]).toContain("embed4me");
    expect(ranked[2]).toContain("sibnet");
    expect(hostPriority("https://smoothpre.com/x")).toBeGreaterThan(hostPriority("https://ansembed.net/x"));
  });
});

describe("resolveRequestedSeason film guard", () => {
  const catalog = [
    { name: "Saison 1", subPath: "saison1/vostfr", url: "u1" },
    { name: "Saison 2", subPath: "saison2/vostfr", url: "u2" },
    { name: "Film 1", subPath: "film1/vostfr", url: "u3" }
  ];

  it("still resolves real seasons by number", () => {
    expect(resolveRequestedSeason(catalog, 2).season?.name).toBe("Saison 2");
  });

  it("no longer maps a missing season onto a film (returns null)", () => {
    const r = resolveRequestedSeason(catalog, 3);
    expect(r.season).toBeNull();
    expect(r.index).toBe(-1);
  });

  it("keeps the index fallback for pure-season catalogs", () => {
    const seasonsOnly = [
      { name: "Saison 1", subPath: "saison1/vostfr", url: "u1" },
      { name: "Saison 2", subPath: "saison2/vostfr", url: "u2" },
      { name: "Saison 3", subPath: "saison3/vostfr", url: "u3" }
    ];
    expect(resolveRequestedSeason(seasonsOnly, 3).season?.name).toBe("Saison 3");
  });
});
