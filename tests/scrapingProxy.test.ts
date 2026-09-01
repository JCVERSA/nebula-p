import { describe, it, expect } from "vitest";
import { parseProxyUrl, describeAnimeProxy, animeProxyOptions } from "../src/bot/services/scrapingProxy.js";

describe("anime scraping proxy config", () => {
  it("returns undefined for empty / unset values", () => {
    expect(parseProxyUrl(undefined)).toBeUndefined();
    expect(parseProxyUrl(null)).toBeUndefined();
    expect(parseProxyUrl("   ")).toBeUndefined();
  });

  it("returns undefined for invalid URLs and unsupported schemes", () => {
    expect(parseProxyUrl("not-a-url")).toBeUndefined();
    expect(parseProxyUrl("ftp://proxy:21")).toBeUndefined();
  });

  it("parses SOCKS proxies (socks5/socks5h/socks4)", () => {
    expect(parseProxyUrl("socks5://127.0.0.1:40000")).toEqual({ kind: "socks", url: "socks5://127.0.0.1:40000" });
    expect(parseProxyUrl("socks5h://user:pass@proxy:1080")).toEqual({ kind: "socks", url: "socks5h://user:pass@proxy:1080" });
    expect(parseProxyUrl("socks4://10.0.0.1:1080")).toEqual({ kind: "socks", url: "socks4://10.0.0.1:1080" });
  });

  it("parses a plain http proxy with default port", () => {
    expect(parseProxyUrl("http://proxy.example.com")).toEqual({
      kind: "http",
      axios: { protocol: "http", host: "proxy.example.com", port: 80 }
    });
  });

  it("parses an https proxy with explicit port", () => {
    expect(parseProxyUrl("https://proxy.example.com:8443")).toEqual({
      kind: "http",
      axios: { protocol: "https", host: "proxy.example.com", port: 8443 }
    });
  });

  it("parses credentials (percent-encoded and raw)", () => {
    expect(parseProxyUrl("http://user:pass@10.0.0.1:8080")).toEqual({
      kind: "http",
      axios: { protocol: "http", host: "10.0.0.1", port: 8080, auth: { username: "user", password: "pass" } }
    });
    expect(parseProxyUrl("http://u%40x:p%3Aa@proxy:3128")).toEqual({
      kind: "http",
      axios: { protocol: "http", host: "proxy", port: 3128, auth: { username: "u@x", password: "p:a" } }
    });
  });

  it("exposes axios options for both proxy kinds", () => {
    expect(animeProxyOptions("http://p:3128")).toEqual({ proxy: { protocol: "http", host: "p", port: 3128 } });
    const socksOpts = animeProxyOptions("socks5://127.0.0.1:40000");
    expect(socksOpts.proxy).toBeUndefined();
    expect(socksOpts.httpsAgent).toBeDefined();
    expect(animeProxyOptions(undefined)).toEqual({});
    expect(animeProxyOptions("garbage")).toEqual({});
  });

  it("describes the proxy for logs without leaking the password", () => {
    expect(describeAnimeProxy("http://user:secret@proxy:3128")).toBe("http://proxy:3128 (auth)");
    expect(describeAnimeProxy("socks5://user:secret@127.0.0.1:40000")).toBe("socks5://127.0.0.1:40000");
    expect(describeAnimeProxy(undefined)).toContain("none");
  });
});
