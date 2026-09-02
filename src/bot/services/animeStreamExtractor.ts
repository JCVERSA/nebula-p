import axios from "axios";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  downloadHlsAppLevel,
  robustFetchText,
  robustFetchBuffer,
  resolveAbsoluteUrl,
  resolveMediaPlaylistUrl,
  resolveVidmolyUrlset,
  markDeadFileSlug,
  isDeadFileSlug
} from "./hlsDownloader.js";
import { animeProxyOptions } from "./scrapingProxy.js";

import { resolvedFfmpegPath } from "../ffmpeg.js";

export interface StreamQualityTrack {
  resolution: string; // "360P", "480P", "720P", "1080P", "Original"
  url: string;
  bandwidth?: number;
  fileSizeBytes?: number;
  type: "direct_mp4" | "hls";
  headers?: Record<string, string>;
}

export interface ExtractedStreamResult {
  hostName: string;
  url: string;
  type: "direct_mp4" | "hls";
  headers: Record<string, string>;
  availableTracks?: StreamQualityTrack[];
  originalResolution?: string;
  estimatedSizeMB?: number;
}

/**
 * Decodes a JavaScript string literal the way `eval` would for the simple
 * escaped strings found in Dean Edwards packed scripts — without eval.
 * Supports the escapes actually emitted by packers (\xNN, \uNNNN, \n \r \t \\ \' \").
 */
export function decodeJsStringLiteral(literal: string): string {
  const trimmed = literal.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }
  const body = trimmed.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    switch (next) {
      case "n": out += "\n"; i++; break;
      case "r": out += "\r"; i++; break;
      case "t": out += "\t"; i++; break;
      case "\\": out += "\\"; i++; break;
      case "'": out += "'"; i++; break;
      case '"': out += '"'; i++; break;
      case "x": {
        const hex = body.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 3;
        } else {
          out += "x";
        }
        break;
      }
      case "u": {
        const hex = body.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else {
          out += "u";
        }
        break;
      }
      default:
        out += next;
        i++;
    }
  }
  return out;
}

/**
 * Parses the simple flat array literal used as the `k` parameter of packed
 * scripts (['a','b',...]) without eval.
 */
export function decodeJsArrayLiteral(literal: string): string[] {
  const trimmed = literal.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map((part) => decodeJsStringLiteral(part));
}

/**
 * Unpacks Dean Edwards JavaScript packers (eval(function(p,a,c,k,e,d)...))
 * safely without executing untrusted third-party code.
 */
export function unpackDeanEdwards(html: string): string {
  if (!html) return "";
  let result = html;
  const packedRegex = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?return\s+p;?\}\((?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\.split\(['"]\|['"]\)(?:\s*,\s*[^)]*)?\)/gi;
  let match: RegExpExecArray | null;
  while ((match = packedRegex.exec(html)) !== null) {
    try {
      const pRaw = match[1] !== undefined ? match[1] : match[2];
      const aVal = parseInt(match[3], 10);
      const cVal = parseInt(match[4], 10);
      const kRaw = match[5] !== undefined ? match[5] : match[6];
      const kVal = kRaw.split("|");
      const pVal = decodeJsStringLiteral("'" + pRaw + "'");
      let count = cVal;
      let unpacked = pVal;
      while (count--) {
        if (kVal[count]) {
          unpacked = unpacked.replace(new RegExp('\\b' + count.toString(aVal) + '\\b', 'g'), kVal[count]);
        }
      }
      result += "\n" + unpacked;
    } catch {
      // Safe failover
    }
  }
  return result;
}

// embed4me / Lplayer — encrypted JSON API player used as "Lecteur 1" on
// anime-sama since ~2025. The video source is served by
// GET {origin}/api/v1/video?id=<id> as hex-encoded AES-128-CBC JSON.
const EMBED4ME_AES_KEY = Buffer.from("kiemtienmua911ca", "utf8");
const EMBED4ME_AES_IV = Buffer.from("1234567890oiuytr", "utf8");

/**
 * Decrypts an embed4me/Lplayer API response (hex AES-128-CBC JSON) and
 * returns the video source URL (cfNative / cf / hls / source / url / file).
 */
export function decryptEmbed4MeResponse(hexBody: string): string | null {
  try {
    let hex = (hexBody || "").trim();
    if (hex.startsWith('"') && hex.endsWith('"')) hex = hex.slice(1, -1);
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) return null;
    const decipher = crypto.createDecipheriv("aes-128-cbc", EMBED4ME_AES_KEY, EMBED4ME_AES_IV);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]).toString("utf8");
    const data = JSON.parse(decrypted);
    const source = data?.cfNative || data?.cf || data?.hls || data?.source || data?.url || data?.file;
    return typeof source === "string" && source.length > 0 ? source : null;
  } catch {
    return null;
  }
}

/**
 * Mirror reliability order for the CURRENT anime-sama player ecosystem
 * (2026-08): ansembed (plain m3u8) > embed4me (API + AES) > sibnet (direct
 * mp4) > sendvid > vidmoly/vmpx > smoothpre legacy > anything else.
 */
export function hostPriority(url: string): number {
  const l = (url || "").toLowerCase();
  // VidMoly first: stable two-quality HLS manifests (480P/1080P) with honest
  // sizes — the quality reference. Everything else is a fallback (audit 8.4).
  if (l.includes("vidmoly") || l.includes("vmpx") || l.includes("topembed")) return 1;
  if (l.includes("voembed")) return 2; // voiranime VF player host (audit 8.9)
  if (l.includes("ansembed")) return 3;
  if (l.includes("embed4me") || l.includes("lpayer")) return 4;
  if (l.includes("sibnet")) return 5;
  if (l.includes("sendvid")) return 6;
  if (l.includes("smoothpre") || l.includes("dramiyos") || l.includes("movearnpre") || l.includes("ovaltinecdn")) return 6;
  if (l.includes("uqload") || l.includes("vidzy") || l.includes("luluvdo") || l.includes("lulustream")) return 7;
  if (l.includes("oneupload") || l.includes("filemoon") || l.includes("bysesukior") || l.includes("mivalyo") || l.includes("dingtezuni")) return 8;
  if (l.includes("voe")) return 9;
  return 10;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============================================================================
// nakanime.tv mirror player ecosystem (2026-08, audit §8)
// ============================================================================
// nakanime re-serves the anime-sama catalog with a WIDER player set than
// anime-sama itself. Hosts beyond the legacy recipes above:
//   movearnpre.com / ovaltinecdn.com  packed page, HLS under /stream/...
//   uqload.is                         embed-<code>.html, plain or packed m3u8
//   vidzy.live / vidzy.org            packed page + XOR(base64, var k=[..])
//   luluvdo.com / lulustream.com      plain or packed m3u8
//   oneupload.net / .to               jwplayer file:"https://...m3u8"
//   filemoon / bysesukior.com         /api/videos/<code> AES-GCM JSON payload
//   voe (rotating domains, /e/<code>) rot13+base64 JSON payload in the page
//   mivalyo.com / dingtezuni.com      generic packed / m3u8 probe
// Recipes ported from the reference nakanime downloader (SertraFurr).

/** Player hosts handled by the generic page probe (packed / m3u8 / mp4 scan). */
export const NAKANIME_GENERIC_PLAYER_HINTS = [
  "movearnpre", "ovaltinecdn", "uqload", "vidzy", "luluvdo", "lulustream",
  "oneupload", "mivalyo", "dingtezuni", "smoothpre", "dramiyos"
];

/** Base64 (url-safe tolerant, padding tolerant) decode. */
export function b64UrlSafeDecode(s: string): Buffer {
  let t = (s || "").replace(/-/g, "+").replace(/_/g, "/");
  const r = t.length % 4;
  if (r) t += "=".repeat(4 - r);
  return Buffer.from(t, "base64");
}

function rot13(s: string): string {
  let out = "";
  for (const c of s) {
    const o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) out += String.fromCharCode(((o - 65 + 13) % 26) + 65);
    else if (o >= 97 && o <= 122) out += String.fromCharCode(((o - 97 + 13) % 26) + 97);
    else out += c;
  }
  return out;
}

/**
 * voe embedded payload decoder:
 * rot13 -> strip noise ops -> base64 -> (ord-3) -> reverse -> base64 -> JSON
 */
export function decodeVoePayload(payload: string): any | null {
  try {
    if (!payload) return null;
    let s = rot13(payload);
    for (const op of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) {
      s = s.split(op).join("");
    }
    s = b64UrlSafeDecode(s).toString("utf8");
    s = Array.from(s, (c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
    s = s.split("").reverse().join("");
    s = b64UrlSafeDecode(s).toString("utf8");
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** vidzy fallback: base64 body XOR'd with the byte list from `var k = [..]`. */
export function vidzyXorDecode(encodedB64: string, keyBytes: number[]): string {
  const raw = b64UrlSafeDecode(encodedB64);
  const key = Buffer.from(keyBytes.filter((n) => Number.isFinite(n) && n >= 0 && n <= 255));
  const out = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] ^ key[i % key.length];
  }
  return out.toString("utf8");
}

/**
 * filemoon /api/videos/<code> payload: AES-GCM. Key is reassembled from
 * key_parts[version] + key_parts[31 - version] (1-based), payload's last 16
 * bytes are the auth tag.
 */
export function decryptFilemoonPayload(
  versionStr: string,
  keyParts: unknown,
  ivB64: unknown,
  payloadB64: unknown
): any | null {
  try {
    if (!versionStr || !Array.isArray(keyParts) || !ivB64 || !payloadB64) return null;
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) return null;
    const aIdx = version;
    const iIdx = 31 - version;
    if (aIdx < 1 || aIdx > keyParts.length || iIdx < 1 || iIdx > keyParts.length) return null;
    const key = Buffer.concat([
      b64UrlSafeDecode(String(keyParts[aIdx - 1])),
      b64UrlSafeDecode(String(keyParts[iIdx - 1]))
    ]);
    const iv = b64UrlSafeDecode(String(ivB64));
    const payload = b64UrlSafeDecode(String(payloadB64));
    if (payload.length < 16 || iv.length < 8) return null;
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);
    const algo = key.length === 32 ? "aes-256-gcm" : key.length === 16 ? "aes-128-gcm" : key.length === 24 ? "aes-192-gcm" : null;
    if (!algo) return null;
    const decipher = crypto.createDecipheriv(algo, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/** True when a URL smells like a voe embed (voe rotates its domains). */
export function isVoeStyleUrl(url: string): boolean {
  const l = (url || "").toLowerCase();
  if (!l) return false;
  if (l.includes("voe")) return true;
  if (/^https?:\/\/[^\/]+\/e\/[a-z0-9]+/.test(l)) {
    const knownOthers = [
      "sibnet", "vidmoly", "lulustream", "luluvdo", "vidzy", "filemoon", "bysesukior",
      "uqload", "ansembed", "embed4me", "sendvid", "oneupload", "movearnpre"
    ];
    return !knownOthers.some((p) => l.includes(p));
  }
  return false;
}

export interface PlayerHtmlScanResult {
  url: string;
  type: "hls" | "direct_mp4";
}

/**
 * Pure scanner shared by all generic player probes: unpacks Dean-Edwards
 * packers and looks for a playable stream, in reliability order:
 *   1. absolute .m3u8/.txt (master.m3u8 preferred)
 *   2. relative /...m3u8 resolved against the player origin (movearnpre)
 *   3. vidzy XOR-encoded body (var k = [..] + })("base64"))
 *   4. absolute .mp4 direct file (oneupload / jwplayer)
 */
export function scanPlayerHtmlForStreams(html: string, playerOrigin: string): PlayerHtmlScanResult | null {
  if (!html) return null;
  const combined = html + "\n" + unpackDeanEdwards(html);

  // 1. Absolute HLS
  const absMatches = combined.match(/https?:\/\/[^\s"'<>|]+\.(?:m3u8|txt)(?:[^\s"'<>|]*)/gi) || [];
  const firstAbs = absMatches[0];
  if (firstAbs) {
    const master = absMatches.find((u) => u.toLowerCase().includes("master.m3u8")) || firstAbs;
    return { url: master, type: "hls" };
  }

  // 2. Relative HLS (e.g. "/stream/<id>/master.m3u8.txt")
  const rel = combined.match(/["'\s=(](\/[^\s"'<>|]+\.(?:m3u8|txt)(?:\?[^\s"'<>|]*)?)/i);
  if (rel && rel[1] && playerOrigin) {
    return { url: playerOrigin.replace(/\/$/, "") + rel[1], type: "hls" };
  }

  // 3. vidzy XOR body
  const kMatch = combined.match(/var\s+k\s*=\s*\[([\d\s,]+)\]/);
  const sMatch = combined.match(/\}\)\(["']([A-Za-z0-9+/=]+)["']\)/);
  if (kMatch && sMatch) {
    try {
      const keyBytes = kMatch[1].split(",").map((x) => parseInt(x.trim(), 10));
      const decoded = vidzyXorDecode(sMatch[1], keyBytes);
      const abs = decoded.match(/https?:\/\/[^\s"'|]+\.(?:m3u8|mp4)[^\s"'|]*/i);
      if (abs) {
        return { url: abs[0], type: abs[0].includes(".m3u8") ? "hls" : "direct_mp4" };
      }
      const relX = decoded.match(/[^\s"']*\/[^\s"']*\.(?:m3u8|mp4)[^\s"']*/i);
      if (relX && relX[0].startsWith("/") && playerOrigin) {
        return { url: playerOrigin.replace(/\/$/, "") + relX[0], type: relX[0].includes(".m3u8") ? "hls" : "direct_mp4" };
      }
    } catch {
      // ignore malformed XOR bodies
    }
  }

  // 4. Direct MP4
  const mp4 = combined.match(/https?:\/\/[^\s"'<>|]+\.mp4(?:[^\s"'<>|]*)/i);
  if (mp4) {
    return { url: mp4[0], type: "direct_mp4" };
  }

  return null;
}

/**
 * Generic player-page probe: fetches the embed page, scans raw + unpacked
 * HTML for a playable stream, resolves real HLS tracks when possible.
 * Used for the packed-player family AND as a last-resort for unknown hosts.
 */
export async function probeGenericPlayerPage(playerUrl: string, hostLabel?: string): Promise<ExtractedStreamResult | null> {
  try {
    const originMatch = playerUrl.match(/^(https?:\/\/[^/]+)/i);
    if (!originMatch) return null;
    const playerOrigin = originMatch[1];

    const resp = await axios.get(playerUrl, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": `${playerOrigin}/`
      },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
      ...animeProxyOptions()
    });
    if (resp.status !== 200) return null;
    const rawHtml = typeof resp.data === "string" ? resp.data : "";
    if (!rawHtml) return null;

    const scan = scanPlayerHtmlForStreams(rawHtml, playerOrigin);
    if (!scan) return null;

    const headers = {
      "User-Agent": DEFAULT_USER_AGENT,
      "Referer": `${playerOrigin}/`,
      "Origin": playerOrigin
    };

    let tracks: StreamQualityTrack[] = [];
    if (scan.type === "hls") {
      try {
        tracks = await fetchHlsTracksAndSizes(scan.url, `${playerOrigin}/`, playerOrigin);
      } catch {
        // tracks are optional — the bare URL is still usable
      }
    }

    let host = hostLabel || "";
    if (!host) {
      try {
        host = new URL(playerUrl).hostname.replace(/^www\./, "");
      } catch {
        host = "Packed Player";
      }
    }

    return {
      hostName: host,
      url: scan.url,
      type: scan.type,
      headers,
      availableTracks: tracks
    };
  } catch (err: any) {
    if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] generic probe error (${playerUrl}):`, err.message);
    return null;
  }
}

/**
 * voe embed resolver: follows in-page window.location hops, decodes the
 * application/json payload chain, falls back to a plain m3u8 scan.
 * Returns a direct stream URL (usually mp4) or null.
 */
async function extractVoeStream(voeUrl: string, depth = 0): Promise<string | null> {
  try {
    const resp = await axios.get(voeUrl, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://nakanime.tv/"
      },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
      ...animeProxyOptions()
    });
    if (resp.status !== 200) return null;
    const html = typeof resp.data === "string" ? resp.data : "";

    // In-page redirect hop (voe chains landing pages)
    const loc = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
    if (loc && loc[1] && loc[1] !== voeUrl && depth < 3) {
      let next = loc[1];
      if (!next.startsWith("http")) {
        try {
          next = new URL(next, voeUrl).href;
        } catch {
          next = "";
        }
      }
      if (next) {
        const nested = await extractVoeStream(next, depth + 1);
        if (nested) return nested;
      }
    }

    // Encrypted JSON payload
    const jsonMatch = html.match(/<script type="application\/json">\s*(\[[\s\S]*?\])\s*<\/script>/);
    if (jsonMatch) {
      try {
        const arr = JSON.parse(jsonMatch[1]);
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") {
          const data = decodeVoePayload(arr[0]);
          const src = data?.source || data?.direct_access_url;
          if (typeof src === "string" && src && !/bigbuckbunny|sample/i.test(src)) {
            return src;
          }
        }
      } catch {
        // try the plain scan below
      }
    }

    // Plain m3u8 in page (skip known dummy streams)
    for (const m of html.matchAll(/["'](https?:\/\/[^\s"']+\.m3u8[^\s"']*)["']/gi)) {
      if (!/bigbuckbunny|sample/i.test(m[1])) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract direct streams from streaming player mirrors (Smoothpre, Sibnet, Sendvid, VidMoly, Ansembed)
 */
export async function extractMultiHostStream(playerUrl: string): Promise<ExtractedStreamResult | null> {
  try {
    if (!playerUrl) return null;
    const lowerUrl = playerUrl.toLowerCase();

    // 0. embed4me / Lplayer — encrypted JSON API player (current "Lecteur 1")
    if (lowerUrl.includes("embed4me") || lowerUrl.includes("lpayer")) {
      try {
        const idMatch = playerUrl.match(/#([a-zA-Z0-9]+)/) || playerUrl.match(/[?&]id=([a-zA-Z0-9]+)/);
        const originMatch = playerUrl.match(/^(https?:\/\/[^/]+)/i);
        const origin = originMatch ? originMatch[1] : "https://lpayer.embed4me.com";
        if (idMatch && idMatch[1]) {
          const apiUrl = `${origin}/api/v1/video?id=${idMatch[1]}&w=1920&h=1080&r=${origin}/`;
          const resp = await axios.get(apiUrl, {
            headers: { "User-Agent": DEFAULT_USER_AGENT, Referer: `${origin}/` },
            timeout: 8000,
            validateStatus: () => true,
            ...animeProxyOptions()
          });
          if (resp.status === 200 && typeof resp.data === "string") {
            const rawSource = decryptEmbed4MeResponse(resp.data);
            if (rawSource) {
              const streamUrl = rawSource.startsWith("/") ? origin + rawSource : rawSource;
              const streamHeaders = { "User-Agent": DEFAULT_USER_AGENT, Referer: `${origin}/`, Origin: origin };
              const parsedTracks = await fetchHlsTracksAndSizes(streamUrl, `${origin}/`, origin);
              return {
                hostName: "Embed4me",
                url: streamUrl,
                type: streamUrl.split("?")[0].endsWith(".mp4") ? "direct_mp4" : "hls",
                headers: streamHeaders,
                availableTracks: parsedTracks
              };
            }
          }
        }
      } catch (err: any) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] Embed4me probe error:`, err.message);
      }
    }

    // 0b. Filemoon — /api/videos/<code> returns an AES-GCM encrypted sources
    // payload (key reassembled from key_parts, see decryptFilemoonPayload).
    if (lowerUrl.includes("filemoon") || lowerUrl.includes("bysesukior")) {
      try {
        const codeMatch = playerUrl.match(/\/(?:e|d|download|play|v)\/([a-zA-Z0-9]+)/i);
        let code = codeMatch ? codeMatch[1] : "";
        if (!code) {
          const parts = playerUrl.split("?")[0].split("/").filter(Boolean);
          code = parts[parts.length - 1] || "";
        }
        const fmOriginMatch = playerUrl.match(/^(https?:\/\/[^/]+)/i);
        const fmOrigin = fmOriginMatch ? fmOriginMatch[1] : "https://bysesukior.com";
        if (code) {
          const resp = await axios.get(`${fmOrigin}/api/videos/${code}`, {
            headers: {
              "User-Agent": DEFAULT_USER_AGENT,
              "Referer": "https://nakanime.tv/",
              "Accept": "application/json, text/plain, */*"
            },
            timeout: 8000,
            validateStatus: () => true,
            ...animeProxyOptions()
          });
          if (resp.status === 200 && resp.data) {
            const playback = resp.data?.playback || resp.data;
            const decrypted = decryptFilemoonPayload(
              String(playback?.version ?? ""),
              playback?.key_parts,
              playback?.iv,
              playback?.payload
            );
            const sources = Array.isArray(decrypted?.sources) ? decrypted.sources : [];
            const first = sources.find((s: any) => typeof s?.url === "string" && s.url.length > 0);
            if (first) {
              const isHls = /\.m3u8/i.test(first.url);
              let fmTracks: StreamQualityTrack[] = [];
              if (isHls) {
                try {
                  fmTracks = await fetchHlsTracksAndSizes(first.url, `${fmOrigin}/`, fmOrigin);
                } catch {}
              }
              return {
                hostName: "Filemoon",
                url: first.url,
                type: isHls ? "hls" : "direct_mp4",
                headers: {
                  "User-Agent": DEFAULT_USER_AGENT,
                  "Referer": `${fmOrigin}/`,
                  "Origin": fmOrigin
                },
                availableTracks: fmTracks
              };
            }
          }
        }
      } catch (err: any) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] Filemoon probe error:`, err.message);
      }
      // Fallback: plain page scan (some mirrors expose m3u8 directly)
      const fmPage = await probeGenericPlayerPage(playerUrl, "Filemoon");
      if (fmPage) return fmPage;
    }

    // 0c. voe / voembed — rotating domains, payload hidden in an
    // application/json script tag (rot13 + double base64 chain, see
    // decodeVoePayload). The manifest's REAL variants are parsed so quality
    // labels and sizes are honest — without this, the quick flow labelled the
    // 480p voembed file "720P" from a synthesized fallback track (audit 8.11).
    if (isVoeStyleUrl(playerUrl)) {
      const voeStream = await extractVoeStream(playerUrl);
      if (voeStream) {
        const isHls = /\.m3u8/i.test(voeStream);
        const voeOriginMatch = playerUrl.match(/^(https?:\/\/[^/]+)/i);
        const voeOrigin = voeOriginMatch ? voeOriginMatch[1] : "https://voembed.net";
        let voeTracks: StreamQualityTrack[] = [];
        if (isHls) {
          try {
            voeTracks = await fetchHlsTracksAndSizes(voeStream, `${voeOrigin}/`, voeOrigin);
          } catch {
            // tracks are optional — the bare master URL stays usable
          }
        }
        return {
          hostName: "Voe",
          url: voeStream,
          type: isHls ? "hls" : "direct_mp4",
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": `${voeOrigin}/`,
            "Origin": voeOrigin
          },
          availableTracks: voeTracks
        };
      }
    }

    // 1. Packed / generic player family (Smoothpre, Movearnpre, Uqload,
    // Vidzy, LuluStream, OneUpload, Mivalyo, Dingtezuni, *embed*, *player*)
    if (
      NAKANIME_GENERIC_PLAYER_HINTS.some((h) => lowerUrl.includes(h)) ||
      lowerUrl.includes("embed") ||
      lowerUrl.includes("player")
    ) {
      const legacyLabel = lowerUrl.includes("smoothpre") || lowerUrl.includes("dramiyos") ? "Smoothpre" : undefined;
      const generic = await probeGenericPlayerPage(playerUrl, legacyLabel);
      if (generic) return generic;
    }

    // 2. Sibnet (Fast, direct MP4 delivery)
    if (lowerUrl.includes("sibnet.ru")) {
      try {
        const resp = await axios.get(playerUrl, {
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": "https://video.sibnet.ru/"
          },
          timeout: 6000,
          validateStatus: () => true,
    ...animeProxyOptions()
        });
        if (resp.status === 200) {
          const html = typeof resp.data === "string" ? resp.data : "";
          const match = html.match(/player\.src\(\[\{src:\s*["']([^"']+)["']/i) || html.match(/src:\s*["'](\/v\/[^"']+)["']/i);
          if (match && match[1]) {
            let streamPath = match[1];
            if (streamPath.startsWith("//")) {
              streamPath = "https:" + streamPath;
            } else if (streamPath.startsWith("/")) {
              streamPath = "https://video.sibnet.ru" + streamPath;
            }
            // ONE honest track: sibnet serves a single mp4 whose real
            // resolution is unknown without ffprobe — label it "Original" and
            // surface the REAL byte size via HEAD. The previous fabricated
            // 480P/360P pair made `.a ... r2` download a 299 MB 1080p file
            // labelled "360P" (audit 8.4).
            let sibnetSize = 0;
            try {
              const head = await axios.head(streamPath, {
                headers: { "User-Agent": DEFAULT_USER_AGENT, Referer: playerUrl },
                timeout: 5000,
                validateStatus: () => true,
                ...animeProxyOptions()
              });
              const len = parseInt(String(head.headers?.["content-length"] || "0"), 10);
              if (!isNaN(len) && len > 0) sibnetSize = len;
            } catch {}
            const sibnetHeaders = { "User-Agent": DEFAULT_USER_AGENT, "Referer": playerUrl };
            return {
              hostName: "Sibnet",
              url: streamPath,
              type: "direct_mp4",
              headers: sibnetHeaders,
              availableTracks: [
                {
                  resolution: "Original",
                  url: streamPath,
                  fileSizeBytes: sibnetSize || undefined,
                  type: "direct_mp4",
                  headers: sibnetHeaders
                }
              ]
            };
          }
        }
      } catch (err: any) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] Sibnet probe error:`, err.message);
      }
    }

    // 3. Sendvid (Direct MP4 with exact resolutions)
    if (lowerUrl.includes("sendvid.com")) {
      try {
        const resp = await axios.get(playerUrl, {
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": "https://anime-sama.to/"
          },
          timeout: 6000,
          validateStatus: () => true,
    ...animeProxyOptions()
        });
        if (resp.status === 200) {
          const html = typeof resp.data === "string" ? resp.data : "";
          const videoSrcMatch = html.match(/<source\s+src="([^"]+)"\s+type="video\/mp4"/i) || html.match(/var\s+video_source\s*=\s*["']([^"']+)["']/i);
          if (videoSrcMatch && videoSrcMatch[1]) {
            const streamUrl = videoSrcMatch[1];
            return {
              hostName: "Sendvid",
              url: streamUrl,
              type: "direct_mp4",
              headers: {
                "User-Agent": DEFAULT_USER_AGENT,
                "Referer": playerUrl
              },
              availableTracks: [
                {
                  resolution: "480P",
                  url: streamUrl,
                  fileSizeBytes: 80 * 1024 * 1024,
                  type: "direct_mp4",
                  headers: { "User-Agent": DEFAULT_USER_AGENT, "Referer": playerUrl }
                },
                {
                  resolution: "360P",
                  url: streamUrl,
                  fileSizeBytes: 50 * 1024 * 1024,
                  type: "direct_mp4",
                  headers: { "User-Agent": DEFAULT_USER_AGENT, "Referer": playerUrl }
                }
              ]
            };
          }
        }
      } catch (err: any) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] Sendvid probe error:`, err.message);
      }
    }

    // 4. VidMoly / Ansembed / Topembed (HLS with multi-quality playlist)
    if (lowerUrl.includes("vidmoly.") || lowerUrl.includes("ansembed.") || lowerUrl.includes("topembed.") || lowerUrl.includes("vmpx.")) {
      try {
        const resp = await axios.get(playerUrl, {
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": "https://anime-sama.to/"
          },
          timeout: 6000,
          validateStatus: () => true,
    ...animeProxyOptions()
        });
        if (resp.status === 200) {
          const html = typeof resp.data === "string" ? resp.data : "";
          const unpacked = unpackDeanEdwards(html);
          const combined = html + "\n" + unpacked;

          const sourcesMatch = combined.match(/sources:\s*\[([\s\S]*?)\]/i) || combined.match(/file:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
          let fileUrl = "";
          if (sourcesMatch) {
            if (sourcesMatch[1].startsWith("http")) {
              fileUrl = sourcesMatch[1];
            } else {
              const fileInArr = sourcesMatch[1].match(/file:\s*["']([^"']+)["']/i);
              if (fileInArr) fileUrl = fileInArr[1];
            }
          }

          if (!fileUrl) {
            const anyM3u8 = combined.match(/https?:\/\/[^"\x27\s<>]+\.(?:m3u8|txt)[^"\x27\s<>]*/i);
            if (anyM3u8) fileUrl = anyM3u8[0];
          }

          if (fileUrl) {
            const originMatch = playerUrl.match(/^(https?:\/\/[^/]+)/i);
            const playerOrigin = originMatch ? originMatch[1] : "https://vidmoly.to";
            let streamUrl = fileUrl;
            let streamHeaders: Record<string, string> = {
              "User-Agent": DEFAULT_USER_AGENT,
              "Referer": playerUrl,
              "Origin": playerOrigin
            };
            // Multi-quality urlset masters 403 on some CDN nodes while their
            // variant paths answer fine — resolve to a working media playlist
            // HERE and propagate the winning referer to every download engine
            // (audit 8.43; production case: Vinland Saga S02E05 on vmbox.space).
            if (fileUrl.includes(".urlset/")) {
              try {
                const resolvedUrlset = await resolveVidmolyUrlset(fileUrl, streamHeaders);
                if (resolvedUrlset) {
                  streamUrl = resolvedUrlset.mediaPlaylistUrl;
                  streamHeaders = { ...streamHeaders, ...resolvedUrlset.headers };
                }
              } catch {}
            }
            const parsedTracks = await fetchHlsTracksAndSizes(streamUrl, streamHeaders.Referer, streamHeaders.Origin);
            return {
              hostName: "VidMoly",
              url: streamUrl,
              type: "hls",
              headers: streamHeaders,
              availableTracks: parsedTracks
            };
          }
        }
      } catch (err: any) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] VidMoly probe error:`, err.message);
      }
    }

    // 5. Last-resort generic probe for ANY other host — one page fetch +
    // m3u8/mp4/packed scan. Keeps the pipeline alive when a mirror swaps to
    // a host nobody knows yet (the exact failure mode of audit §8 / R8).
    {
      const lastResort = await probeGenericPlayerPage(playerUrl);
      if (lastResort) {
        if (process.env.DEBUG_MEDIA) console.debug(`[STREAM_EXTRACTOR] last-resort generic probe HIT for ${playerUrl}`);
        return lastResort;
      }
    }
  } catch (err: any) {
    if (process.env.DEBUG_MEDIA) {
      console.debug(`[STREAM_EXTRACTOR] Probe note for ${playerUrl}:`, err.message);
    }
  }
  return null;
}

/**
 * Sums #EXTINF segment durations of a variant playlist (null when the
 * playlist cannot be read — master playlists return null too).
 */
async function resolvePlaylistDurationSeconds(
  playlistUrl: string,
  headers: Record<string, string>
): Promise<number | null> {
  try {
    const resp = await axios.get(playlistUrl, {
      headers,
      timeout: 6000,
      validateStatus: (st) => st === 200,
      ...animeProxyOptions()
    });
    const body = typeof resp.data === "string" ? resp.data : "";
    if (!body.includes("#EXTINF")) return null;
    let total = 0;
    for (const m of body.matchAll(/#EXTINF:([\d.]+)/g)) {
      total += parseFloat(m[1]);
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * Parses HLS playlist to detect available bandwidths, sub-variant URLs, and estimate episode sizes
 */
export async function fetchHlsTracksAndSizes(
  masterUrl: string,
  refererUrl: string,
  originUrl?: string
): Promise<StreamQualityTrack[]> {
  const tracks: StreamQualityTrack[] = [];
  const reqHeaders: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Referer": refererUrl
  };
  if (originUrl) {
    reqHeaders["Origin"] = originUrl;
  }

  try {
    const resp = await axios.get(masterUrl, {
      headers: reqHeaders,
      timeout: 8000,
      ...animeProxyOptions()
    });
    const manifest = typeof resp.data === "string" ? resp.data : "";
    const lines = manifest.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
        const nextUrlLine = lines[i + 1]?.trim();

        if (nextUrlLine && !nextUrlLine.startsWith("#")) {
          const streamUrl = resolveAbsoluteUrl(masterUrl, nextUrlLine);
          const height = resMatch ? parseInt(resMatch[1], 10) : 0;
          const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 800000;

          // Real size estimate: fetch this variant's playlist, sum its segment
          // durations (#EXTINF) and compute bandwidth * duration / 8. Falls
          // back to the 24-minute anime heuristic when the CDN refuses us.
          const durationSeconds = (await resolvePlaylistDurationSeconds(streamUrl, reqHeaders)) ?? 1440;
          const fileSizeBytes = Math.round((bandwidth * durationSeconds) / 8);

          let label = "480P";
          if (height >= 1000) label = "1080P";
          else if (height >= 700) label = "720P";
          else if (height >= 450) label = "480P";
          else if (height > 0) label = "360P";

          // Prevent duplicates for the same resolution label
          if (!tracks.some(t => t.resolution === label)) {
            tracks.push({
              resolution: label,
              url: streamUrl,
              bandwidth,
              fileSizeBytes,
              type: "hls",
              headers: reqHeaders
            });
          }
        }
      }
    }
  } catch (err: any) {
    if (process.env.DEBUG_MEDIA) {
      console.warn(`[STREAM_EXTRACTOR] Error inspecting HLS master:`, err.message);
    }
  }

  // No fabricated fallback: if the master could not be parsed we return an
  // empty list so the UI says "qualité adaptative" instead of offering
  // resolutions that cannot actually be downloaded (audit finding R8).

  // Sort: 480P, 360P, 720P, 1080P
  const orderMap: Record<string, number> = { "480P": 1, "360P": 2, "720P": 3, "1080P": 4, "ORIGINAL": 5 };
  tracks.sort((a, b) => (orderMap[a.resolution.toUpperCase()] || 99) - (orderMap[b.resolution.toUpperCase()] || 99));

  return tracks;
}

/**
 * Resolves best mirror stream among all player URLs for an episode
 */
export async function resolveBestMirrorStream(mirrorUrls: string[], preferredRes: string = "480P"): Promise<ExtractedStreamResult> {
  const sortedMirrors = [...mirrorUrls].sort((a, b) => hostPriority(a) - hostPriority(b));

  for (const mirror of sortedMirrors) {
    const extracted = await extractMultiHostStream(mirror);
    if (extracted && extracted.url) {
      return extracted;
    }
  }

  // Fallback
  return {
    hostName: "Direct Stream",
    url: mirrorUrls[0] || "",
    type: "hls",
    headers: { "Referer": "https://anime-sama.to/" }
  };
}

/**
 * Selects optimal stream based on user's priority for 480p/360p fast downloads
 */
function trackHeight(res: string | undefined): number {
  const m = (res || "").match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 720;
}

// Fast lanes (r1=480P, r2=360P) exist to deliver WhatsApp-friendly files.
// Some CDN encodes carry a "480P" label at ~2.3 Mbps (403 MB for 24 min,
// audit 8.13) — an exact-label match on those is worse than a lighter
// variant. When the exact fast-lane track exceeds this ceiling, the lightest
// <=480p alternative wins.
const FAST_LANE_MAX_BYTES = 200 * 1024 * 1024;

function fastLaneDowngrade(tracks: StreamQualityTrack[], match: StreamQualityTrack): StreamQualityTrack | null {
  const candidates = tracks.filter((t) => t.url && trackHeight(t.resolution) <= 480);
  if (candidates.length === 0) return null;
  const sizeKey = (t: StreamQualityTrack) => t.fileSizeBytes ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...candidates].sort((a, b) => sizeKey(a) - sizeKey(b));
  const lightest = sorted[0];
  if (!lightest || sizeKey(lightest) === Number.MAX_SAFE_INTEGER || lightest === match) return null;
  return lightest;
}

export function pickOptimalStream(tracks: StreamQualityTrack[], requestedRes?: string): StreamQualityTrack {
  if (!tracks || tracks.length === 0) {
    return { resolution: "480P", url: "", type: "hls" };
  }

  if (requestedRes) {
    const wanted = requestedRes.toUpperCase();
    const match = tracks.find(t => (t.resolution || "").toUpperCase() === wanted);
    if (match) {
      if (
        (wanted === "480P" || wanted === "360P") &&
        match.fileSizeBytes &&
        match.fileSizeBytes > FAST_LANE_MAX_BYTES
      ) {
        const alt = fastLaneDowngrade(tracks, match);
        if (alt) {
          console.warn(
            `[STREAM_EXTRACTOR] Fast-lane "${wanted}" track is ${(match.fileSizeBytes / 1048576).toFixed(0)} MB (>200 MB) - using lighter ${(alt.resolution || "").toUpperCase()} variant (${((alt.fileSizeBytes || 0) / 1048576).toFixed(0)} MB)`
          );
          return alt;
        }
      }
      return match;
    }

    // Requested quality missing on this mirror: prefer the tallest track that
    // is NOT taller than the request (fast lanes stay fast); if everything is
    // taller, take the smallest available (audit §8.3 — `.a … r2` used to
    // silently land on 1080P when a mirror only exposed 720P/1080P).
    const byHeight = [...tracks].sort((a, b) => trackHeight(a.resolution) - trackHeight(b.resolution));
    const under = byHeight.filter(t => trackHeight(t.resolution) <= trackHeight(wanted));
    if (under.length > 0) return under[under.length - 1];
    return byHeight[0];
  }

  // Priority order: 480p > 360p > 720p > 1080p
  const p480 = tracks.find(t => t.resolution.toUpperCase() === "480P");
  if (p480) return p480;

  const p360 = tracks.find(t => t.resolution.toUpperCase() === "360P");
  if (p360) return p360;

  const p720 = tracks.find(t => t.resolution.toUpperCase() === "720P");
  if (p720) return p720;

  return tracks[0];
}

/**
 * Downloads direct MP4 or HLS stream directly to disk with proper browser headers
 */
export async function downloadStreamToDisk(stream: ExtractedStreamResult, outputPath: string, timeoutMs: number = 40000): Promise<boolean> {
  return executeDirectOrFfmpegDownload(stream, outputPath, timeoutMs);
}

// Re-export core robust fetchers and URL tools from hlsDownloader
export { robustFetchText, robustFetchBuffer, resolveAbsoluteUrl };

/**
 * Quick-mode quality resolver: probes mirrors in reliability order (VidMoly
 * first) and lets the FIRST mirror that yields usable tracks decide — exact
 * canonical quality when present, else pickOptimalStream's nearest. This
 * early-exit keeps `.a ... rN` at one probe in the common case instead of
 * walking every mirror of the episode (audit 8.5).
 */
export type MirrorProbeFn = (url: string) => Promise<ExtractedStreamResult | null>;

export interface CanonicalQualityMatch {
  url: string;
  headers?: Record<string, string>;
  label: string;
  exact: boolean;
  mirror: string;
}

export async function resolveCanonicalQualityTrack(
  mirrorUrls: string[],
  canonical: string,
  probe: MirrorProbeFn = extractMultiHostStream
): Promise<CanonicalQualityMatch | null> {
  if (!mirrorUrls || mirrorUrls.length === 0) return null;
  const sorted = [...mirrorUrls].sort((a, b) => hostPriority(a) - hostPriority(b));
  for (const mirror of sorted) {
    let extracted: ExtractedStreamResult | null = null;
    try {
      extracted = await probe(mirror);
    } catch {
      extracted = null;
    }
    if (!extracted || !extracted.url) continue;

    const tracks: StreamQualityTrack[] =
      extracted.availableTracks && extracted.availableTracks.length > 0
        ? extracted.availableTracks
        : [
            {
              resolution: extracted.type === "direct_mp4" ? "Original" : "720P",
              url: extracted.url,
              headers: extracted.headers,
              type: extracted.type
            }
          ];

    const exact = tracks.find((t) => t.url && (t.resolution || "").toUpperCase() === canonical.toUpperCase());
    if (exact) {
      if (
        (canonical.toUpperCase() === "480P" || canonical.toUpperCase() === "360P") &&
        exact.fileSizeBytes &&
        exact.fileSizeBytes > FAST_LANE_MAX_BYTES
      ) {
        const alt = fastLaneDowngrade(tracks, exact);
        if (alt && alt.url) {
          console.warn(
            `[STREAM_EXTRACTOR] Quick "${canonical}" exact match is ${(exact.fileSizeBytes / 1048576).toFixed(0)} MB (>200 MB) - using lighter ${(alt.resolution || "").toUpperCase()} variant`
          );
          return {
            url: alt.url,
            headers: alt.headers || extracted.headers,
            label: (alt.resolution || canonical).toUpperCase(),
            exact: false,
            mirror
          };
        }
      }
      return {
        url: exact.url,
        headers: exact.headers || extracted.headers,
        label: (exact.resolution || canonical).toUpperCase(),
        exact: true,
        mirror
      };
    }
    const alt = pickOptimalStream(tracks, canonical);
    if (alt && alt.url) {
      return {
        url: alt.url,
        headers: alt.headers || extracted.headers,
        label: (alt.resolution || canonical).toUpperCase(),
        exact: false,
        mirror
      };
    }
    // Mirror yielded a stream but no usable track — try the next mirror.
  }
  return null;
}

/**
 * Iterates through all available mirrors for an episode and executes the download,
 * guaranteeing seamless fallback if any host encounters a 403 Forbidden or network failure.
 */
export async function downloadWithAllMirrorsFallback(
  mirrorUrls: string[],
  preferredRes: string,
  outputPath: string,
  timeoutMs: number = 240000
): Promise<{ success: boolean; hostName: string; usedUrl: string }> {
  if (!mirrorUrls || mirrorUrls.length === 0) {
    return { success: false, hostName: "None", usedUrl: "" };
  }

  // Sort mirrors by current reliability order (see hostPriority)
  const sortedMirrors = [...mirrorUrls].sort((a, b) => hostPriority(a) - hostPriority(b));

  for (let i = 0; i < sortedMirrors.length; i++) {
    const mirrorUrl = sortedMirrors[i];
    if (isDeadFileSlug(mirrorUrl)) {
      console.warn(`[MIRROR_FALLBACK] Skipping mirror ${i + 1}/${sortedMirrors.length} (file known dead from a recent attempt)`);
      continue;
    }
    try {
      console.log(`[MIRROR_FALLBACK] Probing mirror ${i + 1}/${sortedMirrors.length}: ${mirrorUrl}`);
      const extracted = await extractMultiHostStream(mirrorUrl);
      if (!extracted || !extracted.url) {
        console.warn(`[MIRROR_FALLBACK] Could not extract stream from mirror ${mirrorUrl}`);
        continue;
      }

      // Pick preferred resolution track if available
      let targetStream = extracted;
      if (extracted.availableTracks && extracted.availableTracks.length > 0) {
        const picked = pickOptimalStream(extracted.availableTracks, preferredRes);
        if (picked && picked.url) {
          targetStream = {
            ...extracted,
            url: picked.url,
            type: picked.type || extracted.type,
            headers: picked.headers || extracted.headers
          };
        }
      }

      console.log(`[MIRROR_FALLBACK] Attempting download with host "${targetStream.hostName}" on URL: ${targetStream.url}`);
      const dlSuccess = await executeDirectOrFfmpegDownload(targetStream, outputPath, timeoutMs);

      if (dlSuccess && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        console.log(`[MIRROR_FALLBACK] Mirror ${targetStream.hostName} succeeded! Size: ${fs.statSync(outputPath).size} bytes`);
        return { success: true, hostName: targetStream.hostName, usedUrl: targetStream.url };
      }

      console.warn(`[MIRROR_FALLBACK] Mirror ${targetStream.hostName} download failed or produced empty file. Trying next mirror...`);
      markDeadFileSlug(mirrorUrl);
    } catch (err: any) {
      console.warn(`[MIRROR_FALLBACK] Error on mirror ${mirrorUrl}: ${err.message}. Trying next mirror...`);
      markDeadFileSlug(mirrorUrl);
    }
  }

  return { success: false, hostName: "Failed", usedUrl: "" };
}

/**
 * Prepares a local HLS playlist by making segment URLs absolute and appending original query params to bypass CDN 403 Forbidden checks.
 */
export async function prepareLocalHlsPlaylist(
  playlistUrl: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    // Resolve master or variant playlist down to media segments
    const resolved = await resolveMediaPlaylistUrl(playlistUrl, headers);
    if (!resolved || !resolved.content) {
      console.warn(`[HLS_PREPARE] Invalid or unreachable playlist content from: ${playlistUrl}`);
      return null;
    }

    const { mediaPlaylistUrl, content: playlistContent } = resolved;

    // Rewrite lines to make segment and key URLs absolute with original search params
    const lines = playlistContent.split(/\r?\n/);
    const modifiedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        modifiedLines.push(line);
        continue;
      }

      if (trimmed.startsWith("#")) {
        // Handle #EXT-X-KEY if present for AES-128 streams
        if (trimmed.startsWith("#EXT-X-KEY:")) {
          const uriMatch = trimmed.match(/URI=["']([^"']+)["']/i);
          if (uriMatch && uriMatch[1]) {
            const keyUri = uriMatch[1];
            const absoluteKeyUrl = resolveAbsoluteUrl(mediaPlaylistUrl, keyUri);
            const rewrittenKey = trimmed.replace(uriMatch[1], absoluteKeyUrl);
            modifiedLines.push(rewrittenKey);
            continue;
          }
        }
        // Handle #EXT-X-MAP:URI if present
        if (trimmed.startsWith("#EXT-X-MAP:")) {
          const mapMatch = trimmed.match(/URI=["']([^"']+)["']/i);
          if (mapMatch && mapMatch[1]) {
            const absoluteMapUrl = resolveAbsoluteUrl(mediaPlaylistUrl, mapMatch[1]);
            const rewrittenMap = trimmed.replace(mapMatch[1], absoluteMapUrl);
            modifiedLines.push(rewrittenMap);
            continue;
          }
        }
        modifiedLines.push(line);
      } else {
        // Segment URL
        const absoluteSegmentUrl = resolveAbsoluteUrl(mediaPlaylistUrl, trimmed);
        modifiedLines.push(absoluteSegmentUrl);
      }
    }

    // Write to a temporary file in the OS temp directory
    const tempFilename = `auth_playlist_${crypto.randomBytes(8).toString("hex")}.m3u8`;
    const tempPath = path.join(os.tmpdir(), tempFilename);
    fs.writeFileSync(tempPath, modifiedLines.join("\n"), "utf-8");

    if (process.env.DEBUG_MEDIA !== "false") {
      console.log(`[HLS_PREPARE] Generated local authenticated HLS playlist at: ${tempPath}`);
    }
    return tempPath;
  } catch (err: any) {
    console.error(`[HLS_PREPARE] Error preparing local HLS playlist:`, err.message);
    return null;
  }
}

/**
 * Executes direct stream download or ffmpeg compilation with custom headers
 */
export async function executeDirectOrFfmpegDownload(
  stream: { url: string; type?: string; headers?: Record<string, string> },
  outputPath: string,
  timeoutMs: number = 40000
): Promise<boolean> {
  try {
    if (!stream.url) return false;

    // Dead-file memory (audit 8.47): skip files whose every path×referer
    // recently failed — a fresh mirror of the SAME file only burns minutes.
    if (isDeadFileSlug(stream.url)) {
      console.warn(`[STREAM_EXTRACTOR] Skipping known-dead file: ${stream.url.split("?")[0]}`);
      return false;
    }

    // Funnel-level urlset guard (audit 8.45): EVERY extraction branch
    // converges here — including the generic last-resort probe, which is the
    // branch that actually extracts vidmoly embeds in production (hostName
    // "vidmoly.biz"; the dedicated vidmoly branch gets its embed fetch 403'd
    // by the referer it uses). Multi-quality urlset masters 403 on some CDN
    // nodes while variant paths answer — resolve once, for everyone.
    if (stream.url.includes(".urlset/")) {
      try {
        const resolvedUrlset = await resolveVidmolyUrlset(stream.url, stream.headers || {});
        if (resolvedUrlset) {
          stream = {
            ...stream,
            url: resolvedUrlset.mediaPlaylistUrl,
            headers: { ...stream.headers, ...resolvedUrlset.headers }
          };
        }
      } catch {}
    }

    // Direct HTTP download for clean MP4 sources
    if (stream.type === "direct_mp4" || stream.url.endsWith(".mp4")) {
      const writer = fs.createWriteStream(outputPath);
      const response = await axios({
        method: "get",
        url: stream.url,
        responseType: "stream",
        headers: stream.headers || {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: timeoutMs,
        ...animeProxyOptions()
      });

      response.data.pipe(writer);
      return new Promise((resolve) => {
        writer.on("finish", () => {
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        writer.on("error", () => resolve(false));
      });
    }

    // HLS Stream download: Try Cat-Catch style application-level parallel downloader first
    const headers = stream.headers || {};
    try {
      console.log(`[STREAM_EXTRACTOR] Launching primary Cat-Catch style HLS downloader for: ${stream.url}`);
      // Give the application-level downloader a comfortable timeout (e.g. 4 minutes)
      const catCatchSuccess = await downloadHlsAppLevel(stream.url, outputPath, headers, 240000);
      if (catCatchSuccess && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        console.log(`[STREAM_EXTRACTOR] Primary Cat-Catch HLS download succeeded! Output size: ${fs.statSync(outputPath).size} bytes`);
        return true;
      }
      console.warn(`[STREAM_EXTRACTOR] Primary Cat-Catch HLS download failed or returned invalid file. Falling back to legacy network FFmpeg...`);
    } catch (catErr: any) {
      console.warn(`[STREAM_EXTRACTOR] Error in primary Cat-Catch HLS downloader: ${catErr.message}. Falling back to legacy network FFmpeg...`);
    }

    // Secondary fallback: HLS Stream download via direct network FFmpeg
    let userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let headerStr = "";
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "user-agent") {
        userAgent = value;
      } else {
        headerStr += `${key}: ${value}\r\n`;
      }
    }

    // Pre-resolve segments with tokens to prevent 403 CDN Forbidden errors
    const localPlaylistPath = await prepareLocalHlsPlaylist(stream.url, headers);
    const ffmpegInput = localPlaylistPath || stream.url;

    return new Promise((resolve) => {
      const args = [
        "-y",
        "-user_agent", userAgent,
        "-headers", headerStr,
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "3",
        "-rw_timeout", "10000000",
        "-analyzeduration", "5M",
        "-probesize", "5M",
        "-i", ffmpegInput,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        "-movflags", "+faststart",
        outputPath
      ];

      const proc = spawn(resolvedFfmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      
      let stderrLog = "";
      proc.stderr?.on("data", (chunk) => {
        stderrLog += chunk.toString();
      });

      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        resolve(false);
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          resolve(true);
        } else {
          console.warn(`[STREAM_EXTRACTOR] Secondary FFmpeg fallback close code: ${code}. Output size: ${fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0} bytes. stderr:`, stderrLog);
          resolve(false);
        }
      });

      proc.on("error", () => {
        clearTimeout(timer);
        if (localPlaylistPath && fs.existsSync(localPlaylistPath)) {
          try { fs.unlinkSync(localPlaylistPath); } catch {}
        }
        resolve(false);
      });
    });
  } catch (err: any) {
    console.warn("[STREAM_EXTRACTOR] Download error:", err.message);
    return false;
  }
}
