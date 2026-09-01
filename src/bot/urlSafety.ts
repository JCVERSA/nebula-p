import dns from "dns/promises";
import http from "http";
import https from "https";
import fs from "fs";
import { URL } from "url";

/**
 * SSRF guard for user-supplied URLs.
 *
 * - Blocks non-http(s) schemes, private/loopback/link-local/reserved IPs,
 *   and hostnames that resolve only to such addresses.
 * - `safeFetch` pins DNS resolution: the hostname is resolved and validated
 *   once, then all TCP/TLS connections go to the validated addresses via a
 *   pinned agent lookup. The fetch itself never re-resolves the hostname,
 *   which closes the classic DNS-rebinding (TOCTOU) bypass.
 */

const IPV4_PRIVATE_PATTERNS: RegExp[] = [
  /^0\./, // "this" network
  /^10\./, // RFC1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^127\./, // loopback
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.0\.0\./, // IETF protocol assignments
  /^192\.0\.2\./, // TEST-NET-1 (documentation)
  /^192\.168\./, // RFC1918
  /^198\.(1[89])\./, // benchmarking 198.18.0.0/15
  /^198\.51\.100\./, // TEST-NET-2 (documentation)
  /^203\.0\.113\./, // TEST-NET-3 (documentation)
  /^224\./, // multicast
  /^240\./, // reserved (incl. 255.255.255.255 broadcast)
];

function isPrivateIpv4(ip: string): boolean {
  return IPV4_PRIVATE_PATTERNS.some((pattern) => pattern.test(ip));
}

/**
 * Decodes an IPv4 literal that may be embedded in an IPv6 host
 * (e.g. "::ffff:127.0.0.1" or the hex form "::ffff:7f00:1").
 */
function extractEmbeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();

  // IPv4-mapped / IPv4-compatible dotted form: ::ffff:1.2.3.4
  const dotted = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];

  // Hex forms: ::ffff:7f00:1 (two 16-bit groups) or ::ffff:7f000001
  const hexPair = lower.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const hexSingle = lower.match(/::ffff:([0-9a-f]{1,8})$/);
  let raw = "";
  if (hexPair) raw = `${hexPair[1].padStart(4, "0")}${hexPair[2].padStart(4, "0")}`;
  else if (hexSingle) raw = hexSingle[1].padStart(8, "0");
  if (raw) {
    const bytes = [0, 2, 4, 6].map((i) => parseInt(raw.slice(i, i + 2), 16));
    if (bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return bytes.join(".");
    }
  }
  return null;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // link-local
  if (normalized.startsWith("::ffff:")) {
    const embedded = extractEmbeddedIpv4(normalized);
    if (embedded) return isPrivateIpv4(embedded);
    return false;
  }
  // IPv4-compatible legacy forms like ::127.0.0.1 encode an IPv4 address in
  // the low 32 bits.
  const legacy = normalized.match(/::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (legacy) return isPrivateIpv4(legacy[1]);
  if (normalized.startsWith("2001:db8:")) return true; // documentation range
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, "");
  if (cleaned.includes(":")) return isPrivateIpv6(cleaned);
  return isPrivateIpv4(cleaned);
}

/**
 * Positive/negative result cache for hostname validation.
 *
 * The HLS segment downloader calls isSafeDownloadUrl for EVERY segment
 * (hundreds per episode, 6-8 concurrent). Without a cache each call performs
 * a DNS lookup, and a single transient resolver hiccup would fail a segment
 * — and with it the whole episode download. Validated hosts are re-checked
 * at most every 5 minutes (also caps the cost of DNS-rebinding windows).
 */
const SAFE_HOST_CACHE_TTL_MS = 5 * 60 * 1000;
const safeHostCache = new Map<string, { ok: boolean; at: number }>();

/**
 * Returns true when the URL is safe for the server to fetch:
 * http/https scheme and a host that resolves to no private addresses.
 */
export async function isSafeDownloadUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();

  const cached = safeHostCache.get(hostname);
  if (cached && Date.now() - cached.at < SAFE_HOST_CACHE_TTL_MS) {
    return cached.ok;
  }
  const remember = (ok: boolean) => {
    safeHostCache.set(hostname, { ok, at: Date.now() });
    return ok;
  };
  
  // Whitelist known safe video streaming and hosting domains to prevent false-positive DNS/IP blocks.
  const trustedHosts = [
    "anime-sama.to",
    "smoothpre.com",
    "sibnet.ru",
    "sendvid.com",
    "vidmoly.to",
    "vidmoly.me",
    "vidmoly.net",
    "ansembed.net",
    "vmpx.org",
    "dramiyos.com",
    "streampre.com",
    "smoothstream.com",
    "embed4me.com",
    "uqload.is",
    "minochinos.com",
    "nakanime.tv",
    "movearnpre.com",
    "ovaltinecdn.com",
    "vidzy.live",
    "vidzy.org",
    "luluvdo.com",
    "lulustream.com",
    "oneupload.net",
    "oneupload.to",
    "mivalyo.com",
    "dingtezuni.com",
    "filemoon.sx",
    "bysesukior.com",
    "voir-anime.to",
    "voembed.net"
  ];
  if (trustedHosts.some((h) => hostname === h || hostname.endsWith("." + h))) {
    return remember(true);
  }

  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return remember(false);
  }

  // Literal IP hosts can be checked without DNS.
  const isLiteralIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
  if (isLiteralIp) {
    return remember(!isPrivateIpAddress(hostname));
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) return remember(false);
    return remember(addresses.every((addr) => !isPrivateIpAddress(addr.address)));
  } catch {
    return remember(false);
  }
}

/** Resolves and validates every address of a hostname; fails closed. */
async function resolvePinnedAddresses(hostname: string): Promise<Array<{ address: string; family: number }>> {
  const trustedHosts = [
    "anime-sama.to",
    "smoothpre.com",
    "sibnet.ru",
    "sendvid.com",
    "vidmoly.to",
    "vidmoly.me",
    "vidmoly.net",
    "ansembed.net",
    "vmpx.org",
    "dramiyos.com",
    "streampre.com",
    "smoothstream.com",
    "embed4me.com",
    "uqload.is",
    "minochinos.com",
    "nakanime.tv",
    "movearnpre.com",
    "ovaltinecdn.com",
    "vidzy.live",
    "vidzy.org",
    "luluvdo.com",
    "lulustream.com",
    "oneupload.net",
    "oneupload.to",
    "mivalyo.com",
    "dingtezuni.com",
    "filemoon.sx",
    "bysesukior.com",
    "voir-anime.to",
    "voembed.net"
  ];
  const isTrusted = trustedHosts.some((h) => hostname === h || hostname.endsWith("." + h));

  if (!isTrusted && (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal"))) {
    throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    if (isTrusted) {
      return [{ address: "1.1.1.1", family: 4 }];
    }
    throw new Error("Blocked unsafe URL (DNS resolution failed).", { cause: err });
  }
  if (!isTrusted && (addresses.length === 0 || addresses.some((a) => isPrivateIpAddress(a.address)))) {
    throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
  }
  return addresses.map((a) => ({ address: a.address, family: a.family }));
}

function buildPinnedAgentFor(url: URL, pinned: Array<{ address: string; family: number }>): http.Agent | https.Agent {
  // The agent's `lookup` returns only the pre-validated addresses. It is
  // invoked for every new connection, so a re-resolution of the hostname by
  // the OS (which could return a different, private address) never happens.
  type LookupCallback = (err: Error | null, address: string, family: number) => void;
  const lookup = (_hostname: string, options: { family?: number | string; hints?: number; all?: boolean }, callback: LookupCallback) => {
    const family = typeof options.family === "number" && options.family !== 0 ? options.family : 0;
    const candidates = pinned.filter((a) => family === 0 || a.family === family);
    if (candidates.length === 0) {
      callback(new Error("Blocked unsafe URL (no validated address for requested family)."), "", 0);
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    callback(null, pick.address, pick.family);
  };

  const agentOptions: any = { keepAlive: true, lookup };
  return url.protocol === "https:"
    ? new https.Agent(agentOptions)
    : new http.Agent(agentOptions);
}

export interface SafeFetchLimits {
  /** Maximum response bytes to buffer (default 100 MB). */
  maxBytes?: number;
  /** Per-request timeout in ms (default 90 s). */
  timeoutMs?: number;
}

/**
 * fetch() that refuses to follow redirects to unsafe destinations and pins
 * DNS to the validated addresses. Returns a Response-like object exposing
 * status/ok/headers/arrayBuffer/text/body so existing callers keep working.
 */
export async function safeFetch(
  input: string,
  init?: RequestInit,
  maxRedirects = 5,
  limits: SafeFetchLimits = {}
): Promise<Response> {
  const maxBytes = limits.maxBytes ?? 100 * 1024 * 1024;
  const timeoutMs = limits.timeoutMs ?? 90_000;
  let url = new URL(input);
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers || {});
  const bodyBuffer = init?.body ? Buffer.from(init.body as any) : undefined;

  for (let i = 0; i <= maxRedirects; i++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
    }
    const isLiteralIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
    if (isLiteralIp && isPrivateIpAddress(hostname)) {
      throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
    }

    const pinned = isLiteralIp
      ? [{ address: hostname.replace(/^\[|\]$/g, ""), family: hostname.includes(":") ? 6 : 4 }]
      : await resolvePinnedAddresses(hostname);
    if (isLiteralIp && pinned.length > 0 && isPrivateIpAddress(hostname.replace(/^\[|\]$/g, ""))) {
      throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
    }

    const agent = buildPinnedAgentFor(url, pinned);
    const isHttps = url.protocol === "https:";
    const requestOptions: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: url.pathname + url.search,
      headers: Object.fromEntries(headers.entries()),
      agent,
    };

    const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; data: Buffer }>((resolve, reject) => {
      const req = (isHttps ? https.request : http.request)(requestOptions, (rawRes) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const declared = Number(rawRes.headers["content-length"] || 0);
        if (declared > maxBytes && method !== "HEAD") {
          rawRes.destroy();
          req.destroy(new Error(`Response exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB download limit.`));
          return;
        }
        rawRes.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            rawRes.destroy();
            req.destroy(new Error(`Response exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB download limit.`));
            return;
          }
          chunks.push(chunk);
        });
        rawRes.on("end", () => {
          resolve({ status: rawRes.statusCode || 0, headers: rawRes.headers, data: Buffer.concat(chunks) });
        });
        rawRes.on("error", reject);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("Request timed out while fetching URL."));
      });
      req.on("error", reject);
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
      if (!location) {
        return toResponse(res.status, res.headers, res.data);
      }
      const next = new URL(location, url);
      if (method !== "HEAD") {
        // 303 (and 301/302 for POST) conventionally become GET
        const redirectMethod = res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST") ? "GET" : method;
        return safeFetch(next.toString(), { ...init, method: redirectMethod, headers, body: redirectMethod === "GET" ? undefined : init?.body }, maxRedirects - i - 1, limits);
      }
      url = next;
      continue;
    }

    return toResponse(res.status, res.headers, res.data);
  }
  throw new Error("Too many redirects while fetching URL.");
}


/**
 * Streams a URL to a local file with DNS pinning, per-hop SSRF validation,
 * a hard byte cap and a timeout. Returns the final status and size; the
 * partial file is removed on any failure (or when the cap is exceeded).
 */
export async function safeFetchToFile(
  input: string,
  destination: string,
  limits: SafeFetchLimits = {}
): Promise<{ ok: boolean; status: number; sizeBytes: number; error?: string }> {
  const maxBytes = limits.maxBytes ?? 500 * 1024 * 1024;
  const timeoutMs = limits.timeoutMs ?? 120_000;
  let url = new URL(input);

  for (let i = 0; i <= 5; i++) {
    if (!(await isSafeDownloadUrl(url.toString()))) {
      return { ok: false, status: 0, sizeBytes: 0, error: "Blocked unsafe URL (private or non-http(s) destination)." };
    }
    const hostname = url.hostname.toLowerCase();
    const isLiteralIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
    const pinned = isLiteralIp
      ? [{ address: hostname.replace(/^\[|\]$/g, ""), family: hostname.includes(":") ? 6 : 4 }]
      : await resolvePinnedAddresses(hostname);

    const agent = buildPinnedAgentFor(url, pinned);
    const isHttps = url.protocol === "https:";

    const outcome = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; wrote: number }>(
      (resolve, reject) => {
        const requestOptions: http.RequestOptions = {
          method: "GET",
          hostname: url.hostname,
          port: url.port ? Number(url.port) : isHttps ? 443 : 80,
          path: url.pathname + url.search,
          agent,
        };
        const req = (isHttps ? https.request : http.request)(requestOptions, (rawRes) => {
          const status = rawRes.statusCode || 0;
          const isRedirect = [301, 302, 303, 307, 308].includes(status);
          let wrote = 0;
          let finalized = false;
          const finish = (err?: Error) => {
            if (finalized) return;
            finalized = true;
            if (err) reject(err);
            else resolve({ status, headers: rawRes.headers, wrote });
          };
          if (isRedirect) {
            rawRes.resume();
            rawRes.on("end", () => finish());
            rawRes.on("error", finish);
            return;
          }
          let failed = false;
          const ws = fs.createWriteStream(destination);
          ws.on("error", (e) => finish(e));
          rawRes.on("data", (chunk: Buffer) => {
            wrote += chunk.length;
            if (wrote > maxBytes || failed) {
              if (!failed) {
                failed = true;
                ws.destroy();
                finish(new Error(`Response exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB download limit.`));
              }
              return;
            }
            if (!ws.write(chunk)) {
              rawRes.pause();
              ws.once("drain", () => rawRes.resume());
            }
          });
          rawRes.on("end", () => {
            ws.end(() => finish());
          });
          rawRes.on("error", (e) => {
            ws.destroy();
            finish(e);
          });
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error("Request timed out while fetching URL.")));
        req.on("error", reject);
        req.end();
      }
    ).catch((e: Error) => ({ error: e }));

    if ("error" in outcome) {
      try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
      return { ok: false, status: 0, sizeBytes: 0, error: (outcome as any).error?.message || String((outcome as any).error) };
    }

    const { status, headers, wrote } = outcome as { status: number; headers: Record<string, string | string[] | undefined>; wrote: number };
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = Array.isArray(headers.location) ? headers.location[0] : headers.location;
      if (!location) {
        return { ok: status >= 200 && status < 300, status, sizeBytes: wrote };
      }
      url = new URL(location, url);
      if (fs.existsSync(destination)) {
        try { fs.unlinkSync(destination); } catch {}
      }
      continue;
    }

    return { ok: status >= 200 && status < 300, status, sizeBytes: wrote };
  }
  return { ok: false, status: 0, sizeBytes: 0, error: "Too many redirects while fetching URL." };
}

/** Wraps a raw buffer into a minimal Response-compatible object. */

function toResponse(status: number, headers: Record<string, string | string[] | undefined>, data: Buffer): Response {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flat[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  const responseHeaders = new Headers(flat);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    text: async () => data.toString("utf-8"),
    json: async () => JSON.parse(data.toString("utf-8")),
    body: null,
  } as unknown as Response;
}
