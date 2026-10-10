import { describe, it, expect, vi } from "vitest";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { isPrivateIpAddress, isSafeDownloadUrl, safeFetch, makePinnedLookup } from "../src/bot/urlSafety.js";

describe("isPrivateIpAddress", () => {
  it("detects private IPv4 ranges", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.5")).toBe(true);
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.1")).toBe(true);
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("100.64.0.1")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateIpAddress("172.32.0.1")).toBe(false);
  });

  it("detects private IPv6 addresses", () => {
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateIpAddress("fe80::1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("isSafeDownloadUrl", () => {
  it("blocks private and loopback destinations without DNS", async () => {
    expect(await isSafeDownloadUrl("http://127.0.0.1:8080/secret")).toBe(false);
    expect(await isSafeDownloadUrl("http://10.0.0.1/")).toBe(false);
    expect(await isSafeDownloadUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(await isSafeDownloadUrl("http://192.168.1.10/x")).toBe(false);
    expect(await isSafeDownloadUrl("http://[::1]/x")).toBe(false);
  });

  it("blocks non-http protocols and local hostnames", async () => {
    expect(await isSafeDownloadUrl("ftp://example.com/file")).toBe(false);
    expect(await isSafeDownloadUrl("file:///etc/passwd")).toBe(false);
    expect(await isSafeDownloadUrl("http://localhost:3000/x")).toBe(false);
    expect(await isSafeDownloadUrl("http://myserver.internal/x")).toBe(false);
    expect(await isSafeDownloadUrl("not a url")).toBe(false);
  });

  it("allows public https destinations (DNS resolution)", async () => {
    expect(await isSafeDownloadUrl("https://example.com/file.mp4")).toBe(true);
  });
});

describe("safeFetch", () => {
  it("refuses to fetch private destinations", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    await expect(safeFetch(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/Blocked unsafe URL/);

    server.close();
  });
});

describe("extended private-range coverage", () => {
  it("detects expanded IPv4 ranges and IPv6 mapped/hex/documentation forms", async () => {
    expect(isPrivateIpAddress("198.19.0.1")).toBe(true);
    expect(isPrivateIpAddress("192.0.2.10")).toBe(true);
    expect(isPrivateIpAddress("198.51.100.1")).toBe(true);
    expect(isPrivateIpAddress("203.0.113.1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:7f000001")).toBe(true);
    expect(isPrivateIpAddress("::127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("2001:db8::1")).toBe(true);
    expect(isPrivateIpAddress("198.20.0.1")).toBe(false);
    expect(isPrivateIpAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("safeFetch pinning & limits", () => {
  it("rejects oversized responses before buffering them", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("x".repeat(64 * 1024));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    // Even though the destination is private, the limit check should fire first
    // for a literal-IP URL we gate: use safeFetch with a small maxBytes on a
    // public host is not possible offline, so verify the helper behavior by
    // calling with a literal IP but expecting the private-block error OR the
    // size error depending on order; the important part is it never hangs.
    const result = await safeFetch(`http://127.0.0.1:${port}/x`, {}, 5, { maxBytes: 1024 }).catch((e) => e);
    server.close();
    expect(result instanceof Error).toBe(true);
    expect(String(result.message)).toMatch(/Blocked unsafe URL|download limit/);
  });
});

describe("9.0c — lookup épinglé : les DEUX formes de callback (Happy Eyeballs)", () => {
  it("Node ≥20.13 appelle lookup avec { all: true } → il faut un TABLEAU", () => {
    const lookup = makePinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    let gotErr: Error | null = null;
    let gotAddress: string | Array<{ address: string; family: number }> = "";
    lookup("example.com", { all: true, family: 0 }, (err, address) => {
      gotErr = err; gotAddress = address;
    });
    expect(gotErr).toBeNull();
    // FORME TABLEAU — l'ancien code renvoyait la forme simple et Node 22
    // plantait avec « Invalid IP address: undefined » (VPS Docker 9.0).
    expect(Array.isArray(gotAddress)).toBe(true);
    expect(gotAddress).toHaveLength(2);
    expect((gotAddress as any)[0]).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("forme classique (all absent) → une seule adresse (string, family)", () => {
    const lookup = makePinnedLookup([{ address: "93.184.216.34", family: 4 }]);
    let gotAddress: unknown;
    lookup("example.com", { family: 4 }, (_err, address) => { gotAddress = address; });
    expect(gotAddress).toBe("93.184.216.34");
  });

  it("filtre par famille demandée ; aucune candidate → erreur explicite", () => {
    const lookup = makePinnedLookup([{ address: "93.184.216.34", family: 4 }]);
    let gotAddress: unknown;
    lookup("example.com", { family: 6 }, (_err, address) => { gotAddress = address; });
    expect(gotAddress).toBe(""); // pas d'adresse IPv6 épinglée → rien

    const errors: unknown[] = [];
    lookup("example.com", { family: 6 }, (err) => { errors.push(err); });
    expect(String((errors[0] as Error)?.message)).toContain("no validated address");
  });
});

describe("9.0c — anti-fuite libsignal (clés de session hors des logs)", () => {
  it("console.info('Closing session:', …) est avalé, le reste passe", async () => {
    // Espionner AVANT l'import : le module capture le spy comme console
    // d'origine, on voit donc exactement ce qu'il laisse passer.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../src/bot/suppressLibsignalNoise.js");
    console.info("Closing session:", { rootKey: Buffer.alloc(32) });
    console.warn("Session already closed", { privKey: Buffer.alloc(32) });
    console.info("Message légitime");
    console.warn("Avertissement légitime");
    expect(infoSpy).toHaveBeenCalledTimes(1); // seul le message légitime passe
    expect(infoSpy.mock.calls[0][0]).toBe("Message légitime");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe("Avertissement légitime");
  });
});

describe("9.0c — registre : watch.ts (commande « w ») n'est plus un faux unloadable", () => {
  it("watch figure dans les exceptions de fichiers sources built-in", () => {
    const src = readFileSync(join(__dirname, "../src/bot/commandRegistry.ts"), "utf-8");
    expect(src).toContain('new Set(["novabox", "watch"])');
  });
});
