import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.18uuuu — imageFinder (outil interne Nova `img`) : recherche d'images
 * UNIVERSELLE. Wikipédia d'abord (photo officielle des sujets connus),
 * puis images web Tavily avec descriptions (toute source, Pinterest
 * compris). Parties pures + téléchargement sécurisé (safeFetch mocké —
 * le réseau n'existe pas dans le sandbox).
 */

vi.mock("../src/bot/urlSafety.js", () => ({
  safeFetch: vi.fn(),
}));

import {
  buildWikiImagesUrl,
  parseWikiImages,
  buildTavilyImageRequest,
  parseTavilyImages,
  mergeImageCandidates,
  findImageCandidates,
  downloadImageCandidate,
  IMAGE_SEND_LIMIT,
} from "../src/bot/services/imageFinder.js";
import { safeFetch } from "../src/bot/urlSafety.js";

const mFetch = vi.mocked(safeFetch);

const WIKI_FIXTURE = {
  query: {
    pages: {
      "736": { pageid: 736, ns: 0, title: "Jungkook", index: 1, thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/jk.jpg/1200px-Jungkook.jpg", width: 1200, height: 800 } },
      "42": { pageid: 42, ns: 0, title: "BTS", index: 2, thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/bts.jpg/1200px-BTS.jpg", width: 1200, height: 800 } },
      "43": { pageid: 43, ns: 0, title: "Jungkook (homonymie)", index: 3 },
      "44": { pageid: 44, ns: 0, title: "Autre", index: 4, thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/autre.jpg/1200px-Autre.jpg", width: 1200, height: 800 } },
    },
  },
};

const TAVILY_FIXTURE = {
  images: [
    { url: "https://cdn.pinimg.com/236x/jk-pin.jpg", description: "Jungkook photo Pinterest" },
    { url: "https://example.com/jk.jpg", description: "Jungkook 2024" },
    "https://cdn.pinimg.com/236x/jk-pin.jpg",
  ],
  results: [
    { title: "t1", url: "https://a.com", content: "c", images: [{ url: "https://b.com/jk.png" }, "https://example.com/jk.jpg"] },
    { title: "t2", url: "https://d.com", content: "c", images: "pas-un-tableau" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TAVILY_API_KEY;
});

describe("buildWikiImagesUrl — requête Wikipédia pageimages", () => {
  it("porte generator=search, prop=pageimages et la requête encodée", () => {
    const url = buildWikiImagesUrl("jung kook");
    expect(url).toContain("https://fr.wikipedia.org/w/api.php?");
    expect(url).toContain("generator=search");
    expect(url).toContain("prop=pageimages");
    expect(url).toContain("piprop=thumbnail");
    expect(url).toContain("pithumbsize=1200");
    expect(url).toContain("gsrsearch=jung+kook"); // URLSearchParams encode l'espace en +
  });
});

describe("parseWikiImages — fixture pageimages", () => {
  it("garde les pages avec vignette, triées par pertinence, saute les autres", () => {
    const out = parseWikiImages(WIKI_FIXTURE);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ source: "wikipedia", attribution: "Wikipédia", description: "Jungkook" });
    expect(out.map((c) => c.description)).toEqual(["Jungkook", "BTS", "Autre"]);
  });

  it("réponse vide / inattendue → [] (jamais d'exception)", () => {
    expect(parseWikiImages({})).toEqual([]);
    expect(parseWikiImages(null)).toEqual([]);
    expect(parseWikiImages({ query: { pages: { x: { title: "no-thumb" } } } })).toEqual([]);
  });
});

describe("buildTavilyImageRequest — images + descriptions", () => {
  it("le corps demande include_images et include_image_descriptions", () => {
    const { url, body } = buildTavilyImageRequest("jungkook");
    expect(url).toBe("https://api.tavily.com/search");
    const parsed = JSON.parse(body);
    expect(parsed.include_images).toBe(true);
    expect(parsed.include_image_descriptions).toBe(true);
    expect(parsed.query).toBe("jungkook");
  });
});

describe("parseTavilyImages — images de premier niveau + par résultat", () => {
  it("fusionne, déduplique, garde les descriptions, ignore les entrées invalides", () => {
    const out = parseTavilyImages(TAVILY_FIXTURE);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ url: "https://cdn.pinimg.com/236x/jk-pin.jpg", source: "web", description: "Jungkook photo Pinterest" });
    expect(out.map((c) => c.url)).toContain("https://b.com/jk.png");
    expect(out.every((c) => /^https?:\/\//.test(c.url))).toBe(true);
  });

  it("chaînes nues acceptées, non-URL ignorées", () => {
    const out = parseTavilyImages({ images: ["https://x.org/a.jpg", "javascript:alert(1)", "", null] });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://x.org/a.jpg");
  });
});

describe("mergeImageCandidates — wiki d'abord, dédupliqué, plafonné", () => {
  const wiki = parseWikiImages(WIKI_FIXTURE);
  const web = parseTavilyImages(TAVILY_FIXTURE);

  it("Wikipédia passe avant les images web (photo officielle d'abord)", () => {
    const out = mergeImageCandidates(wiki, web);
    expect(out[0].source).toBe("wikipedia");
    expect(out.some((c) => c.source === "web")).toBe(true);
  });

  it("plafonne à IMAGE_SEND_LIMIT (décision owner : 6)", () => {
    expect(IMAGE_SEND_LIMIT).toBe(6);
    const many = Array.from({ length: 12 }, (_, i) => ({
      url: `https://x.org/${i}.jpg`,
      source: "web" as const,
      attribution: "x.org",
    }));
    expect(mergeImageCandidates([], many)).toHaveLength(6);
  });

  it("déduplique par URL exacte entre les deux moteurs", () => {
    const dup = [{ url: "https://same.org/a.jpg", source: "web" as const, attribution: "same.org" }];
    const out = mergeImageCandidates(dup, dup);
    expect(out).toHaveLength(1);
  });
});

describe("downloadImageCandidate — sécurité du téléchargement (safeFetch mocké)", () => {
  const imageRes = (type: string, bytes = 4) =>
    ({ ok: true, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as any;

  it("accepte jpeg/png/webp/gif avec la bonne extension", async () => {
    mFetch.mockResolvedValueOnce(imageRes("image/jpeg"));
    expect((await downloadImageCandidate("https://x.org/a.jpg"))?.ext).toBe("jpg");
    mFetch.mockResolvedValueOnce(imageRes("image/png"));
    expect((await downloadImageCandidate("https://x.org/a.png"))?.ext).toBe("png");
    mFetch.mockResolvedValueOnce(imageRes("image/webp; charset=binary"));
    expect((await downloadImageCandidate("https://x.org/a.webp"))?.ext).toBe("webp");
    expect(mFetch).toHaveBeenCalledTimes(3);
  });

  it("rejette html, svg et les réponses !ok (null, jamais d'exception)", async () => {
    mFetch.mockResolvedValueOnce(imageRes("text/html"));
    expect(await downloadImageCandidate("https://x.org/a")).toBeNull();
    mFetch.mockResolvedValueOnce(imageRes("image/svg+xml"));
    expect(await downloadImageCandidate("https://x.org/a.svg")).toBeNull();
    mFetch.mockResolvedValueOnce({ ok: false, status: 404 } as any);
    expect(await downloadImageCandidate("https://x.org/404")).toBeNull();
    mFetch.mockRejectedValueOnce(new Error("timeout"));
    expect(await downloadImageCandidate("https://x.org/boom")).toBeNull();
  });

  it("rejette un buffer vide", async () => {
    mFetch.mockResolvedValueOnce(imageRes("image/jpeg", 0));
    expect(await downloadImageCandidate("https://x.org/empty")).toBeNull();
  });
});

describe("findImageCandidates — orchestration best-effort", () => {
  it("Wikipédia seul sans clé Tavily : candidats + moteur « wikipédia »", async () => {
    mFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => WIKI_FIXTURE }) as any);
    const { candidates, engines } = await findImageCandidates("jungkook");
    expect(candidates).toHaveLength(3);
    expect(engines).toEqual(["wikipédia"]);
    expect(mFetch).toHaveBeenCalledTimes(1);
  });

  it("Wikipédia + Tavily avec clé : fusion wiki-first, les deux moteurs cités", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    mFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => WIKI_FIXTURE }) as any);
    mFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => TAVILY_FIXTURE }) as any);
    const { candidates, engines } = await findImageCandidates("jungkook");
    expect(engines).toEqual(["wikipédia", "images web"]);
    expect(candidates[0].source).toBe("wikipedia");
    expect(candidates.length).toBeLessThanOrEqual(IMAGE_SEND_LIMIT);
  });

  it("Wikipédia en panne mais Tavily vivant : le web répond seul", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    mFetch.mockRejectedValueOnce(new Error("wiki down"));
    mFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => TAVILY_FIXTURE }) as any);
    const { candidates, engines } = await findImageCandidates("jungkook");
    expect(candidates).toHaveLength(3);
    expect(engines).toEqual(["images web"]);
  });

  it("tout en panne : zéro candidat, zéro moteur, AUCUNE exception", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    mFetch.mockRejectedValue(new Error("réseau mort"));
    const { candidates, engines } = await findImageCandidates("jungkook");
    expect(candidates).toEqual([]);
    expect(engines).toEqual([]);
  });
});
