import axios from "axios";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { isSafeDownloadUrl } from "../urlSafety.js";
import { animeProxyOptions } from "./scrapingProxy.js";

import { resolvedFfmpegPath } from "../ffmpeg.js";

/**
 * Resolves absolute URL based on parent playlist URL and relative path.
 */
export function resolveAbsoluteUrl(parentUrl: string, relativePath: string): string {
  try {
    const parentObj = new URL(parentUrl);
    const resolvedUrlObj = new URL(relativePath, parentUrl);

    // Copy search params from parent to keep signature tokens/cookies bypass
    parentObj.searchParams.forEach((val, key) => {
      if (!resolvedUrlObj.searchParams.has(key)) {
        resolvedUrlObj.searchParams.set(key, val);
      }
    });

    return resolvedUrlObj.toString();
  } catch {
    return relativePath;
  }
}

/**
 * True for the VidMoly file-CDN family. The embeds live on vidmoly.biz but
 * serve files from a rotating set of CDN hosts (vmpx/vmeas/vmget/vmnow/
 * vmbox/vmcld/…). Production logs (audits 8.40 + 8.43) show the family
 * grows faster than any explicit list, so the `/hls2/` path signature —
 * present on every URL of this CDN family — is matched too.
 */
export function isVidmolyCdnUrl(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes("/hls2/") ||
    l.includes("vmpx.") ||
    l.includes("vidmoly.") ||
    l.includes("ansembed.") ||
    l.includes("topembed.") ||
    l.includes("vmeas.") ||
    l.includes("vmget.") ||
    l.includes("vmnow.") ||
    l.includes("vmbox.") ||
    l.includes("vmcld.")
  );
}

/**
 * Builds candidate header configurations for challenging streaming CDNs (VidMoly, VMPX, Smoothpre, etc.)
 *
 * Exported for tests (audit 8.40).
 */
export function getHeaderCandidates(url: string, baseHeaders: Record<string, string>): Array<Record<string, string>> {
  const userAgent = baseHeaders["User-Agent"] || baseHeaders["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const standardBrowser: Record<string, string> = {
    "User-Agent": userAgent,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site"
  };

  const candidates: Array<Record<string, string>> = [];

  // Candidate 1: Full base headers merged with browser standard
  candidates.push({ ...standardBrowser, ...baseHeaders });

  // Candidate 2: VidMoly stream family. The embeds live on vidmoly.biz and
  // serve files from a rotation of CDN hosts (vmpx/vmeas/vmnow/vmget/vmbox/
  // vmcld/... — see isVidmolyCdnUrl); the file host in the URL is NOT enough
  // to know which referer the node accepts, so we try them all. Audit 8.43:
  // vidmoly.biz (the actual embed host) first — it unblocked production 403s.
  if (isVidmolyCdnUrl(url)) {
    candidates.push({
      ...standardBrowser,
      "Referer": "https://vidmoly.biz/",
      "Origin": "https://vidmoly.biz"
    });
    candidates.push({
      ...standardBrowser,
      "Referer": "https://vidmoly.to/",
      "Origin": "https://vidmoly.to"
    });
    candidates.push({
      ...standardBrowser,
      "Referer": "https://vidmoly.net/",
      "Origin": "https://vidmoly.net"
    });
    candidates.push({
      ...standardBrowser,
      "Referer": "https://vmpx.online/",
      "Origin": "https://vmpx.online"
    });
    candidates.push({
      ...standardBrowser,
      "Referer": "https://ansembed.net/",
      "Origin": "https://ansembed.net"
    });
    candidates.push({
      ...standardBrowser,
      "Referer": "https://anime-sama.to/",
      "Origin": "https://anime-sama.to"
    });
  } else {
    // For general CDNs
    try {
      const parsed = new URL(url);
      candidates.push({
        ...standardBrowser,
        "Referer": `${parsed.protocol}//${parsed.host}/`,
        "Origin": `${parsed.protocol}//${parsed.host}`
      });
      candidates.push({
        ...standardBrowser,
        "Referer": "https://anime-sama.to/"
      });
    } catch {}
  }

  // Candidate Last: Clean User-Agent only
  candidates.push({ "User-Agent": userAgent, "Accept": "*/*" });

  return candidates;
}

/**
 * Derives potential sub-variant URLs if a multi-set master playlist returns 403 or is restricted.
 *
 * Audit 8.40: episodes served as `_,n,l,.urlset/master.m3u8` sometimes 403 on
 * the master path while the variant paths stay perfectly downloadable (every
 * working vidmoly URL in production logs has the shape
 * `{prefix}_{q}/index-v1-a1.m3u8`). Derived candidates now lead with that
 * proven shape before the generic guesses.
 */
export function deriveSubVariantUrls(masterUrl: string): string[] {
  const variants: string[] = [];
  try {
    // Check for Wowza / Nimble .urlset pattern (e.g. eamuwrromj23_,n,l,.urlset/master.m3u8)
    if (masterUrl.includes(".urlset/")) {
      const match = masterUrl.match(/([^/]+)_,([a-zA-Z0-9,]+),\.urlset\/master\.(m3u8|txt)(\?.*)?$/);
      if (match) {
        const prefix = match[1];
        const qualities = match[2].split(",");
        const ext = match[3];
        const query = match[4] || "";
        const base = masterUrl.substring(0, masterUrl.indexOf(`${prefix}_,`));

        for (const q of [...qualities].reverse()) {
          if (!q) continue;
          // Proven shape on the vidmoly CDN family — try FIRST. The LAST
          // letter of the urlset is the rendition every single-quality file
          // uses in production (`{id}_l/index-v1-a1.m3u8`), so reversing the
          // letter order favours it (audit 8.43).
          variants.push(`${base}${prefix}_${q}/index-v1-a1.${ext}${query}`);
          variants.push(`${base}${prefix}_${q}/index-f1-v1-a1.${ext}${query}`);
          variants.push(`${base}${prefix}_${q}/index.${ext}${query}`);
          variants.push(`${base}${prefix}_${q}.${ext}${query}`);
        }
        variants.push(`${base}${prefix}/index-v1-a1.${ext}${query}`);
        variants.push(`${base}${prefix}/index.${ext}${query}`);
      }
    }

    // Check for master.txt VidMoly sub-playlists
    if (masterUrl.includes("master.txt")) {
      const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      const query = masterUrl.includes("?") ? masterUrl.substring(masterUrl.indexOf("?")) : "";
      variants.push(`${baseUrl}index-f1-v1-a1.txt${query}`);
      variants.push(`${baseUrl}index-f2-v1-a1.txt${query}`);
      variants.push(`${baseUrl}index-f3-v1-a1.txt${query}`);
    }
  } catch {}
  return variants;
}

/**
 * Fetches textual content with multiple fallback layers and header rotations.
 */
export async function robustFetchText(url: string, headers: Record<string, string>): Promise<string | null> {
  if (!url || !(await isSafeDownloadUrl(url).catch(() => false))) {
    console.warn(`[ROBUST_FETCH] Blocked non-public destination: ${url}`);
    return null;
  }

  const isValid = (body: any) => typeof body === "string" && body.trim().length > 0;
  const headerCandidates = getHeaderCandidates(url, headers);

  for (let i = 0; i < headerCandidates.length; i++) {
    const candidateHeaders = headerCandidates[i];

    // Try Axios
    try {
      const resp = await axios.get(url, { headers: candidateHeaders, timeout: 10000, validateStatus: (status) => status === 200, ...animeProxyOptions() });
      if (isValid(resp.data)) return resp.data;
    } catch (err: any) {
      if (process.env.DEBUG_MEDIA === "true") {
        console.warn(`[ROBUST_FETCH] Candidate ${i + 1} (Axios) failed for ${url}: ${err.message}`);
      }
    }

    // Try Native fetch
    try {
      const resp = await fetch(url, { headers: candidateHeaders, signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const text = await resp.text();
        if (isValid(text)) return text;
      }
    } catch (err: any) {
      if (process.env.DEBUG_MEDIA === "true") {
        console.warn(`[ROBUST_FETCH] Candidate ${i + 1} (Native) failed for ${url}: ${err.message}`);
      }
    }
  }

  // If primary master URL fails, attempt sub-variants if applicable
  const subVariants = deriveSubVariantUrls(url);
  for (const subUrl of subVariants) {
    for (const h of headerCandidates.slice(0, 5)) {
      try {
        const resp = await axios.get(subUrl, { headers: h, timeout: 8000, validateStatus: (s) => s === 200, ...animeProxyOptions() });
        if (isValid(resp.data) && resp.data.includes("#EXT")) {
          console.log(`[ROBUST_FETCH] Sub-variant fallback succeeded for: ${subUrl}`);
          return resp.data;
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Single-shot text fetch with ONE header set (axios then native fetch).
 * Returns null on any failure — callers orchestrate retries.
 */
async function fetchTextOnce(url: string, headers: Record<string, string>, timeoutMs = 6000): Promise<string | null> {
  if (!(await isSafeDownloadUrl(url).catch(() => false))) return null;
  try {
    const resp = await axios.get(url, {
      headers,
      timeout: timeoutMs,
      validateStatus: (status) => status === 200,
      ...animeProxyOptions()
    });
    if (typeof resp.data === "string" && resp.data.trim().length > 0) return resp.data;
  } catch {}
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (resp.ok) {
      const text = await resp.text();
      if (text.trim().length > 0) return text;
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Dead-file memory (audit 8.47): the vidmoly family serves the SAME file id
// from several embed hosts (.biz/.org/...). When a file's EVERY path×referer
// 403s, retrying it via another host just burns minutes (production log:
// 34 attempts + two FFmpeg runs for nothing). Remember dead slugs 30 min.
// ---------------------------------------------------------------------------

const deadFileSlugs = new Map<string, number>();
const DEAD_SLUG_TTL_MS = 30 * 60 * 1000;
const DEAD_SLUG_MAX = 200;

/** File id from an embed URL or a CDN media/urlset URL (null when absent). */
export function extractVidmolyFileSlug(url: string): string | null {
  try {
    const embed = url.match(/embed-([a-z0-9]{8,15})\.html/i);
    if (embed) return embed[1].toLowerCase();
    const cdn = url.match(/\/([a-z0-9]{10,12})(?=[_,.])/i);
    if (cdn) return cdn[1].toLowerCase();
  } catch {}
  return null;
}

export function markDeadFileSlug(url: string): void {
  const slug = extractVidmolyFileSlug(url);
  if (!slug) return;
  if (deadFileSlugs.size >= DEAD_SLUG_MAX) {
    const oldest = [...deadFileSlugs.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) deadFileSlugs.delete(oldest[0]);
  }
  deadFileSlugs.set(slug, Date.now());
}

export function isDeadFileSlug(url: string): boolean {
  const slug = extractVidmolyFileSlug(url);
  if (!slug) return false;
  const at = deadFileSlugs.get(slug);
  if (!at) return false;
  if (Date.now() - at > DEAD_SLUG_TTL_MS) {
    deadFileSlugs.delete(slug);
    return false;
  }
  return true;
}

export function clearDeadSlugsForTests(): void {
  deadFileSlugs.clear();
}

/**
 * Resolves a VidMoly `_,n,l,.urlset/master.m3u8` URL that 403s on the master
 * path down to a downloadable media playlist, brute-forcing the matrix
 * (derived variant paths × referer candidates) with a bounded attempt
 * budget. Returns the winning URL AND the header set that worked so callers
 * can propagate the referer to every download engine (audit 8.43 — in the
 * 8.40 fix the winning referer existed but was never tried: vmbox.space was
 * not in the CDN family list, so only 3 referers reached the variants).
 */
export const VIDMOLY_URLSET_ATTEMPT_BUDGET = 34;

export async function resolveVidmolyUrlset(
  masterUrl: string,
  baseHeaders: Record<string, string>
): Promise<{ mediaPlaylistUrl: string; headers: Record<string, string> } | null> {
  if (!masterUrl.includes(".urlset/")) return null;
  if (isDeadFileSlug(masterUrl)) {
    console.warn(`[VIDMOLY_URLSET] Skipping known-dead file (recent full failure): ${masterUrl.split("?")[0]}`);
    return null;
  }
  const referers = getHeaderCandidates(masterUrl, baseHeaders);
  let attempts = 0;

  // 1) The master itself may only need the right referer.
  for (const h of referers) {
    if (attempts >= VIDMOLY_URLSET_ATTEMPT_BUDGET) break;
    attempts++;
    const content = await fetchTextOnce(masterUrl, h, 6000);
    if (content && content.includes("#EXT")) {
      console.log(`[VIDMOLY_URLSET] Master unblocked with referer ${h.Referer || "(base)"}.`);
      return { mediaPlaylistUrl: masterUrl, headers: h };
    }
  }

  // 2) Derived variant paths (proven shapes first) × referers.
  // Both urlset letters' proven shapes: `_l` (the rendition single-quality
  // files use) first, then `_n` — audit 8.45.
  const variants = deriveSubVariantUrls(masterUrl).slice(0, 6);
  for (const v of variants) {
    for (const h of referers) {
      if (attempts >= VIDMOLY_URLSET_ATTEMPT_BUDGET) break;
      attempts++;
      const content = await fetchTextOnce(v, h, 6000);
      if (content && content.includes("#EXT")) {
        console.log(
          `[VIDMOLY_URLSET] Master 403 bypassed: variant ${v.split("?")[0].split("/").pop()} answers with referer ${h.Referer || "(base)"}.`
        );
        return { mediaPlaylistUrl: v, headers: h };
      }
    }
    if (attempts >= VIDMOLY_URLSET_ATTEMPT_BUDGET) break;
  }

  console.warn(
    `[VIDMOLY_URLSET] Unresolved after ${attempts} attempt(s) (${variants.length} variant shape(s) × ${referers.length} referer(s)): ${masterUrl.split("?")[0]}`
  );
  return null;
}

/**
 * Fetches binary content (Buffers) with multiple fallback layers and header rotations.
 */
export async function robustFetchBuffer(url: string, headers: Record<string, string>): Promise<Buffer | null> {
  if (!url || !(await isSafeDownloadUrl(url).catch(() => false))) {
    console.warn(`[ROBUST_BUFFER] Blocked non-public destination: ${url}`);
    return null;
  }

  const isValid = (buf: any) => buf && Buffer.isBuffer(buf) && buf.length > 0;
  const headerCandidates = getHeaderCandidates(url, headers);

  for (let i = 0; i < headerCandidates.length; i++) {
    const candidateHeaders = headerCandidates[i];

    // Try Axios arraybuffer
    try {
      const resp = await axios.get(url, { headers: candidateHeaders, timeout: 15000, responseType: "arraybuffer", validateStatus: (status) => status >= 200 && status < 300, ...animeProxyOptions() });
      const buf = Buffer.from(resp.data);
      if (isValid(buf)) return buf;
    } catch (err: any) {
      if (process.env.DEBUG_MEDIA === "true") {
        console.warn(`[ROBUST_BUFFER] Candidate ${i + 1} (Axios) failed for ${url}: ${err.message}`);
      }
    }

    // Try Native fetch
    try {
      const resp = await fetch(url, { headers: candidateHeaders, signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        if (isValid(buf)) return buf;
      }
    } catch (err: any) {
      if (process.env.DEBUG_MEDIA === "true") {
        console.warn(`[ROBUST_BUFFER] Candidate ${i + 1} (Native) failed for ${url}: ${err.message}`);
      }
    }
  }

  return null;
}

/**
 * Resolves a master or child HLS playlist down to the actual media playlist containing video segments.
 */
export async function resolveMediaPlaylistUrl(
  inputUrl: string,
  headers: Record<string, string>,
  preferredRes?: string
): Promise<{ mediaPlaylistUrl: string; content: string } | null> {
  let currentUrl = inputUrl;
  let attempts = 0;

  while (attempts < 4) {
    attempts++;
    let content = await robustFetchText(currentUrl, headers);
    
    // If direct fetch fails, attempt sub-variants
    if (!content) {
      const subVariants = deriveSubVariantUrls(currentUrl);
      for (const sub of subVariants) {
        const subContent = await robustFetchText(sub, headers);
        if (subContent && (subContent.includes("#EXT") || subContent.includes("#EXTM3U") || subContent.includes("#EXTINF"))) {
          currentUrl = sub;
          content = subContent;
          break;
        }
      }
    }

    if (!content || (!content.includes("#EXT") && !content.includes("#EXTM3U") && !content.includes("#EXTINF"))) {
      console.warn(`[RESOLVE_HLS] Could not fetch valid HLS content for: ${currentUrl}`);
      return null;
    }

    // Check if this is a Master Playlist containing stream variants
    if (content.includes("#EXT-X-STREAM-INF")) {
      console.log(`[RESOLVE_HLS] Detected Master Playlist at: ${currentUrl}. Extracting media stream variants...`);
      const lines = content.split(/\r?\n/);
      const variants: Array<{ url: string; bandwidth: number; resolution: string }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF")) {
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
          const bw = bwMatch ? parseInt(bwMatch[1], 10) : 1000000;
          const res = resMatch ? resMatch[1] : "";

          // Next line is the variant playlist URL
          let nextIdx = i + 1;
          while (nextIdx < lines.length && (!lines[nextIdx].trim() || lines[nextIdx].trim().startsWith("#"))) {
            nextIdx++;
          }

          if (nextIdx < lines.length) {
            const rawVariantUrl = lines[nextIdx].trim();
            const absoluteVariantUrl = resolveAbsoluteUrl(currentUrl, rawVariantUrl);
            variants.push({ url: absoluteVariantUrl, bandwidth: bw, resolution: res });
          }
        }
      }

      if (variants.length > 0) {
        // Pick best matching variant
        let chosen = variants[0];
        if (preferredRes) {
          const target = preferredRes.toUpperCase().replace("P", "");
          const match = variants.find(v => v.resolution.includes(target) || (target === "480" && v.bandwidth <= 900000));
          if (match) chosen = match;
        } else {
          // By default prefer moderate quality (480p/720p) or highest if not specified
          const p720 = variants.find(v => v.resolution.includes("720") || (v.bandwidth >= 1000000 && v.bandwidth <= 2200000));
          const p480 = variants.find(v => v.resolution.includes("480") || (v.bandwidth >= 500000 && v.bandwidth < 1000000));
          chosen = p720 || p480 || variants[0];
        }

        console.log(`[RESOLVE_HLS] Selected variant stream (${chosen.resolution || chosen.bandwidth + "bps"}): ${chosen.url}`);
        currentUrl = chosen.url;
        continue;
      }
    }

    // It is a media playlist containing segments
    return { mediaPlaylistUrl: currentUrl, content };
  }

  return null;
}

interface HlsSegment {
  index: number;
  url: string;
  sequenceNumber: number;
  isInit?: boolean;
  byteRange?: { offset: number; length: number };
}

/**
 * Advanced Application-level parallel segmented HLS Downloader modeled on Cat-Catch, m3u8-dl, and hlsdl architectures.
 */
export async function downloadHlsAppLevel(
  playlistUrl: string,
  outputPath: string,
  headers: Record<string, string>,
  timeoutMs: number = 240000,
  progressCallback?: (progress: number) => void
): Promise<boolean> {
  const tempDir = path.join(os.tmpdir(), `cat_catch_${crypto.randomBytes(8).toString("hex")}`);
  try {
    await fsp.mkdir(tempDir, { recursive: true });

    // Step 1: Resolve master playlist down to media playlist
    const resolved = await resolveMediaPlaylistUrl(playlistUrl, headers);
    if (!resolved || !resolved.content) {
      console.warn(`[CAT_CATCH_DOWNLOAD] Failed to fetch or parse HLS playlist.`);
      return false;
    }

    const { mediaPlaylistUrl, content: playlistContent } = resolved;
    const lines = playlistContent.split(/\r?\n/);
    const segments: HlsSegment[] = [];
    let mediaSequence = 0;
    let initSegmentUrl: string | null = null;
    
    // Parse start media sequence and init map if present
    for (const line of lines) {
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        const match = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        if (match) mediaSequence = parseInt(match[1], 10);
      }
      if (line.startsWith("#EXT-X-MAP:")) {
        const mapMatch = line.match(/URI=["']([^"']+)["']/i);
        if (mapMatch && mapMatch[1]) {
          initSegmentUrl = resolveAbsoluteUrl(mediaPlaylistUrl, mapMatch[1]);
        }
      }
    }

    let currentKeyInfo: { method: string; url: string; iv?: Buffer } | null = null;
    let seqCounter = mediaSequence;
    let pendingByteRange: { offset: number; length: number } | undefined = undefined;
    let currentByteOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith("#")) {
        // Look for AES encryption keys
        if (line.startsWith("#EXT-X-KEY:")) {
          const methodMatch = line.match(/METHOD=([^,]+)/i);
          const uriMatch = line.match(/URI=["']([^"']+)["']/i);
          const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);

          if (methodMatch && methodMatch[1].toUpperCase() === "AES-128" && uriMatch && uriMatch[1]) {
            const absoluteKeyUrl = resolveAbsoluteUrl(mediaPlaylistUrl, uriMatch[1]);
            let iv: Buffer | undefined = undefined;
            if (ivMatch) {
              iv = Buffer.from(ivMatch[1], "hex");
            }
            currentKeyInfo = {
              method: "AES-128",
              url: absoluteKeyUrl,
              iv
            };
          } else {
            currentKeyInfo = null;
          }
        } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
          // #EXT-X-BYTERANGE:length[@offset]
          const rangeMatch = line.match(/#EXT-X-BYTERANGE:\s*(\d+)(?:@(\d+))?/i);
          if (rangeMatch) {
            const length = parseInt(rangeMatch[1], 10);
            const offset = rangeMatch[2] !== undefined ? parseInt(rangeMatch[2], 10) : currentByteOffset;
            pendingByteRange = { offset, length };
            currentByteOffset = offset + length;
          }
        }
        continue;
      }

      // Valid segment URL line
      const segmentUrl = resolveAbsoluteUrl(mediaPlaylistUrl, line);
      segments.push({
        index: segments.length,
        url: segmentUrl,
        sequenceNumber: seqCounter++,
        byteRange: pendingByteRange
      });
      pendingByteRange = undefined;
    }

    if (segments.length === 0) {
      console.warn(`[CAT_CATCH_DOWNLOAD] No video segments found in the playlist.`);
      return false;
    }

    console.log(`[CAT_CATCH_DOWNLOAD] Starting parallel download of ${segments.length} HLS segments. AES encrypted: ${!!currentKeyInfo}. Init map: ${!!initSegmentUrl}`);

    // Fetch decryption key if HLS is encrypted
    let decryptionKey: Buffer | null = null;
    if (currentKeyInfo) {
      console.log(`[CAT_CATCH_DOWNLOAD] Fetching AES decryption key from: ${currentKeyInfo.url}`);
      decryptionKey = await robustFetchBuffer(currentKeyInfo.url, headers);
      if (!decryptionKey) {
        console.error(`[CAT_CATCH_DOWNLOAD] Failed to retrieve HLS AES-128 decryption key!`);
        return false;
      }
      if (decryptionKey.length !== 16) {
        console.warn(`[CAT_CATCH_DOWNLOAD] Warning: Retrieved key size is ${decryptionKey.length} bytes (expected 16). Adjusting key length.`);
        if (decryptionKey.length > 16) {
          decryptionKey = decryptionKey.subarray(0, 16);
        } else {
          const padded = Buffer.alloc(16);
          decryptionKey.copy(padded);
          decryptionKey = padded;
        }
      }
    }

    // Fetch initialization segment if fMP4 HLS
    if (initSegmentUrl) {
      const initBuf = await robustFetchBuffer(initSegmentUrl, headers);
      if (initBuf && initBuf.length > 0) {
        await fsp.writeFile(path.join(tempDir, "init_segment.mp4"), initBuf);
      }
    }

    // Step 2: Parallel download pool with adaptive retry strategy
    const CONCURRENCY = 8;
    let activeWorkers = 0;
    let nextIndex = 0;
    let downloadedCount = 0;
    let hasFailed = false;

    // R9 (audit follow-up 2026-09-01): hard global deadline so a stalling CDN
    // can never hang a batch slot forever (per-segment fetches already time
    // out at 15s, but retries × segments could still add up to hours).
    // Env-tunable, default 10 minutes per episode download.
    const DOWNLOAD_TIMEOUT_MS = Number(process.env.NEBULA_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000);
    const deadlineAt = Date.now() + DOWNLOAD_TIMEOUT_MS;
    let deadlineLogged = false;
    const deadlineReached = (): boolean => {
      if (Date.now() <= deadlineAt) return false;
      if (!deadlineLogged) {
        deadlineLogged = true;
        console.error(
          `[CAT_CATCH_DOWNLOAD] Global download timeout (${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)}s) reached — ` +
            `${downloadedCount}/${segments.length} segments done. Aborting this mirror attempt.`
        );
      }
      return true;
    };


    // Helper for segment download worker
    const downloadSegment = async (segment: HlsSegment): Promise<boolean> => {
      let retries = 5;
      let delay = 250;
      let success = false;
      let buffer: Buffer | null = null;

      const segmentHeaders = { ...headers };
      if (segment.byteRange) {
        segmentHeaders["Range"] = `bytes=${segment.byteRange.offset}-${segment.byteRange.offset + segment.byteRange.length - 1}`;
      }

      while (retries > 0 && !success && !hasFailed && !deadlineReached()) {
        try {
          buffer = await robustFetchBuffer(segment.url, segmentHeaders);
          if (buffer && buffer.length > 0) {
            success = true;
          }
        } catch (err: any) {
          if (process.env.DEBUG_MEDIA === "true") {
            console.warn(`[CAT_CATCH_WORKER] Failed segment index ${segment.index}: ${err.message}. Retries left: ${retries - 1}`);
          }
        }

        if (!success) {
          retries--;
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 3000);
        }
      }

      if (!success || !buffer) {
        console.error(`[CAT_CATCH_DOWNLOAD] Failed to download segment ${segment.index} after all retries! url: ${segment.url}`);
        return false;
      }

      // Step 3: Application-level dynamic segment decryption using Crypto
      if (currentKeyInfo && decryptionKey) {
        try {
          let iv = currentKeyInfo.iv;
          if (!iv) {
            iv = Buffer.alloc(16);
            iv.writeUInt32BE(segment.sequenceNumber, 12);
          }

          const decipher = crypto.createDecipheriv("aes-128-cbc", decryptionKey, iv);
          decipher.setAutoPadding(true);
          const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]);
          buffer = decrypted;
        } catch (decErr: any) {
          console.error(`[CAT_CATCH_DECRYPT] Error decrypting segment ${segment.index}:`, decErr.message);
          return false;
        }
      }

      // Save segment securely to disk
      const segmentFile = path.join(tempDir, `segment_${String(segment.index).padStart(6, "0")}.ts`);
      await fsp.writeFile(segmentFile, buffer);
      return true;
    };

    // Run the concurrency pool
    const poolPromise = new Promise<boolean>((resolvePool) => {
      const runNext = async () => {
        if (hasFailed) return;
        if (nextIndex >= segments.length) {
          if (activeWorkers === 0) resolvePool(true);
          return;
        }

        const currentSegment = segments[nextIndex++];
        activeWorkers++;

        const success = await downloadSegment(currentSegment);
        activeWorkers--;

        if (!success) {
          hasFailed = true;
          resolvePool(false);
          return;
        }

        downloadedCount++;
        if (progressCallback) {
          const pct = Math.floor((downloadedCount / segments.length) * 100);
          progressCallback(pct);
        }

        runNext();
      };

      for (let i = 0; i < Math.min(CONCURRENCY, segments.length); i++) {
        runNext();
      }
    });

    const poolResult = await poolPromise;
    if (!poolResult || hasFailed) {
      console.error(`[CAT_CATCH_DOWNLOAD] Segment download pool failed or was interrupted.`);
      return false;
    }

    console.log(`[CAT_CATCH_DOWNLOAD] Successfully downloaded and decrypted all ${segments.length} segments!`);

    // Step 4: Sequentially concatenate segments into a single consolidated local .ts file
    const concatInputPath = path.join(tempDir, "consolidated_stream.ts");
    const writer = fs.createWriteStream(concatInputPath);

    // If init segment exists, prepend it
    const initPath = path.join(tempDir, "init_segment.mp4");
    if (fs.existsSync(initPath)) {
      const initBuf = await fsp.readFile(initPath);
      writer.write(initBuf);
    }

    for (let i = 0; i < segments.length; i++) {
      const segmentFile = path.join(tempDir, `segment_${String(i).padStart(6, "0")}.ts`);
      const buffer = await fsp.readFile(segmentFile);
      if (!writer.write(buffer)) {
        // Backpressure: wait for the drain event instead of queueing every
        // segment buffer in memory (batch OOM fix, audit 8.12).
        await new Promise<void>((resolveDrain) => writer.once("drain", () => resolveDrain()));
      }
    }
    
    await new Promise<void>((resolveWriter, rejectWriter) => {
      writer.end((err: any) => {
        if (err) rejectWriter(err);
        else resolveWriter();
      });
    });

    console.log(`[CAT_CATCH_DOWNLOAD] Consolidated TS generated. Running offline FFmpeg conversion...`);

    // Step 5: Convert via offline FFmpeg to production-grade faststart .mp4 with absolute 0% network reliance
    const runFfmpegConvert = (args: string[]): Promise<boolean> => {
      return new Promise<boolean>((resolveFfmpeg) => {
        const proc = spawn(resolvedFfmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderrLog = "";
        proc.stderr?.on("data", (chunk) => {
          stderrLog += chunk.toString();
        });

        const timer = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
          resolveFfmpeg(false);
        }, 120000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
            resolveFfmpeg(true);
          } else {
            console.warn(`[CAT_CATCH_DOWNLOAD] FFmpeg conversion failed (code ${code}). Stderr:`, stderrLog);
            resolveFfmpeg(false);
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          console.error(`[CAT_CATCH_DOWNLOAD] FFmpeg startup error:`, err.message);
          resolveFfmpeg(false);
        });
      });
    };

    // Tier 1: Direct copy remux with faststart
    let ffmpegSuccess = await runFfmpegConvert([
      "-y",
      "-i", concatInputPath,
      "-c", "copy",
      "-bsf:a", "aac_adtstoasc",
      "-movflags", "+faststart",
      outputPath
    ]);

    // Tier 2: If direct copy failed (audio timestamp issues), re-encode audio to AAC
    if (!ffmpegSuccess) {
      console.warn(`[CAT_CATCH_DOWNLOAD] Direct stream copy failed. Attempting audio re-encode fallback...`);
      ffmpegSuccess = await runFfmpegConvert([
        "-y",
        "-i", concatInputPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath
      ]);
    }

    // Tier 3: Complete fast re-encoding fallback
    if (!ffmpegSuccess) {
      console.warn(`[CAT_CATCH_DOWNLOAD] Audio copy failed. Attempting ultrafast complete transcode fallback...`);
      ffmpegSuccess = await runFfmpegConvert([
        "-y",
        "-i", concatInputPath,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "24",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath
      ]);
    }

    return ffmpegSuccess;

  } catch (err: any) {
    console.error(`[CAT_CATCH_DOWNLOAD] General failure:`, err.message);
    return false;
  } finally {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
