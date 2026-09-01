import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  b64UrlSafeDecode,
  decodeVoePayload,
  vidzyXorDecode,
  decryptFilemoonPayload,
  isVoeStyleUrl,
  hostPriority,
  scanPlayerHtmlForStreams,
  unpackDeanEdwards
} from "../src/bot/services/animeStreamExtractor.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const rot13 = (s: string) =>
  Array.from(s, (c) => {
    const o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) return String.fromCharCode(((o - 65 + 13) % 26) + 65);
    if (o >= 97 && o <= 122) return String.fromCharCode(((o - 97 + 13) % 26) + 97);
    return c;
  }).join("");

describe("b64UrlSafeDecode", () => {
  it("decodes standard and url-safe base64 with or without padding", () => {
    expect(b64UrlSafeDecode(b64("hello")).toString("utf8")).toBe("hello");
    expect(b64UrlSafeDecode("aGVsbG8").toString("utf8")).toBe("hello"); // no padding
    expect(b64UrlSafeDecode("a-G_vg").toString("utf8")).toBe(b64UrlSafeDecode("a+G/vg").toString("utf8"));
  });
});

describe("voe payload decoder", () => {
  it("round-trips the rot13 + double-base64 + ord-shift + reverse chain", () => {
    const target = { source: "https://cdn.example.voe/video480.mp4" };
    // Inverse of decodeVoePayload, built step by step:
    const s5 = b64(JSON.stringify(target)); // final base64 layer
    const s4 = s5.split("").reverse().join(""); // before reverse
    const s3 = Array.from(s4, (c) => String.fromCharCode(c.charCodeAt(0) + 3)).join(""); // before ord-3
    const s2 = b64(s3); // before second base64 decode
    const payload = rot13(s2); // before rot13

    const decoded = decodeVoePayload(payload);
    expect(decoded).not.toBeNull();
    expect(decoded.source).toBe(target.source);
  });

  it("returns null on garbage", () => {
    expect(decodeVoePayload("not-a-valid-payload!!!")).toBeNull();
    expect(decodeVoePayload("")).toBeNull();
  });
});

describe("vidzy XOR decoder", () => {
  it("reverses the base64 XOR obfuscation", () => {
    const key = [11, 22, 33, 244];
    const secret = "https://vidzy.example/hls/master.m3u8";
    const raw = Buffer.from(secret, "utf8");
    const xored = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) xored[i] = raw[i] ^ key[i % key.length];
    const encoded = xored.toString("base64");
    expect(vidzyXorDecode(encoded, key)).toBe(secret);
  });
});

describe("filemoon AES-GCM payload", () => {
  const VERSION = 7; // aIdx = 7, iIdx = 31 - 7 = 24
  const KEY = crypto.randomBytes(32);
  const IV = crypto.randomBytes(12);
  const TARGET = { sources: [{ url: "https://fm.example/v/xyz/master.m3u8" }] };

  function buildParts(): string[] {
    const parts: string[] = [];
    for (let i = 0; i < 25; i++) parts.push(crypto.randomBytes(16).toString("base64url"));
    parts[VERSION - 1] = KEY.subarray(0, 16).toString("base64url");
    parts[31 - VERSION - 1] = KEY.subarray(16).toString("base64url");
    return parts;
  }

  function encrypt(): string {
    const cipher = crypto.createCipheriv("aes-256-gcm", KEY, IV, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(JSON.stringify(TARGET), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([ct, tag]).toString("base64url");
  }

  it("decrypts a well-formed payload", () => {
    const out = decryptFilemoonPayload(String(VERSION), buildParts(), IV.toString("base64url"), encrypt());
    expect(out).not.toBeNull();
    expect(out.sources[0].url).toBe(TARGET.sources[0].url);
  });

  it("returns null when key_parts indices are out of range", () => {
    const shortParts = [crypto.randomBytes(16).toString("base64url")];
    expect(decryptFilemoonPayload(String(VERSION), shortParts, IV.toString("base64url"), encrypt())).toBeNull();
  });

  it("returns null on tampered payload (auth tag mismatch)", () => {
    const bad = encrypt().slice(0, -4) + "AAAA";
    expect(decryptFilemoonPayload(String(VERSION), buildParts(), IV.toString("base64url"), bad)).toBeNull();
  });
});

describe("isVoeStyleUrl", () => {
  it("detects voe domains and /e/<code> patterns on unknown hosts", () => {
    expect(isVoeStyleUrl("https://voe.sx/e/abc123")).toBe(true);
    expect(isVoeStyleUrl("https://some-unknown-host.example/e/abc123")).toBe(true);
  });
  it("does not claim known non-voe hosts", () => {
    expect(isVoeStyleUrl("https://uqload.is/e/abc123")).toBe(false);
    expect(isVoeStyleUrl("https://vidmoly.to/e/abc123")).toBe(false);
    expect(isVoeStyleUrl("https://video.sibnet.ru/video123.mp4")).toBe(false);
  });
});

describe("hostPriority covers the nakanime player ecosystem", () => {
  it("ranks legacy and new hosts", () => {
    expect(hostPriority("https://ansembed.net/x")).toBeLessThan(hostPriority("https://vidzy.live/e/x"));
    expect(hostPriority("https://movearnpre.com/embed/x")).toBe(6);
    expect(hostPriority("https://uqload.is/embed-x.html")).toBe(7);
    expect(hostPriority("https://bysesukior.com/e/x")).toBe(8);
    expect(hostPriority("https://voe.sx/e/x")).toBeLessThan(hostPriority("https://totally-unknown.example/x"));
  });

  it("puts VidMoly first, voembed second (quality references, audit 8.4/8.9)", () => {
    expect(hostPriority("https://vidmoly.org/embed-x.html")).toBe(1);
    expect(hostPriority("https://voembed.net/embed-x.html")).toBe(2);
    expect(hostPriority("https://ansembed.net/x")).toBe(3);
    expect(hostPriority("https://video.sibnet.ru/x")).toBe(5);
    expect(hostPriority("https://vidmoly.org/e/x")).toBeLessThan(hostPriority("https://ansembed.net/x"));
    expect(hostPriority("https://voembed.net/e/x")).toBeLessThan(hostPriority("https://ansembed.net/x"));
  });
});

describe("scanPlayerHtmlForStreams", () => {
  it("finds an absolute master.m3u8 and prefers it over other m3u8", () => {
    const html = `<html><script>var a="https://cdn.example/seg/index-f1.m3u8";var b="https://cdn.example/seg/master.m3u8";</script></html>`;
    const res = scanPlayerHtmlForStreams(html, "https://player.example");
    expect(res).not.toBeNull();
    expect(res!.url).toBe("https://cdn.example/seg/master.m3u8");
    expect(res!.type).toBe("hls");
  });

  it("resolves a relative /stream/... playlist against the player origin (movearnpre)", () => {
    const html = `<script>jwplayer("v").setup({file:"/stream/abc123/master.m3u8.txt"});</script>`;
    const res = scanPlayerHtmlForStreams(html, "https://movearnpre.com");
    expect(res).not.toBeNull();
    expect(res!.url).toBe("https://movearnpre.com/stream/abc123/master.m3u8.txt");
    expect(res!.type).toBe("hls");
  });

  it("unpacks a Dean-Edwards packed page before scanning", () => {
    // count=2, base=36: token "0" -> url, token "1" -> label
    const packed = `eval(function(p,a,c,k,e,d){return p}('var s="0";play("1");',2,2,'https://cdn.example/hls/master.m3u8|video'.split('|'),0,{}))`;
    const html = `<html><script>${packed}</script></html>`;
    const res = scanPlayerHtmlForStreams(html, "https://luluvdo.com");
    expect(res).not.toBeNull();
    expect(res!.url).toBe("https://cdn.example/hls/master.m3u8");
    // sanity: the unpacker itself substituted the token
    expect(unpackDeanEdwards(html)).toContain("https://cdn.example/hls/master.m3u8");
  });

  it("decodes a vidzy XOR body when no plain m3u8 exists", () => {
    const key = [200, 15, 77];
    const secret = "https://vidzy-cdn.example/vid/master.m3u8";
    const raw = Buffer.from(secret, "utf8");
    const xored = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) xored[i] = raw[i] ^ key[i % key.length];
    const html = `<script>var k=[${key.join(",")}];(function(){})("${xored.toString("base64")}");</script>`;
    const res = scanPlayerHtmlForStreams(html, "https://vidzy.live");
    expect(res).not.toBeNull();
    expect(res!.url).toBe(secret);
    expect(res!.type).toBe("hls");
  });

  it("falls back to a direct mp4 (oneupload-style jwplayer)", () => {
    const html = `<script type="text/javascript">jwplayer("v").setup({file:"https://oneupload.example/dl/episode.mp4"});</script>`;
    const res = scanPlayerHtmlForStreams(html, "https://oneupload.net");
    expect(res).not.toBeNull();
    expect(res!.url).toBe("https://oneupload.example/dl/episode.mp4");
    expect(res!.type).toBe("direct_mp4");
  });

  it("returns null when nothing playable is present", () => {
    expect(scanPlayerHtmlForStreams("<html><body>hello</body></html>", "https://x.example")).toBeNull();
    expect(scanPlayerHtmlForStreams("", "https://x.example")).toBeNull();
  });
});
