import type { AxiosProxyConfig } from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * Optional egress proxy for the anime scraping pipeline.
 *
 * Anime-sama.to sits behind Cloudflare and blocks many datacenter / VPS IP
 * ranges with HTTP 403 (see ANIME_DOWNLOAD_AUDIT.md, finding R3). Setting
 *
 *     NEBULA_ANIME_PROXY=http://user:pass@proxy-host:8080     (HTTP/HTTPS)
 *     NEBULA_ANIME_PROXY=socks5://127.0.0.1:40000             (SOCKS)
 *
 * routes every anime-related request (search, seasons, episodes.js, player
 * mirrors, HLS manifests + segments, direct MP4 downloads) through it.
 *
 * Typical SOCKS sources:
 *   - Cloudflare WARP in proxy mode  (warp-cli -> socks5://127.0.0.1:40000)
 *   - an SSH dynamic tunnel          (ssh -D 1080 user@home -> socks5://127.0.0.1:1080)
 *   - any residential SOCKS provider
 *
 * When unset, axios' default behavior applies (standard http_proxy /
 * https_proxy environment variables still work).
 */

export const ANIME_PROXY_ENV = "NEBULA_ANIME_PROXY";

export type ParsedAnimeProxy =
  | { kind: "http"; axios: AxiosProxyConfig }
  | { kind: "socks"; url: string };

/** Parses a proxy URL. Exported for tests and the doctor script. */
export function parseProxyUrl(raw: string | undefined | null): ParsedAnimeProxy | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }

  if (u.protocol === "socks5:" || u.protocol === "socks5h:" || u.protocol === "socks4:" || u.protocol === "socks4a:") {
    return { kind: "socks", url: s };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  const cfg: AxiosProxyConfig = {
    protocol: u.protocol.replace(":", ""),
    host: u.hostname,
    port
  };
  if (u.username) {
    cfg.auth = {
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || "")
    };
  }
  return { kind: "http", axios: cfg };
}

/** Cached SOCKS agents — one per proxy URL (hundreds of segment fetches reuse it). */
const socksAgents = new Map<string, SocksProxyAgent>();

function socksAgentFor(url: string): SocksProxyAgent {
  let agent = socksAgents.get(url);
  if (!agent) {
    agent = new SocksProxyAgent(url);
    socksAgents.set(url, agent);
  }
  return agent;
}

export interface AnimeProxyRequestOptions {
  proxy?: AxiosProxyConfig;
  httpAgent?: SocksProxyAgent;
  httpsAgent?: SocksProxyAgent;
}

/**
 * Spread-ready axios options for the anime pipeline:
 *   axios.get(url, { headers, ...animeProxyOptions() })
 * Returns {} when no proxy is configured (default egress).
 */
export function animeProxyOptions(raw: string | undefined | null = process.env[ANIME_PROXY_ENV]): AnimeProxyRequestOptions {
  const parsed = parseProxyUrl(raw);
  if (!parsed) return {};
  if (parsed.kind === "http") return { proxy: parsed.axios };
  const agent = socksAgentFor(parsed.url);
  return { httpAgent: agent, httpsAgent: agent };
}

let warnedInvalidProxy = false;

/**
 * Legacy helper: axios `proxy` config for HTTP(S) proxies only.
 * Prefer animeProxyOptions() which also covers SOCKS.
 */
export function getAnimeProxyConfig(): AxiosProxyConfig | undefined {
  const raw = process.env[ANIME_PROXY_ENV];
  if (raw && raw.trim() && !warnedInvalidProxy) {
    const cfg = parseProxyUrl(raw);
    if (!cfg) {
      warnedInvalidProxy = true;
      console.warn(
        `[AnimeProxy] WARNING: ${ANIME_PROXY_ENV} is set but could not be parsed (${raw}). ` +
          `It is being IGNORED — requests go out directly. 'http://user:pass@host:port' is a ` +
          `TEMPLATE: replace user/pass/host/port with a REAL working proxy, or remove the variable.`
      );
    }
  }
  const parsed = parseProxyUrl(raw);
  return parsed?.kind === "http" ? parsed.axios : undefined;
}

/** Human-readable description for logs / diagnostics. */
export function describeAnimeProxy(raw: string | undefined | null = process.env[ANIME_PROXY_ENV]): string {
  const parsed = parseProxyUrl(raw);
  if (!parsed) return "none (direct egress)";
  if (parsed.kind === "socks") {
    let host = "socks";
    try {
      host = new URL(parsed.url).host;
    } catch {}
    return `socks5://${host}`;
  }
  const c = parsed.axios;
  return `${c.protocol}://${c.host}:${c.port}${c.auth ? " (auth)" : ""}`;
}
