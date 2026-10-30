import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.18wwww — Novaboxb (films) : client du catalogue, extracteur veev/doods,
 * commande .novafilm. Fixtures issues du terrain réel (curl owner 25/10 +
 * fiche Insidious) ; réseau mocké (le sandbox n'a pas accès au site).
 */

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } })),
    isAxiosError: vi.fn(() => false),
  },
}));

import {
  parseFilmSearchHtml,
  parseFilmPlayersApi,
  extractFilmId,
  normalizeFilmLanguage,
  filmMirrorsForLanguage,
  filmAvailableLanguages,
  getFilmDetail,
  filmSearch,
  isFilmRelayUrl,
  resolveFilmPlayerUrl,
} from "../src/bot/services/filmStreamClient.js";
import axios from "axios";
import { getCommand, initRegistry } from "../src/bot/commandRegistry.js";

const mGet = vi.mocked(axios.get);
const mPost = vi.mocked(axios.post);

// Fixture RÉELLE du terrain (sortie curl owner 25/10, tronquée à 2 résultats).
const SEARCH_HTML = `
<div class='search-item' onclick="location.href='/1798-insidious-film-streaming-complet-vf.html'"><div class='search-poster'><img src='https://image.tmdb.org/t/p/w400/tmlDFIUpGRKiuWm9Ixc6CYDk4y0.jpg' alt='Insidious' loading='lazy'></div><div class='search-info'><div class='search-title'>Insidious (2010)</div></div></div>
<div class='search-item' onclick="location.href='/15135028-insidious-l-invasion-du-lointain.html'"><div class='search-poster'><img src='https://image.tmdb.org/t/p/w400/bW8uJOLrtdBnQcQbG9BUQjDgUaT.jpg' alt='Insidious 6'></div><div class='search-info'><div class='search-title'>Insidious : L'Invasion du Lointain</div></div></div>
<div class='pas-un-resultat'></div>
`;

// Fixture RÉELLE — réponse VERBATIM de film_api.php captée en direct le
// 30/10 (fiche Insidious 2026) : clés de langue MINUSCULES (default / vostfr /
// vff / vfq) et players dood/voe/filmoon servis via le relais kokoflix.lol.
// C'est le format exact qui a cassé la V1 (« aucun-joueur ») : la V1 attendait
// FRENCH/TRUEFRENCH majuscules (ancien format documenté par les scrapers).
const PLAYERS_API = {
  players: {
    premium: { default: "https://fsvid.lol/embed-q6iu6tk3e2p7.html" },
    vidzy: { default: "https://vidzy.cc/embed-fq17f9p8xiwd.html", vostfr: "https://vidzy.org/embed-9zds0xzd8qfs.html", vff: "https://vidzy.org/embed-xcann0vdymps.html", vfq: "https://vidzy.org/embed-nc4i5ehli77o.html" },
    uqload: { default: "https://uqload.vc/embed-9urzvakte99o.html", vostfr: "https://uqload.vc/embed-f22kwrwpfwh2.html", vff: "https://uqload.vc/embed-9urzvakte99o.html", vfq: "https://uqload.vc/embed-d7leu27l16ke.html" },
    dood: { default: "https://kokoflix.lol/tokyo_go.php?id=dmcBHiG1tK4EykoY8hDaF", vostfr: "https://kokoflix.lol/tokyo_go.php?id=WqgXsAS60Ie1xM2JtVRLp", vff: "https://kokoflix.lol/tokyo_go.php?id=dmcBHiG1tK4EykoY8hDaF", vfq: "https://kokoflix.lol/tokyo_go.php?id=rdZ1LvpXqeW4oix8ft3zh" },
    voe: { default: "https://kokoflix.lol/osaka_go.php?id=04vsnkYj2zfBMVeQaUKdP", vostfr: "https://kokoflix.lol/osaka_go.php?id=sYOrtm75qXRxPCdZLAk9n", vff: "https://kokoflix.lol/osaka_go.php?id=04vsnkYj2zfBMVeQaUKdP", vfq: "https://kokoflix.lol/osaka_go.php?id=ELl7vfyWXeDuHB0ITYK5F" },
    filmoon: { default: "https://kokoflix.lol/grandline_go.php?id=3dPClpiajXUvDVW0f5nHJ", vostfr: "https://kokoflix.lol/grandline_go.php?id=69vd5ebf7k3aT8ILWZA4E", vff: "https://kokoflix.lol/grandline_go.php?id=3dPClpiajXUvDVW0f5nHJ", vfq: "https://kokoflix.lol/grandline_go.php?id=fuJALITCwKWDanpQEdyv0" },
    bogus: { langue_inconnue: "https://example.com/x", vff: "pas-une-url" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEBULA_FILM_SOURCE;
});

describe("filmStreamClient — parsing (fixtures du terrain)", () => {
  it("parseFilmSearchHtml : titres, URLs absolues sur l'origine, posters", () => {
    const out = parseFilmSearchHtml(SEARCH_HTML, "https://french-stream.net");
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Insidious (2010)");
    expect(out[0].url).toBe("https://french-stream.net/1798-insidious-film-streaming-complet-vf.html");
    expect(out[1].url).toBe("https://french-stream.net/15135028-insidious-l-invasion-du-lointain.html");
    expect(out[0].poster).toContain("image.tmdb.org");
  });

  it("parseFilmSearchHtml : une URL externe à l'origine est REJETÉE (SSRF)", () => {
    const evil = `<div class='search-item' onclick="location.href='https://evil.example.com/x.html'"><div class='search-title'>Piège</div></div>`;
    expect(parseFilmSearchHtml(evil, "https://french-stream.net")).toHaveLength(0);
  });

  it("extractFilmId : ancien et nouveau format de slug", () => {
    expect(extractFilmId("https://french-stream.net/15135028-insidious-l-invasion-du-lointain.html")).toBe("15135028");
    expect(extractFilmId("https://french-stream.net/1798-insidious-film-streaming-complet-vf.html")).toBe("1798");
    expect(extractFilmId("https://french-stream.net/sans-id.html")).toBeNull();
  });

  it("normalizeFilmLanguage : clés réelles minuscules (vff/vfq/default) + anciennes majuscules", () => {
    expect(normalizeFilmLanguage("vff")).toBe("VF");
    expect(normalizeFilmLanguage("vfq")).toBe("VF");
    expect(normalizeFilmLanguage("TRUEFRENCH")).toBe("VF");
    expect(normalizeFilmLanguage("french")).toBe("VF");
    expect(normalizeFilmLanguage("vostfr")).toBe("VOSTFR");
    expect(normalizeFilmLanguage("VOSTFR")).toBe("VOSTFR");
    expect(normalizeFilmLanguage("default")).toBe("VOSTFR");
    expect(normalizeFilmLanguage("vo")).toBeNull();
  });

  it("parseFilmPlayersApi : 21 joueurs valides (VF 10 / VOSTFR 11), invalide ignoré", () => {
    const out = parseFilmPlayersApi(PLAYERS_API);
    expect(out).toHaveLength(21);
    expect(out.filter((p) => p.language === "VF")).toHaveLength(10);
    expect(out.filter((p) => p.language === "VOSTFR")).toHaveLength(11);
    expect(out.some((p) => p.url === "https://kokoflix.lol/tokyo_go.php?id=rdZ1LvpXqeW4oix8ft3zh")).toBe(true);
    expect(out.some((p) => p.name === "premium")).toBe(true);
    expect(out.every((p) => /^https?:\/\//.test(p.url))).toBe(true);
  });

  it("filmMirrorsForLanguage + filmAvailableLanguages (embeds directs et relais mélangés)", () => {
    const players = parseFilmPlayersApi(PLAYERS_API);
    const vf = filmMirrorsForLanguage(players, "VF");
    expect(vf).toHaveLength(10);
    expect(vf).toContain("https://vidzy.org/embed-xcann0vdymps.html");
    expect(vf.some((u) => isFilmRelayUrl(u))).toBe(true); // relais dood/voe/filmoon
    expect(filmAvailableLanguages(players)).toEqual(["VF", "VOSTFR"]);
    expect(filmMirrorsForLanguage(players, "VOSTFR")).toHaveLength(11);
  });
});

describe("filmStreamClient — réseau (axios mocké)", () => {
  it("getFilmDetail : fiche SÉRIE détectée honnêtement (ep-data.php)", async () => {
    mGet.mockResolvedValueOnce({ status: 200, data: '<html><script src="ep-data.php?id=1"></script></html>' });
    const out = await getFilmDetail("https://french-stream.net/123-série.html");
    expect(out.kind).toBe("series");
  });

  it("getFilmDetail : film → joueurs via l'API dédiée", async () => {
    mGet.mockResolvedValueOnce({ status: 200, data: "<html>fiche film</html>" });
    mGet.mockResolvedValueOnce({ status: 200, data: PLAYERS_API });
    const out = await getFilmDetail("https://french-stream.net/15135028-insidious-l-invasion-du-lointain.html");
    expect(out.kind).toBe("film");
    if (out.kind === "film") expect(out.players.length).toBe(21);
    expect(mGet).toHaveBeenLastCalledWith(
      "https://french-stream.net/engine/ajax/film_api.php?id=15135028",
      expect.anything()
    );
  });

  it("getFilmDetail : URL hors origine refusée ; erreur HTTP remontée proprement", async () => {
    const out = await getFilmDetail("https://autre-site.example.com/film.html");
    expect(out).toEqual({ kind: "error", reason: "url-externe" });
    mGet.mockResolvedValueOnce({ status: 503, data: "" });
    const out2 = await getFilmDetail("https://french-stream.net/1-x.html");
    expect(out2).toEqual({ kind: "error", reason: "http-503" });
  });

  it("filmSearch : POST ajax avec Referer, résultats parsés", async () => {
    mPost.mockResolvedValueOnce({ status: 200, data: SEARCH_HTML });
    const out = await filmSearch("insidious");
    expect(out).toHaveLength(2);
    expect(mPost).toHaveBeenCalledWith(
      "https://french-stream.net/engine/ajax/search.php",
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Referer: "https://french-stream.net/" }) })
    );
  });

  it("NEBULA_FILM_SOURCE pilote l'origine (rotation de domaine = une ligne env)", async () => {
    process.env.NEBULA_FILM_SOURCE = "https://french-stream.one";
    mGet.mockResolvedValueOnce({ status: 200, data: "<html>x</html>" });
    mGet.mockResolvedValueOnce({ status: 200, data: PLAYERS_API });
    await getFilmDetail("https://french-stream.one/42-film.html");
    expect(mGet).toHaveBeenLastCalledWith("https://french-stream.one/engine/ajax/film_api.php?id=42", expect.anything());
  });
});

describe("9.18xxxx — relais players kokoflix (résolution avec Referer catalogue)", () => {
  it("isFilmRelayUrl : kokoflix et *_go.php oui, embeds directs non, URL invalide non", () => {
    expect(isFilmRelayUrl("https://kokoflix.lol/tokyo_go.php?id=x")).toBe(true);
    expect(isFilmRelayUrl("https://autre-hote.exemple/_go.php?id=x")).toBe(true);
    expect(isFilmRelayUrl("https://vidzy.org/embed-x.html")).toBe(false);
    expect(isFilmRelayUrl("pas une url")).toBe(false);
  });

  it("un embed direct passe tel quel (aucun appel réseau)", async () => {
    const out = await resolveFilmPlayerUrl("https://vidzy.org/embed-x.html");
    expect(out).toBe("https://vidzy.org/embed-x.html");
    expect(mGet).not.toHaveBeenCalled();
  });

  it("relais : redirection HTTP suivie → l'URL finale du vrai player (Referer catalogue envoyé)", async () => {
    mGet.mockResolvedValueOnce({ status: 200, data: "", request: { res: { responseUrl: "https://doods.pro/e/real1" } } });
    const out = await resolveFilmPlayerUrl("https://kokoflix.lol/tokyo_go.php?id=x");
    expect(out).toBe("https://doods.pro/e/real1");
    expect(mGet.mock.calls[0]?.[1]?.headers?.Referer).toBe("https://french-stream.net/");
  });

  it("relais : redirection JS dans la page → le vrai embed", async () => {
    mGet.mockResolvedValueOnce({ status: 200, data: `<html><script>window.location='https://voe.sx/e/real2'</script></html>` });
    const out = await resolveFilmPlayerUrl("https://kokoflix.lol/osaka_go.php?id=y");
    expect(out).toBe("https://voe.sx/e/real2");
  });

  it("relais en échec (500, page vide, réseau) → URL d'origine conservée (miroir skippé honnêtement)", async () => {
    mGet.mockResolvedValueOnce({ status: 500, data: "" });
    expect(await resolveFilmPlayerUrl("https://kokoflix.lol/x_go.php?id=a")).toBe("https://kokoflix.lol/x_go.php?id=a");
    mGet.mockResolvedValueOnce({ status: 200, data: "" });
    expect(await resolveFilmPlayerUrl("https://kokoflix.lol/x_go.php?id=b")).toBe("https://kokoflix.lol/x_go.php?id=b");
    mGet.mockRejectedValueOnce(new Error("timeout"));
    expect(await resolveFilmPlayerUrl("https://kokoflix.lol/x_go.php?id=c")).toBe("https://kokoflix.lol/x_go.php?id=c");
  });
});

// ─── 9.18yyyy — famille XUpload (vidzy/uqload) : décodage + anti-leurre ─────
// Terrain 30/10 23:16 : `.f 1` → fichier de 0.4 MB — la playlist LEURRE du
// lecteur vidzy servie comme film. Fix : décodage XUpload (base64 → reverse
// → XOR graine-hôte + BC), validation de vie de CHAQUE candidat (pas HTML,
// playlist #EXTM3U, ≥ 1 Mo en direct), repli transparent sur les autres
// miroirs. Blobs construits par l'encodeur symétrique (zéro réseau).

describe("9.18yyyy — famille XUpload (vidzy) : décodage blob + anti-leurre", () => {
  const MASTER_URL =
    "https://v6.vidzy.cc/hls2/01/00064/xcann0vdymps_o/master.m3u8?t=YdpGESGL&s=1793399216&e=14400&f=323156";
  const SEED_VIDZY_CC = 42; // 'v'+'i'+'d'+'z'+'y'+'.'+'c'+'c' = 810 & 255
  const BC_MEASURED = 97; // CSS « 1in + 98px » → (96 + 98) / 2

  /** Encodeur symétrique de decodeXUploadBlob (le décodeur inverse les octets). */
  function encodeXUpload(url: string, seed: number, bc: number): string {
    const p = Buffer.from(url, "utf8");
    const x = Buffer.alloc(p.length);
    for (let k = 0; k < p.length; k++) x[k] = p[k] ^ ((0x3d + k * 89 + seed + bc) & 255);
    return Buffer.from(x.reverse()).toString("base64");
  }

  afterEach(() => {
    mGet.mockReset();
  });

  it("xuploadHostSeed : checksums réels (vidzy.cc=42, vidzy.org=172)", async () => {
    const { xuploadHostSeed } = await import("../src/bot/services/animeStreamExtractor.js");
    expect(xuploadHostSeed("vidzy.cc")).toBe(42);
    expect(xuploadHostSeed("vidzy.org")).toBe(172);
    expect(xuploadHostSeed("")).toBe(0);
  });

  it("decodeXUploadBlob : aller-retour ; mauvaise clé (BC) ne rend jamais l'URL", async () => {
    const { decodeXUploadBlob } = await import("../src/bot/services/animeStreamExtractor.js");
    const blob = encodeXUpload(MASTER_URL, SEED_VIDZY_CC, BC_MEASURED);
    expect(decodeXUploadBlob(blob, SEED_VIDZY_CC, BC_MEASURED)).toBe(MASTER_URL);
    // mauvais BC : bruit — jamais l'URL attendue
    expect(decodeXUploadBlob(blob, SEED_VIDZY_CC, BC_MEASURED + 1)).not.toBe(MASTER_URL);
    expect(decodeXUploadBlob("!!!pas-base64!!!", SEED_VIDZY_CC, 0)).toBeNull();
  });

  it("extractXUploadStreamUrls : BC mesuré ET brute-force ; blob AVANT sources claires ; uqload plain", async () => {
    const { extractXUploadStreamUrls } = await import("../src/bot/services/animeStreamExtractor.js");
    const blob = encodeXUpload(MASTER_URL, SEED_VIDZY_CC, BC_MEASURED);
    const withHint = `<html><style>.m{width:calc(1in + 98px)}</style><script>if(el.offsetWidth){sources:[{src:(function(s){return s})("${blob}")}]}</script></html>`;
    // BC lu depuis le CSS
    expect(extractXUploadStreamUrls(withHint, "vidzy.cc")).toEqual([MASTER_URL]);
    // Sans l'indice CSS : brute-force 0..255 — la graine hôte suffit
    const noHint = `<html><script>if(el.offsetWidth){sources:[{src:(function(s){return s})("${blob}")}]}</script></html>`;
    expect(extractXUploadStreamUrls(noHint, "vidzy.cc")).toEqual([MASTER_URL]);
    // Autre hôte servi : graine différente MAIS le brute-force BC (0..255)
    // couvre toutes les sommes additives (graine + BC) mod 256 — l'URL est
    // retrouvée quand même (robustesse aux rotations de domaine vidzy).
    expect(extractXUploadStreamUrls(noHint, "vidzy.org")).toEqual([MASTER_URL]);
    // Blob décodé classé AVANT une source claire (le leurre pub reste 2e) —
    // le marqueur offsetWidth active le brute-force BC (gabarit actuel).
    const both = `<html><script>if(el.offsetWidth){sources:[{file:"https://pub.example/promo.mp4"}];(function(s){})("${blob}")}</script></html>`;
    expect(extractXUploadStreamUrls(both, "vidzy.cc")[0]).toBe(MASTER_URL);
    expect(extractXUploadStreamUrls(both, "vidzy.cc")[1]).toBe("https://pub.example/promo.mp4");
    // Ancien gabarit (aucune mesure navigateur) : clé = graine seule (bc=0)
    const legacyUrl = "https://v6.vidzy.cc/hls2/old/template-legacy/master.m3u8?t=abc123";
    const legacyBlob = encodeXUpload(legacyUrl, SEED_VIDZY_CC, 0);
    const legacy = `<html><script>sources:[{src:(function(s){return s})("${legacyBlob}")}]</script></html>`;
    expect(extractXUploadStreamUrls(legacy, "vidzy.cc")).toEqual([legacyUrl]);
    // uqload : source claire jwplayer
    const uq = `<html><script>jwplayer("v").setup({sources:[{file:"https://uqload.vc/abc.mp4"}]})</script></html>`;
    expect(extractXUploadStreamUrls(uq, "uqload.vc")).toContain("https://uqload.vc/abc.mp4");
  });

  it("extractXUploadFamilyStream : Referer catalogue refusé (403) → origine → blob décodé → m3u8 validée + tracks réelles", async () => {
    const { extractXUploadFamilyStream } = await import("../src/bot/services/animeStreamExtractor.js");
    const blob = encodeXUpload(MASTER_URL, SEED_VIDZY_CC, BC_MEASURED);
    const pageHtml = `<html><style>.m{width:calc(1in + 98px)}</style><script>if(el.offsetWidth){sources:[{src:(function(s){return s})("${blob}")}]}</script></html>`;
    const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\nv480.m3u8\n";

    mGet.mockImplementation(async (url: any, cfg: any) => {
      const u = String(url);
      const referer = cfg?.headers?.Referer || "";
      if (u.includes("vidzy.cc/embed")) {
        if (referer === "https://french-stream.net/") return { status: 403, data: "" }; // Referer catalogue refusé
        return { status: 200, data: pageHtml, request: { res: { responseUrl: "https://vidzy.cc/embed-x.html" } } };
      }
      if (u.includes("master.m3u8")) {
        return { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" }, data: MASTER };
      }
      if (u.includes("v480.m3u8")) {
        return { status: 200, headers: {}, data: "#EXTM3U\n#EXTINF:600.0,\nseg1.ts\n" };
      }
      return { status: 404, data: "" };
    });

    const res = await extractXUploadFamilyStream("https://vidzy.cc/embed-x.html", {
      refererHint: "https://french-stream.net/",
    });

    expect(res).not.toBeNull();
    expect(res!.url).toBe(MASTER_URL);
    expect(res!.type).toBe("hls");
    expect(res!.hostName).toBe("vidzy.cc");
    expect(res!.headers.Referer).toBe("https://vidzy.cc/");
    expect(res!.availableTracks?.length).toBeGreaterThan(0);
    expect(res!.availableTracks![0].url).toContain("v480.m3u8");
    expect(res!.availableTracks![0].fileSizeBytes).toBeGreaterThan(0);
    // Le Referer catalogue a bien été essayé EN PREMIER
    expect(mGet.mock.calls[0]?.[1]?.headers?.Referer).toBe("https://french-stream.net/");
  });

  it("anti-leurre (régression terrain 0.4 MB) : source claire type pub < 1 Mo REJETÉE → null ; mp4 plausible accepté", async () => {
    const { extractXUploadFamilyStream } = await import("../src/bot/services/animeStreamExtractor.js");
    const decoyHtml = `<html><script>jwplayer("v").setup({sources:[{file:"https://pub.example/promo.mp4"}]})</script></html>`;

    mGet.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes("uqload.vc/embed")) return { status: 200, data: decoyHtml };
      if (u.includes("promo.mp4")) {
        return { status: 200, headers: { "content-type": "video/mp4", "content-length": "420000" } };
      }
      return { status: 404, data: "" };
    });
    expect(await extractXUploadFamilyStream("https://uqload.vc/embed-1.html")).toBeNull();

    // Un vrai fichier (content-range total 323 Mo) passe, avec taille honnête
    mGet.mockReset();
    mGet.mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes("uqload.vc/embed")) return { status: 200, data: decoyHtml };
      if (u.includes("promo.mp4")) {
        return { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-2047/339078000" } };
      }
      return { status: 404, data: "" };
    });
    const res = await extractXUploadFamilyStream("https://uqload.vc/embed-1.html");
    expect(res).not.toBeNull();
    expect(res!.type).toBe("direct_mp4");
    expect(res!.url).toBe("https://pub.example/promo.mp4");
    expect(res!.estimatedSizeMB).toBe(323);
  });

  it("resolveBestMirrorStream : plus RIEN d'extractible → URL vide (fini le pseudo-hls = page embed)", async () => {
    const { resolveBestMirrorStream } = await import("../src/bot/services/animeStreamExtractor.js");
    mGet.mockImplementation(async () => ({ status: 500, data: "" }));
    const res = await resolveBestMirrorStream(["https://vidzy.cc/embed-x.html"], "480P");
    expect(res.url).toBe("");
    expect(res.hostName).toBe("");
  });

  it("garde finale looksLikeRealMediaFile : ≥ 1 Mo non-HTML, sinon rejet (fichiers réels)", async () => {
    const os = await import("os");
    const pathMod = await import("path");
    const { looksLikeRealMediaFile } = await import("../src/bot/commands/novafilm.js");
    const tmp = (name: string) => pathMod.join(os.tmpdir(), `novafilm-guard-${process.pid}-${name}`);

    const big = Buffer.alloc(12 * 1024 * 1024, 0x47); // flux TS binaire
    fs.writeFileSync(tmp("big.mp4"), big);
    expect(looksLikeRealMediaFile(tmp("big.mp4"))).toBe(true);

    fs.writeFileSync(tmp("tiny.mp4"), Buffer.alloc(400 * 1024, 0x47)); // leurre 0.4 MB
    expect(looksLikeRealMediaFile(tmp("tiny.mp4"))).toBe(false);

    const htmlPage = Buffer.concat([Buffer.from("<!DOCTYPE html><html><body>leurre</body>"), Buffer.alloc(2 * 1024 * 1024, 0x61)]);
    fs.writeFileSync(tmp("html.mp4"), htmlPage);
    expect(looksLikeRealMediaFile(tmp("html.mp4"))).toBe(false);

    expect(looksLikeRealMediaFile(tmp("inexistant.mp4"))).toBe(false);
    for (const n of ["big.mp4", "tiny.mp4", "html.mp4"]) {
      try {
        fs.unlinkSync(tmp(n));
      } catch {}
    }
  });

  it("repli miroirs câblé dans .f (refererHint, boucle de secours, garde, session)", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain('resolveBestMirrorStream(resolved, "480P", {');
    expect(src).toContain("extractMultiHostStream(mirrorUrl, {");
    expect(src).toContain("pickOptimalStream(altTracks, wantedRes)");
    expect(src).toContain("looksLikeRealMediaFile(localPath)");
    expect(src).toContain("FILM_MIN_BYTES");
    expect(src).toContain("session.resolvedMirrors");
    const engine = fs.readFileSync("src/bot/services/animeStreamExtractor.ts", "utf-8");
    expect(engine).toContain("await extractXUploadFamilyStream(playerUrl, options)");
    expect(engine).toContain("9.18yyyy — repli HONNETE");
  });
});

describe("9.18wwww — extracteur veev/doods (moteur partagé)", () => {
  it("veevLzwDecode : vecteurs connus (identité, code étendu, vide)", async () => {
    const { veevLzwDecode, veevParseRules, veevDecodeFinal, buildVeevApiUrl } = await import(
      "../src/bot/services/animeStreamExtractor.js"
    );
    expect(veevLzwDecode("aaa")).toBe("aaa");
    expect(veevLzwDecode("a\u0100")).toBe("aaa"); // code 256 absent du LUT → c + c[0]
    expect(veevLzwDecode("")).toBe("");
    expect(veevParseRules("3120")).toEqual([0, 2, 1]);
    expect(veevParseRules("0")).toEqual([]);
    expect(veevParseRules("")).toEqual([]);
    expect(veevDecodeFinal("48656c6c6f", [])).toBe("48656c6c6f"); // regle vide = identite
    expect(veevDecodeFinal("48656c6c6f", [0])).toBe("Hello");
    expect(veevDecodeFinal("6f6666", [1])).toBe("6666f6"); // hex non-UTF8 : garde tel quel
    expect(veevDecodeFinal("6666f6", [1])).toBe("off"); // reverse puis hex valide
    expect(veevDecodeFinal("HellodXRmOA==", [0])).toBe("Hello"); // sel retiré
    expect(buildVeevApiUrl("abc", "312")).toBe(
      "https://veev.to/dl?op=player_api&cmd=gi&file_code=abc&r=https://veev.to&ch=312&ie=1"
    );
  });

  it("la branche veev/doods est câblée dans extractMultiHostStream + hostPriority", async () => {
    const src = fs.readFileSync("src/bot/services/animeStreamExtractor.ts", "utf-8");
    expect(src).toContain("await extractVeevFamilyStream(playerUrl)");
    expect(src).toContain('l.includes("doods") || l.includes("veev")');
  });
});

// ─── 9.18zzzz — tailles honnêtes + plafond dur (terrain 31/10 00:05) ────────
// 240 MB affichés, 1666 MB livrés : la durée de repli 24 min (heuristique
// ANIME) sous-estimait 6× un film de 2 h. + un HLS de 1,6 GB téléchargé
// sans plafond d'octets (risque disque sur le VPS 953 Mo).

describe("9.18zzzz — durée de repli film (estimation de taille honnête)", () => {
  it("fetchHlsTracksAndSizes : playlist variante illisible → 6600 s (film), pas 1440 s (anime)", async () => {
    const { fetchHlsTracksAndSizes } = await import("../src/bot/services/animeStreamExtractor.js");
    const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\nv480.m3u8\n";
    mGet.mockImplementation(async (url: any) => {
      if (String(url).includes("master.m3u8")) {
        return { status: 200, headers: {}, data: MASTER };
      }
      // playlist variante illisible (403/404/réseau) → durée inconnue
      throw new Error("forbidden");
    });
    const filmTracks = await fetchHlsTracksAndSizes("https://x.cc/master.m3u8", "https://x.cc/", "https://x.cc", 6600);
    expect(filmTracks.length).toBeGreaterThan(0);
    expect(filmTracks[0]!.fileSizeBytes).toBe(Math.round((1000000 * 6600) / 8)); // 825 MB
    const animeTracks = await fetchHlsTracksAndSizes("https://x.cc/master.m3u8", "https://x.cc/", "https://x.cc");
    expect(animeTracks[0]!.fileSizeBytes).toBe(Math.round((1000000 * 1440) / 8)); // 180 MB
  });

  it("novafilm passe la durée film au moteur (écran + repli) et le plafond dur au HLS", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain("FILM_DURATION_FALLBACK_SEC = 6600");
    expect(src).toContain("fallbackDurationSec: FILM_DURATION_FALLBACK_SEC");
    // plafond dur HLS (un téléchargement ne tue jamais le bot)
    expect(src).toContain("downloadHlsAppLevel(v.url, localPath, v.headers, 600000, undefined, filmMaxMB() * 1024 * 1024)");
    // repli miroir : mêmes gardes que le chemin principal
    expect(src).toContain("(altVariant.estimatedSizeMB || 0) > filmMaxMB()");
    expect(src).toContain("altVariant.estimatedSizeMB && wouldExceedTempQuota");
  });

  it("hlsDownloader : cap maxTotalBytes câblé dans le pool de segments", () => {
    const src = fs.readFileSync("src/bot/services/hlsDownloader.ts", "utf-8");
    expect(src).toContain("maxTotalBytes?: number");
    expect(src).toContain("if (maxTotalBytes && downloadedBytes > maxTotalBytes)");
    expect(src).toContain("Byte cap exceeded");
  });

  it("commandDispatch : .img en préfixe routé vers l'outil interne (test dédié commandDispatchImg)", () => {
    const src = fs.readFileSync("src/bot/commandDispatch.ts", "utf-8");
    expect(src).toContain('commandName === "img"');
    expect(src).toContain("dispatchInternalImageTool");
  });

  it("connaissance : img = décision execute, JAMAIS la commande en texte (terrain 31/10 23:59)", async () => {
    const { buildCommandKnowledge } = await import("../src/bot/commandKnowledge.js");
    const k = buildCommandKnowledge(".");
    expect(k).toContain("décision execute");
    expect(k).toContain("JAMAIS la commande en texte");
    expect(k.length).toBeLessThan(4500);
  });
});

describe("9.18wwww — commande .novafilm (registre + source)", () => {
  it("enregistrée avec ses alias (f, film, films)", async () => {
    await initRegistry();
    const cmd = getCommand("novafilm");
    expect(cmd).toBeDefined();
    expect([...(cmd!.aliases || [])].sort()).toEqual(["f", "film", "films"].sort());
    // Le compteur exact appartient a commandInventory (egalite stricte).
  });

  it("écran qualité : 480/360 en priorité, langue commutée par .f vostfr", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain("480p/360p rapides en priorité");
    expect(src).toContain('firstArg === "vf" || firstArg === "vostfr"');
    expect(src).toContain("variantSortOrder");
  });

  it("livraison éprouvée : 60 Mo vidéo / 100 Mo document / sinon lien + slim", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain("fileSizeMB <= 60");
    expect(src).toContain("fileSizeMB <= 100");
    expect(src).toContain("TEMPORARY HIGH-SPEED DOWNLOAD LINK");
    expect(src).toContain("registerSlimOffer");
    expect(src).toContain("slimOfferLine");
  });

  it("les relais players sont résolus en parallèle avant le moteur + garde anti-relais", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain("resolveFilmPlayerUrl(u)");
    expect(src).toContain("isFilmRelayUrl(best.url)");
  });

  it("gardes : plafond taille, quota temporaire, SSRF, série refusée honnêtement", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).toContain("NEBULA_FILM_MAX_MB || 5000");
    expect(src).toContain("wouldExceedTempQuota");
    expect(src).toContain("isSafeDownloadUrl");
    expect(src).toContain("Séries pas encore supportées par Novafilm");
  });

  it("la source n'est JAMAIS nommée à l'utilisateur (règle 8.42)", () => {
    const src = fs.readFileSync("src/bot/commands/novafilm.ts", "utf-8");
    expect(src).not.toContain("french-stream");
    expect(src).not.toContain("French-Stream");
  });

  it("la connaissance IA route le film vers .f (règles agent ET guide)", async () => {
    const { buildAgentKnowledge } = await import("../src/bot/commandKnowledge.js");
    const k = buildAgentKnowledge(".");
    expect(k).toContain("« le film X » → ${p}f".replace("${p}", "."));
    expect(k).toContain("Novabox/Novafilm");
    const guide = fs.readFileSync("src/bot/commandKnowledge.ts", "utf-8");
    expect(guide).toContain("« télécharge le film X »");
  });
});
