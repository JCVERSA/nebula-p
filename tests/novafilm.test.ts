import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
