import { describe, it, expect } from "vitest";
import {
  decodeNakanimeResponse,
  deriveNakanimeKey,
  parseNakanimeSeasonsScript,
  isNakanimeUrl,
  normalizeNakanimeEpisodeRefs
} from "../src/bot/services/nakanimeClient.js";

/**
 * Fixed vectors computed with the reference (Python) implementation of
 * nakanime's XOR scheme: key = derive("nkapiv1" + path), body[i] ^ key[i%32].
 */
const SEARCH_PATH = "/api/catalog/search?q=geass&sort=relevance&page=1&per_page=32";
const SEARCH_HEX =
  "4b52d491441192ca6b0b929954528ac102439cd2431cc597124a92935f14d5dd5715d18343529cd24419c49c55528ad2731fd4951037d5914303928d6d0d";
const SOURCES_HEX =
  "2af03bbb26a275e27ba932be33bb2bc24dc00f850b8112890e8f49d64fb820a3059401f679f422aa35f861fe35aa2b9012d84ccb138f038d06c418850f800a847fa026fb23f936ba3af436ac69fc22";

describe("nakanime XOR codec", () => {
  it("derives the documented key", () => {
    const key = deriveNakanimeKey(SEARCH_PATH);
    expect(Array.from(key.slice(0, 8))).toEqual([48, 112, 176, 240, 48, 112, 176, 240]);
    expect(key.length).toBe(32);
  });

  it("decodes a captured search payload", () => {
    const out = decodeNakanimeResponse(Buffer.from(SEARCH_HEX, "hex"), SEARCH_PATH);
    expect(out).not.toBeNull();
    expect(JSON.parse(out!)).toEqual({
      data: [{ id: 123, slug: "code-geass", title: "Code Geass" }]
    });
  });

  it("decodes a captured sources payload", () => {
    const out = decodeNakanimeResponse(Buffer.from(SOURCES_HEX, "hex"), "/api/sources/anime");
    expect(JSON.parse(out!)).toEqual({
      host: "sibnet",
      language: "VOSTFR",
      url: "https://video.sibnet.ru/v/abc.mp4"
    });
  });

  it("round-trips arbitrary payloads", () => {
    const key = deriveNakanimeKey("/api/anime/42/episodes");
    const payload = Buffer.from(JSON.stringify({ data: [{ seasonNumber: 2, number: 7 }] }), "utf8");
    const enc = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) enc[i] = payload[i] ^ key[i % key.length];
    expect(decodeNakanimeResponse(enc, "/api/anime/42/episodes")).toBe(payload.toString("utf8"));
  });
});

describe("nakanime seasons script parser", () => {
  it("extracts seasons and episode numbers from the embedded JSON script", () => {
    const html = `
      <html><body>
      <script>console.log("noise")</script>
      <script>{"animeId":123,"seasons":[
        {"number":1,"episodes":[{"number":1,"id":11},{"number":2,"id":12}]},
        {"number":2,"episodes":[{"number":1,"id":21}]}
      ]}</script>
      </body></html>`;
    const bySeason = parseNakanimeSeasonsScript(html);
    expect(bySeason.size).toBe(2);
    expect(bySeason.get(1)).toEqual([
      { number: 1, id: 11 },
      { number: 2, id: 12 }
    ]);
    expect(bySeason.get(2)).toEqual([{ number: 1, id: 21 }]);
  });

  it("returns an empty map when no seasons script exists", () => {
    expect(parseNakanimeSeasonsScript("<html><script>var x = 1;</script></html>").size).toBe(0);
  });
});

describe("isNakanimeUrl", () => {
  it("detects nakanime URLs and rejects others", () => {
    expect(isNakanimeUrl("https://nakanime.tv/anime/5/code-geass")).toBe(true);
    expect(isNakanimeUrl("https://anime-sama.to/catalogue/x/")).toBe(false);
    expect(isNakanimeUrl("")).toBe(false);
  });
});

describe("normalizeNakanimeEpisodeRefs (positional indexing fix, audit 8.2)", () => {
  it("sorts newest-first listings ascending — the rezero s5 empty-slot bug", () => {
    // nakanime listed season 5 episodes 80..1; with number-1 indexing the
    // first 40 lookups filled slots 40..79 and episode 2 stayed empty.
    const refs = Array.from({ length: 80 }, (_, i) => ({ number: 80 - i, id: 1000 + i }));
    const out = normalizeNakanimeEpisodeRefs(refs);
    expect(out.length).toBe(80);
    expect(out[0].number).toBe(1);
    expect(out[1].number).toBe(2); // the slot that was empty before the fix
    expect(out[79].number).toBe(80);
  });

  it("deduplicates by number, keeping the first ref (id preferentially)", () => {
    const out = normalizeNakanimeEpisodeRefs([
      { number: 3, id: 33 },
      { number: 1 },
      { number: 3, id: 34 },
      { number: 2, id: 22 }
    ]);
    expect(out.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(out[2].id).toBe(33);
  });

  it("drops invalid and non-positive numbers", () => {
    const out = normalizeNakanimeEpisodeRefs([
      { number: 0 },
      { number: -2 },
      { number: NaN },
      { number: 5, id: 55 }
    ] as any);
    expect(out).toEqual([{ number: 5, id: 55 }]);
  });

  it("keeps non-contiguous numbering ordered (positional semantics)", () => {
    const out = normalizeNakanimeEpisodeRefs([{ number: 26 }, { number: 31 }, { number: 27 }]);
    expect(out.map((r) => r.number)).toEqual([26, 27, 31]);
  });

  it("handles empty input", () => {
    expect(normalizeNakanimeEpisodeRefs([])).toEqual([]);
    expect(normalizeNakanimeEpisodeRefs(undefined as any)).toEqual([]);
  });
});
