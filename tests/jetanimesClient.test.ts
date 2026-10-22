import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../src/bot/services/jetanimesClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/services/jetanimesClient.js")>();
  return { ...actual, jetanimesEpisodePlayers: vi.fn(async () => [] as string[]) };
});
vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import {
  jetanimesOrigins,
  swapJetanimesOrigin,
  parseJetanimesSearch,
  parseJetanimesSeries,
  languageFromRestClasses,
  parseJetanimesPlayerOptions,
  parseJetanimesDirectPlayers,
  resolveDooPlayerAjax,
  jetanimesEpisodePlayers
} from "../src/bot/services/jetanimesClient.js";
import { otherFlagOf, sourceLogLabel, searchAnimeBySource, searchEmptyMessage } from "../src/bot/services/animeSources.js";
import { parseQuickDownloadParams } from "../src/bot/utils/quickAnimeParser.js";
import { buildAgentKnowledge } from "../src/bot/commandKnowledge.js";

const mockedPlayers = vi.mocked(jetanimesEpisodePlayers);

// --------------------------------------------------------------------- fixtures

const SEARCH_HTML = `
<div class="result-item">
  <article>
    <a href="https://on.jetanimes.com/serie/dark-machine-the-animation/" title="Dark Machine The Animation"><img alt="Dark Machine The Animation"></a>
  </article>
</div>
<div class="result-item">
  <article>
    <a href="https://on.jetanimes.com/serie/mushoku-tensei-jobless-reincarnation/"><img alt="Mushoku Tensei: Jobless Reincarnation"></a>
  </article>
</div>
<div class="result-item">
  <article>
    <a href="https://on.jetanimes.com/film/your-letter/"><img alt="Your Letter"></a>
  </article>
</div>
<div class="result-item">
  <article>
    <a href="https://on.jetanimes.com/serie/dark-machine-the-animation/"><img alt="Dark Machine The Animation (duplicate)"></a>
  </article>
</div>
<nav><a href="https://on.jetanimes.com/anime-genre/action/" title="Action">Action</a></nav>
<nav><a href="https://on.jetanimes.com/?s=dark&amp;page=2">2</a></nav>`;

const SERIES_HTML = `
<div id="seasons">
  <div class="se-c">
    <div class="se-q"><span class="se-t">1</span></div>
    <ul class="episodios">
      <li><a href="https://on.jetanimes.com/episodes/dark-machine-the-animation-saison-1-episode-1/"><img alt="ep 1"></a><span class="quality">HD VOSTFR</span></li>
      <li><a href="/episodes/dark-machine-the-animation-saison-1-episode-2/"><img alt="ep 2"></a></li>
      <li><a href="https://www.hdsanime.com/episodes/dark-machine-the-animation-saison-1-episode-10/"><img alt="ep 10"></a></li>
    </ul>
  </div>
  <div class="se-c">
    <div class="se-q"><span class="se-t">2</span></div>
    <ul class="episodios">
      <li><a href="https://on.jetanimes.com/episodes/dark-machine-the-animation-saison-2-episode-1/"><img alt="s2 ep 1"></a><span class="quality">HD VOSTFR</span></li>
    </ul>
  </div>
</div>
<a href="https://on.jetanimes.com/episodes/dark-machine-the-animation-saison-1-episode-1/">duplicate ignored</a>`;

const SERIES_MIXED_HTML = `
<ul class="episodios">
  <li><a href="https://on.jetanimes.com/episodes/big-show-saison-1-episode-1/"><img alt="ep 1"></a><span class="quality">HD VF</span></li>
  <li><a href="https://on.jetanimes.com/episodes/big-show-saison-1-episode-2/"><img alt="ep 2"></a><span class="quality">HD VOSTFR</span></li>
</ul>`;

const EPISODE_HTML = `
<ul class="playeroptions">
  <li class="dooplay_player_option" data-post="98615" data-nume="1">PLAYER 1</li>
  <li class="dooplay_player_option" data-post="98615" data-nume="2">PLAYER 2</li>
  <li class="dooplay_player_option" data-post="abc" data-nume="3">BAD</li>
</ul>
<iframe src="https://secured.lol/ads/frame.html"></iframe>
<iframe src="https://vidmoly.to/embed-darkmachine.html"></iframe>
<!-- https://uqload.net/embed-abc123.html -->
<iframe src="https://on.jetanimes.com/wp-content/player.html"></iframe>`;

// --------------------------------------------------------------------- origins

describe("jetanimesOrigins", () => {
  beforeEach(() => {
    delete process.env.NEBULA_JETANIMES_URL;
  });
  it("defaults to the two twin domains, primary first", () => {
    const origins = jetanimesOrigins();
    expect(origins[0]).toBe("https://on.jetanimes.com");
    expect(origins).toContain("https://www.hdsanime.com");
    expect(origins.length).toBe(2);
  });
  it("NEBULA_JETANIMES_URL overrides the first origin, twins stay as fallbacks", () => {
    process.env.NEBULA_JETANIMES_URL = "https://mirror.example.com/";
    const origins = jetanimesOrigins();
    expect(origins[0]).toBe("https://mirror.example.com");
    expect(origins[1]).toBe("https://on.jetanimes.com");
    expect(origins.length).toBe(3);
    delete process.env.NEBULA_JETANIMES_URL;
  });
  it("swapJetanimesOrigin rewrites the origin and keeps the path", () => {
    expect(swapJetanimesOrigin("https://on.jetanimes.com/episodes/x-saison-1-episode-1/", "https://www.hdsanime.com")).toBe(
      "https://www.hdsanime.com/episodes/x-saison-1-episode-1/"
    );
    expect(swapJetanimesOrigin("not a url", "https://www.hdsanime.com")).toBe("not a url");
  });
});

// ---------------------------------------------------------------------- search

describe("parseJetanimesSearch", () => {
  it("extracts serie and film entries, dedupes, skips genre/pagination links", () => {
    const out = parseJetanimesSearch(SEARCH_HTML);
    expect(out.length).toBe(3);
    expect(out[0].slug).toBe("dark-machine-the-animation");
    expect(out[0].title).toBe("Dark Machine The Animation");
    expect(out[0].url).toBe("https://on.jetanimes.com/serie/dark-machine-the-animation/");
    expect(out[0].isFilm).toBe(false);
    const film = out.find((r) => r.slug === "your-letter");
    expect(film?.isFilm).toBe(true);
    expect(film?.url).toContain("/film/your-letter/");
    expect(out.some((r) => r.slug.includes("anime-genre"))).toBe(false);
  });
  it("handles empty html", () => {
    expect(parseJetanimesSearch("")).toEqual([]);
    expect(parseJetanimesSearch("<html></html>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------- series

describe("parseJetanimesSeries", () => {
  it("groups episodes by season, sorts them, dedupes, accepts relative + twin-domain hrefs", () => {
    const seasons = parseJetanimesSeries(SERIES_HTML);
    expect(seasons.length).toBe(2);
    expect(seasons[0].seasonNumber).toBe(1);
    expect(seasons[0].episodes.map((e) => e.n)).toEqual([1, 2, 10]);
    expect(seasons[0].episodes[0].url).toBe("https://on.jetanimes.com/episodes/dark-machine-the-animation-saison-1-episode-1/");
    // relative href -> origin par défaut
    expect(seasons[0].episodes[1].url).toBe("https://on.jetanimes.com/episodes/dark-machine-the-animation-saison-1-episode-2/");
    // domaine jumeau -> conservé tel quel
    expect(seasons[0].episodes[2].url).toContain("www.hdsanime.com");
    expect(seasons[1].seasonNumber).toBe(2);
  });
  it("reads the season language from episode badges", () => {
    const seasons = parseJetanimesSeries(SERIES_HTML);
    expect(seasons[0].language).toBe("VOSTFR");
    expect(seasons[0].mixed).toBe(false);
  });
  it("a season mixing VF and VOSTFR badges is flagged mixed with null language", () => {
    const seasons = parseJetanimesSeries(SERIES_MIXED_HTML);
    expect(seasons.length).toBe(1);
    expect(seasons[0].mixed).toBe(true);
    expect(seasons[0].language).toBeNull();
  });
  it("handles empty html", () => {
    expect(parseJetanimesSeries("")).toEqual([]);
  });
});

// -------------------------------------------------------------------- language

describe("languageFromRestClasses", () => {
  it("reads the dtquality taxonomy from the WP REST class_list", () => {
    expect(languageFromRestClasses(["post-98615", "episodes", "dtquality--hd-vostfr"])).toBe("VOSTFR");
    expect(languageFromRestClasses(["post-1", "dtquality--hd-vf"])).toBe("VF");
    expect(languageFromRestClasses(["post-2", "type-episodes"])).toBeNull();
    expect(languageFromRestClasses("dtquality--hd-vostfr")).toBe("VOSTFR");
    expect(languageFromRestClasses(undefined)).toBeNull();
  });
});

// --------------------------------------------------------------------- players

describe("parseJetanimesPlayerOptions + parseJetanimesDirectPlayers", () => {
  it("extracts DooPlay options (data-post/data-nume) and drops invalid ones", () => {
    const options = parseJetanimesPlayerOptions(EPISODE_HTML);
    expect(options.length).toBe(2);
    expect(options[0]).toEqual({ post: "98615", nume: "1" });
    expect(options[1]).toEqual({ post: "98615", nume: "2" });
  });
  it("direct players: keeps embed iframes and embed-*.html URLs, excludes ads and the site itself", () => {
    const urls = parseJetanimesDirectPlayers(EPISODE_HTML);
    expect(urls).toContain("https://vidmoly.to/embed-darkmachine.html");
    expect(urls).toContain("https://uqload.net/embed-abc123.html");
    expect(urls.some((u) => u.includes("secured.lol"))).toBe(false);
    expect(urls.some((u) => u.includes("jetanimes.com"))).toBe(false);
  });
  it("handles empty html", () => {
    expect(parseJetanimesPlayerOptions("")).toEqual([]);
    expect(parseJetanimesDirectPlayers("")).toEqual([]);
  });
});

describe("resolveDooPlayerAjax", () => {
  const EP_URL = "https://on.jetanimes.com/episodes/x-saison-1-episode-1/";
  it("parses {embed_url} responses and posts the standard DooPlay action", async () => {
    const axios = (await import("axios")).default as any;
    const post = axios.post as ReturnType<typeof vi.fn>;
    post.mockReset();
    post.mockResolvedValueOnce({ data: { embed_url: "https://vidmoly.to/embed-x.html" } });
    const url = await resolveDooPlayerAjax(EP_URL, { post: "42", nume: "1" });
    expect(url).toBe("https://vidmoly.to/embed-x.html");
    expect(post.mock.calls[0][0]).toBe("https://on.jetanimes.com/wp-admin/admin-ajax.php");
    const body = post.mock.calls[0][1] as URLSearchParams;
    expect(body.get("action")).toBe("doo_player");
    expect(body.get("post")).toBe("42");
    expect(body.get("nume")).toBe("1");
  });
  it("falls through action names until one answers, extracts raw URLs from string bodies, rejects ad hosts", async () => {
    const axios = (await import("axios")).default as any;
    const post = axios.post as ReturnType<typeof vi.fn>;
    post.mockReset();
    post.mockResolvedValueOnce({ data: "0" }); // action inconnue -> "0"
    post.mockResolvedValueOnce({ data: '{"embed_url":"https://uqload.net/embed-y.html"}' }); // dt_player répond
    let url = await resolveDooPlayerAjax(EP_URL, { post: "42", nume: "2" });
    expect(url).toBe("https://uqload.net/embed-y.html");
    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[1][1] as URLSearchParams).get("action")).toBe("dt_player");
    // Une régie publicitaire n'est JAMAIS un lecteur.
    post.mockReset();
    post.mockResolvedValue({ data: { embed_url: "https://secured.lol/whatever" } });
    url = await resolveDooPlayerAjax(EP_URL, { post: "42", nume: "3" });
    expect(url).toBeNull();
  });
  it("returns null on invalid episode URL (no throw)", async () => {
    await expect(resolveDooPlayerAjax("not-a-url", { post: "1", nume: "1" })).resolves.toBeNull();
  });
});

// -------------------------------------------------------------------- plumbing

describe("jetanimes catalog plumbing (animeSources + quickAnimeParser)", () => {
  it("quickAnimeParser accepts jt + aliases jeta/jetanime as first token", () => {
    expect(parseQuickDownloadParams(["jt", "solo", "leveling"]).source).toBe("jt");
    expect(parseQuickDownloadParams(["jeta", "solo"]).source).toBe("jt");
    expect(parseQuickDownloadParams(["JETANIME=", "jjk"]).source).toBe("jt");
    expect(parseQuickDownloadParams(["jt"]).source).toBeUndefined();
    expect(parseQuickDownloadParams(["the", "jt", "gods"]).source).toBeUndefined();
  });
  it("otherFlagOf keeps the pinned as/va pair and guides jt to va", () => {
    expect(otherFlagOf("as")).toBe("va");
    expect(otherFlagOf("va")).toBe("as");
    expect(otherFlagOf("jt")).toBe("va");
  });
  it("sourceLogLabel names jetanimes for owner diagnostics", () => {
    expect(sourceLogLabel("jt")).toBe("jetanimes");
    expect(sourceLogLabel("va")).toBe("voir-anime");
    expect(sourceLogLabel("as")).toBe("anime-sama");
  });
  it("NEBULA_JETANIMES_DISABLED=1 throws the operator kill-switch code (no network)", async () => {
    process.env.NEBULA_JETANIMES_DISABLED = "1";
    try {
      await expect(searchAnimeBySource("whatever", "jt")).rejects.toThrow("NEBULA_JT_DISABLED");
    } finally {
      delete process.env.NEBULA_JETANIMES_DISABLED;
    }
  });
  it("searchEmptyMessage mentions the other flag for jt", () => {
    expect(searchEmptyMessage("zzz", "jt")).toContain("`.a va <titre>`");
  });
});

// ------------------------------------------------------------------ novabox pin

describe("jetanimes wiring in novabox (source pins)", () => {
  const novaboxSrc = fs.readFileSync(path.resolve(__dirname, "../src/bot/commands/novabox.ts"), "utf8");
  const menuSrc = fs.readFileSync(path.resolve(__dirname, "../src/bot/commands/menu.ts"), "utf8");

  it("wires jt seasons (wireSessionSeasons), episodes (isJetanimes branch) and lazy players (5a-bis + season zip)", () => {
    expect(novaboxSrc).toContain("} else if (session.source === \"jt\") {");
    expect(novaboxSrc).toContain("} else if (selectedSeason.isJetanimes) {");
    expect(novaboxSrc).toContain("jetanimesSeasonEpisodes(");
    expect(novaboxSrc).toContain("5a-bis. 9.18gggg");
    expect(novaboxSrc).toContain("fillJetanimesPlayers(session, [0])");
    expect(novaboxSrc).toContain("JT_DISABLED_CODE");
  });
  it("help texts document the jt flag (usage, alone-flag guide, menu, agent knowledge)", () => {
    expect(novaboxSrc).toContain("\\`.a jt [titre]\\`");
    expect(novaboxSrc).toContain("`.a jt <titre>`");
    expect(menuSrc).toContain("as, va ou jt");
    expect(buildAgentKnowledge(".")).toContain("a jt <titre>");
  });
});

// -------------------------------------------------------------- session wiring

describe("fillJetanimesPlayers", () => {
  beforeEach(() => {
    mockedPlayers.mockReset();
  });

  it("fills one mirror list per player slot and labels them with the season language", async () => {
    const { fillJetanimesPlayers } = await import("../src/bot/commands/novabox.js");
    mockedPlayers.mockResolvedValue(["https://vidmoly.to/embed-a.html", "https://voe.sx/e/b"]);
    const session: any = {
      source: "jt",
      selectedLanguage: "VOSTFR",
      jetanimesEpisodes: [
        { n: 1, url: "https://on.jetanimes.com/episodes/x-saison-1-episode-1/", label: "Épisode 1" },
        { n: 2, url: "https://on.jetanimes.com/episodes/x-saison-1-episode-2/", label: "Épisode 2" }
      ],
      episodes: { 1: ["", ""] }
    };
    await fillJetanimesPlayers(session, [0]);
    expect(session.episodes[1][0]).toContain("vidmoly");
    expect(session.episodes[2][0]).toContain("voe.sx");
    expect(session.episodes[1][1]).toBe("");
    expect(session.episodeListLabels[1]).toEqual({ host: "vidmoly.to", language: "VOSTFR" });
    expect(session.episodeListLabels[2].language).toBe("VOSTFR");
    expect(mockedPlayers).toHaveBeenCalledTimes(1);
  });

  it("single player keeps a single list; no player leaves lists untouched (no crash)", async () => {
    const { fillJetanimesPlayers } = await import("../src/bot/commands/novabox.js");
    mockedPlayers.mockResolvedValue(["https://uqload.net/embed-z.html"]);
    const session: any = {
      source: "jt",
      selectedLanguage: "VF",
      jetanimesEpisodes: [{ n: 1, url: "https://on.jetanimes.com/episodes/y-saison-1-episode-1/", label: "Épisode 1" }],
      episodes: { 1: [""] }
    };
    await fillJetanimesPlayers(session, [0]);
    expect(session.episodes[1][0]).toContain("uqload");
    expect(Object.keys(session.episodes)).toEqual(["1"]);
    expect(session.episodeListLabels[1].language).toBe("VF");

    mockedPlayers.mockResolvedValue([]);
    const empty: any = { source: "jt", jetanimesEpisodes: [{ n: 1, url: "u", label: "É1" }], episodes: { 1: [""] } };
    await fillJetanimesPlayers(empty, [0]);
    expect(empty.episodes[1][0]).toBe("");
    expect(empty.episodeListLabels).toEqual({});
  });

  it("returns early without jetanimesEpisodes (no crash)", async () => {
    const { fillJetanimesPlayers } = await import("../src/bot/commands/novabox.js");
    const session: any = { source: "jt", episodes: undefined };
    await expect(fillJetanimesPlayers(session, [0])).resolves.toBeUndefined();
    expect(mockedPlayers).not.toHaveBeenCalled();
  });
});
