import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeAxiosGet } from "../src/bot/urlSafety.js";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

/**
 * 8.63 (M1): axios callers used to follow redirects automatically — a 3xx
 * could bounce an initially-validated URL to a private address. safeAxiosGet
 * resolves every hop manually and re-validates it with isSafeDownloadUrl.
 * The happy-path redirect target is a trusted host (voir-anime.to) so the
 * test performs NO DNS lookup and stays deterministic offline.
 */
describe("safeAxiosGet (8.63 — per-hop redirect validation)", () => {
  const get = vi.mocked(axios.get);

  beforeEach(() => {
    get.mockReset();
  });

  it("follows a redirect ONLY after validating the target, and never lets axios auto-follow", async () => {
    get
      .mockResolvedValueOnce({ status: 302, headers: { location: "https://voir-anime.to/next" }, data: "" })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: "OK" });

    const resp = await safeAxiosGet("https://voir-anime.to/start", { validateStatus: (s: number) => s === 200 });

    expect(resp.data).toBe("OK");
    expect(get).toHaveBeenCalledTimes(2);
    // Every hop must disable axios auto-follow: that is the whole point.
    expect(get.mock.calls[0][1]?.maxRedirects).toBe(0);
    expect(get.mock.calls[1][0]).toBe("https://voir-anime.to/next");
    expect(get.mock.calls[1][1]?.maxRedirects).toBe(0);
  });

  it("resolves a RELATIVE Location against the original URL before validating", async () => {
    get
      .mockResolvedValueOnce({ status: 301, headers: { location: "/hop" }, data: "" })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: "OK" });
    const resp = await safeAxiosGet("https://voir-anime.to/a", { validateStatus: () => true });
    expect(resp.data).toBe("OK");
    expect(get.mock.calls[1][0]).toBe("https://voir-anime.to/hop");
  });

  it("blocks a redirect to a private address", async () => {
    get.mockResolvedValueOnce({ status: 302, headers: { location: "http://127.0.0.1/evil" }, data: "" });
    await expect(safeAxiosGet("https://voir-anime.to/start")).rejects.toThrow(/unsafe target/i);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("refuses a 3xx without a usable Location instead of following blindly", async () => {
    get.mockResolvedValueOnce({ status: 302, headers: {}, data: "" });
    await expect(safeAxiosGet("https://voir-anime.to/start")).rejects.toThrow(/Refused redirect/i);
  });

  it("stops after maxRedirects hops", async () => {
    get.mockResolvedValue({ status: 302, headers: { location: "https://voir-anime.to/loop" }, data: "" });
    await expect(safeAxiosGet("https://voir-anime.to/start", {}, 2)).rejects.toThrow();
    expect(get.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("re-applies the caller's validateStatus to the FINAL response (axios-shaped error)", async () => {
    get.mockResolvedValueOnce({ status: 404, headers: {}, data: "nope" });
    const err = await safeAxiosGet("https://voir-anime.to/missing", {
      validateStatus: (s: number) => s === 200,
    }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as any).response?.status).toBe(404);
  });
});
