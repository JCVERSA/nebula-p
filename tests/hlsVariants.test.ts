import { describe, expect, it } from "vitest";
import fs from "fs";
import { deriveSubVariantUrls, getHeaderCandidates } from "../src/bot/services/hlsDownloader.js";
import { formatFailedEpisodes } from "../src/bot/services/batchRecap.js";

/**
 * Audit 8.40 — episodes served as `_,n,l,.urlset/master.m3u8` 403 on the
 * master path while variant paths stay downloadable. The fixtures below are
 * the EXACT production URLs from the 2026-09-01 VPS log (episode that
 * failed vs episodes that succeeded).
 */

const FAILED_MASTER =
  "https://box-1583-q.vmeas.cloud/hls2/04/01947/dbl9k4d9aaz0_,n,l,.urlset/master.m3u8?t=UXY0nfJ1g6wxQ3qIYUKxKrTJPOMB_mFWdqN44WN1ExM=&s=1788314620&e=43200&v=&i=0.4&sp=0&asn=400940";
const WORKING_VARIANT_SHAPE = "https://prx-1351-ant-20.vmget.online/hls2/01/01913/eegzrr6tfupz_l/index-v1-a1.m3u8";

describe("deriveSubVariantUrls — urlset master 403 fallback (8.40)", () => {
  it("derives the PROVEN working shape (index-v1-a1.m3u8) for every quality letter, _l FIRST", () => {
    const variants = deriveSubVariantUrls(FAILED_MASTER);
    // the LAST urlset letter is the rendition every single-quality file uses in
    // production (`{id}_l/...`) — audit 8.43 reversed the letter order to favour it
    expect(variants[0]).toBe(
      "https://box-1583-q.vmeas.cloud/hls2/04/01947/dbl9k4d9aaz0_l/index-v1-a1.m3u8?t=UXY0nfJ1g6wxQ3qIYUKxKrTJPOMB_mFWdqN44WN1ExM=&s=1788314620&e=43200&v=&i=0.4&sp=0&asn=400940"
    );
    expect(variants).toContain(
      "https://box-1583-q.vmeas.cloud/hls2/04/01947/dbl9k4d9aaz0_n/index-v1-a1.m3u8?t=UXY0nfJ1g6wxQ3qIYUKxKrTJPOMB_mFWdqN44WN1ExM=&s=1788314620&e=43200&v=&i=0.4&sp=0&asn=400940"
    );
    // the derived candidates mirror the exact shape of URLs that succeed in production
    expect(variants[0]).toMatch(/_l\/index-v1-a1\.m3u8\?t=/);
    expect(WORKING_VARIANT_SHAPE).toMatch(/_l\/index-v1-a1\.m3u8$/);
  });

  it("keeps the signature query on every derived candidate (tokens survive)", () => {
    for (const v of deriveSubVariantUrls(FAILED_MASTER)) {
      expect(v).toContain("t=UXY0nfJ1");
      expect(v).toContain("asn=400940");
    }
  });

  it("still derives the legacy generic guesses and the no-letter fallback", () => {
    const variants = deriveSubVariantUrls(FAILED_MASTER);
    expect(variants.some(v => /dbl9k4d9aaz0_n\/index\.m3u8\?t=/.test(v))).toBe(true);
    expect(variants.some(v => /dbl9k4d9aaz0_n\.m3u8\?t=/.test(v))).toBe(true);
    expect(variants.some(v => /dbl9k4d9aaz0\/index-v1-a1\.m3u8\?t=/.test(v))).toBe(true);
    expect(variants.some(v => /dbl9k4d9aaz0\/index\.m3u8\?t=/.test(v))).toBe(true);
  });

  it("returns [] for plain media playlists (nothing to derive)", () => {
    expect(deriveSubVariantUrls(WORKING_VARIANT_SHAPE + "?t=abc")).toEqual([]);
    // master.txt (non-urlset) keeps its own legacy derivations
    const txt = deriveSubVariantUrls("https://x.example/a/master.txt?q=1");
    expect(txt.some(v => v.includes("index-f1-v1-a1.txt?q=1"))).toBe(true);
  });
});

describe("getHeaderCandidates — vidmoly CDN referer coverage (8.40)", () => {
  const base = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NebulaTest" };

  it("applies vidmoly referer rotation to vmeas/vmget/vmnow file hosts, not just vmpx", () => {
    for (const host of ["box-1583-q.vmeas.cloud", "prx-1317-ant.vmpx.online", "gate-2-an.vmnow.online", "prx-1316-ant.vmget.online"]) {
      const cands = getHeaderCandidates(`https://${host}/hls2/01/02199/file_l/index-v1-a1.m3u8?t=1`, base);
      const referers = cands.map(h => h.Referer || "");
      expect(referers).toContain("https://vidmoly.biz/");
      expect(referers).toContain("https://vidmoly.to/");
      expect(referers).toContain("https://vmpx.online/");
    }
  });

  it("keeps merged base headers as the first candidate for any host", () => {
    const cands = getHeaderCandidates("https://cdn.example.com/a.m3u8", { ...base, Referer: "https://embed.example/e1" });
    expect(cands[0].Referer).toBe("https://embed.example/e1");
  });
});

describe("formatFailedEpisodes — batch recap (8.40)", () => {
  it("returns nothing when every requested episode was delivered", () => {
    expect(formatFailedEpisodes([2, 3, 4, 5], [2, 3, 4, 5])).toBe("");
    expect(formatFailedEpisodes([], [])).toBe("");
  });

  it("lists exactly the missing episodes (log case: E4 of 2-6 missing)", () => {
    const line = formatFailedEpisodes([2, 3, 4, 5, 6], [2, 3, 5, 6]);
    expect(line).toContain("*Failed:*");
    expect(line).toContain("Episode 4");
    expect(line).not.toContain("Episode 5");
  });

  it("handles several missing episodes and dedups the request list", () => {
    const line = formatFailedEpisodes([1, 1, 2, 3], [2]);
    expect(line).toContain("Episode 1");
    expect(line).toContain("Episode 3");
    expect((line.match(/Episode 2/g) || []).length).toBeLessThanOrEqual(1);
  });
});

describe("batch recap wiring (8.40)", () => {
  it("novabox summary includes the failed-episodes line", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("formatFailedEpisodes(");
    expect(src).toContain("indices.map(i => i + 1)");
  });
});
