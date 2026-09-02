import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit 8.43 — urlset master 403 bypass (matrix: variant paths × referers).
 *
 * Production case (Vinland Saga S02E05, vmbox.space): 8.40 derived the right
 * variant shapes but (a) vmbox.space was not in the CDN family list, so the
 * vidmoly referer rotation never applied, and (b) only the first 3 referers
 * were tried on variants, and (c) no winning referer ever propagated to the
 * download engines. resolveVidmolyUrlset fixes all three at extraction time.
 *
 * axios is mocked at module level (deliberate — no other axios unit test in
 * this file); native fetch is stubbed to reject so only the mocked path
 * answers. Fixture host uses a urlSafety-trusted domain to avoid real DNS.
 */

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

import axios from "axios";
import fs from "fs";
import {
  deriveSubVariantUrls,
  isVidmolyCdnUrl,
  resolveVidmolyUrlset,
  VIDMOLY_URLSET_ATTEMPT_BUDGET
} from "../src/bot/services/hlsDownloader.js";

const mockedGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const MASTER =
  "https://box-1659-u.vidmoly.net/hls2/04/00895/q49ll9us6nok_,n,l,.urlset/master.m3u8?t=TOKEN&s=1788316683&e=43200&v=&i=0.4&sp=0&asn=400940";
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NebulaTest",
  Referer: "https://vidmoly.biz/embed-q49ll9us6nok.html",
  Origin: "https://vidmoly.biz"
};
const PLAYLIST = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg_0.ts\n#EXT-X-ENDLIST\n";

beforeEach(() => {
  mockedGet.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isVidmolyCdnUrl — CDN family coverage (8.43)", () => {
  it("covers every file-host family seen in production + the /hls2/ signature", () => {
    for (const url of [
      "https://box-1659-u.vmbox.space/hls2/04/00895/q49ll9us6nok_,n,l,.urlset/master.m3u8?t=1",
      "https://box-c-o-l-9.vmcld.space/hls2/03/00895/1hw2wjjkwmh7_l/index-v1-a1.m3u8",
      "https://box-1583-q.vmeas.cloud/hls2/04/01947/dbl9k4d9aaz0_,n,l,.urlset/master.m3u8",
      "https://gate-1-an.vmnow.online/hls2/03/00895/pdaoo3p3rbtp_l/index-v1-a1.m3u8",
      "https://prx-1316-ant.vmget.online/hls2/01/02217/agn3rikeuvvg_l/index-v1-a1.m3u8",
      "https://prx-1317-ant.vmpx.online/hls2/01/02860/htnjyos87ifz_l/index-v1-a1.m3u8",
      "https://cdn-never-seen.example/hls2/99/00001/newhost_l/index-v1-a1.m3u8"
    ]) {
      expect(isVidmolyCdnUrl(url)).toBe(true);
    }
  });

  it("does not swallow unrelated hosts", () => {
    expect(isVidmolyCdnUrl("https://cdn.example.com/file.mp4")).toBe(false);
    expect(isVidmolyCdnUrl("https://smoothpre.com/abc/master.m3u8")).toBe(false);
  });
});

describe("resolveVidmolyUrlset — master 403 bypass matrix (8.43)", () => {
  it("bypasses a dead master via the derived _l variant and returns the WINNING referer", async () => {
    mockedGet.mockImplementation(async (url: string, config?: { headers?: Record<string, string> }) => {
      if (url === MASTER) throw new Error("403 Forbidden");
      if (url.includes("_l/index-v1-a1") && config?.headers?.Referer === "https://vidmoly.biz/") {
        return { data: PLAYLIST };
      }
      throw new Error("403 Forbidden");
    });

    const res = await resolveVidmolyUrlset(MASTER, BASE_HEADERS);
    expect(res).not.toBeNull();
    expect(res!.mediaPlaylistUrl).toContain("q49ll9us6nok_l/index-v1-a1.m3u8?t=TOKEN");
    expect(res!.headers.Referer).toBe("https://vidmoly.biz/");
  });

  it("keeps the master itself when the right referer unblocks it directly", async () => {
    mockedGet.mockImplementation(async (url: string, config?: { headers?: Record<string, string> }) => {
      if (url === MASTER && config?.headers?.Referer === "https://vidmoly.biz/") return { data: PLAYLIST };
      throw new Error("403 Forbidden");
    });

    const res = await resolveVidmolyUrlset(MASTER, BASE_HEADERS);
    expect(res!.mediaPlaylistUrl).toBe(MASTER);
    expect(res!.headers.Referer).toBe("https://vidmoly.biz/");
  });

  it("returns null with a BOUNDED attempt budget when everything 403s", async () => {
    mockedGet.mockImplementation(async () => { throw new Error("403 Forbidden"); });
    const res = await resolveVidmolyUrlset(MASTER, BASE_HEADERS);
    expect(res).toBeNull();
    expect(mockedGet.mock.calls.length).toBeLessThanOrEqual(VIDMOLY_URLSET_ATTEMPT_BUDGET);
    expect(VIDMOLY_URLSET_ATTEMPT_BUDGET).toBeLessThanOrEqual(40);
  });

  it("is a no-op for plain media playlists", async () => {
    expect(await resolveVidmolyUrlset("https://box.vidmoly.net/hls2/01/x_l/index-v1-a1.m3u8?t=1", BASE_HEADERS)).toBeNull();
    expect(mockedGet.mock.calls.length).toBe(0);
  });
});

describe("urlset wiring (8.43)", () => {
  it("derivation favours the production standard rendition (_l) first", () => {
    const variants = deriveSubVariantUrls(MASTER);
    expect(variants[0]).toContain("q49ll9us6nok_l/index-v1-a1.m3u8?t=TOKEN");
    expect(variants.some(v => v.includes("q49ll9us6nok_n/index-v1-a1.m3u8"))).toBe(true);
  });

  it("extractMultiHostStream resolves urlset masters at extraction time and propagates headers", () => {
    const src = fs.readFileSync("src/bot/services/animeStreamExtractor.ts", "utf-8");
    expect(src).toContain("resolveVidmolyUrlset(fileUrl");
    expect(src).toContain("...resolvedUrlset.headers");
  });

  it("the legacy single-episode VidMoly path resolves urlset masters too (8.44)", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("resolveVidmolyUrlset(targetHlsUrl");
    expect(src).toContain("resolvedUrlset.headers.Referer) downloadSourceUrl");
  });

  it("FUNNEL: executeDirectOrFfmpegDownload resolves urlset masters for EVERY branch (8.45)", () => {
    // Production proof: logs showed host "vidmoly.biz" — the generic
    // last-resort probe — extracting urlset masters, bypassing the 8.43
    // branch-level resolver. The funnel covers all branches.
    const src = fs.readFileSync("src/bot/services/animeStreamExtractor.ts", "utf-8");
    const funnel = src.slice(src.indexOf("export async function executeDirectOrFfmpegDownload"));
    expect(funnel.slice(0, 2000)).toContain("resolveVidmolyUrlset(stream.url");
  });
});
