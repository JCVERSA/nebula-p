import { describe, it, expect } from "vitest";
import {
  organizeVfSelection,
  parseVoiranimeSearch,
  parseVoiranimeEpisodes,
  parseVoiranimePlayer,
  resolveVoiranimeSeason,
  isVoiranimeVfSlug
} from "../src/bot/services/voiranimeClient.js";

const SEARCH_HTML = `
<div class="page-item-detail">
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/" title="Sparks of Tomorrow (VF)"><img></a>
  <h3><a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/">Sparks of Tomorrow (VF)</a></h3>
</div>
<div class="page-item-detail">
  <h3><a href="https://voir-anime.to/anime/sparks-of-tomorrow/">Sparks of Tomorrow</a></h3>
</div>
<div class="page-item-detail">
  <h3><a href="https://voir-anime.to/anime/mushoku-tensei-3-vf/">Mushoku Tensei 3 (VF)</a></h3>
</div>
<nav><a href="https://voir-anime.to/anime-genre/action/" title="Action">Action</a></nav>`;

describe("parseVoiranimeSearch", () => {
  it("extracts entries, dedupes, skips genre links and flags VF structurally", () => {
    const out = parseVoiranimeSearch(SEARCH_HTML);
    expect(out.length).toBe(3);
    const slugs = out.map((r) => r.slug);
    expect(slugs).toContain("sparks-of-tomorrow-vf");
    expect(slugs).toContain("sparks-of-tomorrow");
    expect(out.find((r) => r.slug === "sparks-of-tomorrow-vf")!.isVf).toBe(true);
    expect(out.find((r) => r.slug === "sparks-of-tomorrow")!.isVf).toBe(false);
    expect(out.find((r) => r.slug === "sparks-of-tomorrow-vf")!.title).toBe("Sparks of Tomorrow");
    expect(slugs).not.toContain("anime-genre");
  });
  it("handles empty html", () => {
    expect(parseVoiranimeSearch("")).toEqual([]);
  });
});

describe("isVoiranimeVfSlug", () => {
  it("matches -vf slugs and urls", () => {
    expect(isVoiranimeVfSlug("one-piece-vf")).toBe(true);
    expect(isVoiranimeVfSlug("https://voir-anime.to/anime/one-piece-vf/")).toBe(true);
    expect(isVoiranimeVfSlug("one-piece")).toBe(false);
  });
});

const ANIME_URL = "https://voir-anime.to/anime/sparks-of-tomorrow-vf/";
const EPISODES_HTML = `
<div class="listing">
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-09-vf/">EP 09</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-01-vf/">EP 01</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/sparks-of-tomorrow-05-vf/">EP 05</a>
  <a href="https://voir-anime.to/anime/sparks-of-tomorrow-vf/film-vf-sparks/">FILM</a>
  <a href="https://voir-anime.to/anime/other-anime/other-01-vf/">OTHER</a>
</div>`;

describe("parseVoiranimeEpisodes", () => {
  it("lists numbered episodes of the entry in ascending order and ignores other entries", () => {
    const out = parseVoiranimeEpisodes(EPISODES_HTML, ANIME_URL);
    expect(out.map((e) => e.n)).toEqual([0, 1, 5, 9]);
    expect(out.filter((e) => e.n > 0).map((e) => e.n)).toEqual([1, 5, 9]);
    expect(out.every((e) => e.url.startsWith(ANIME_URL))).toBe(true);
  });
});

describe("parseVoiranimePlayer", () => {
  it("finds the voembed iframe", () => {
    const html = `<html><body><iframe src="https://voembed.net/embed-miu8i0n5yyms.html" allowfullscreen></iframe></body></html>`;
    expect(parseVoiranimePlayer(html)).toBe("https://voembed.net/embed-miu8i0n5yyms.html");
  });
  it("falls back to a regex match and returns null otherwise", () => {
    const html = `<script>var u="https://voembed.net/embed-abc123.html";</script>`;
    expect(parseVoiranimePlayer(html)).toBe("https://voembed.net/embed-abc123.html");
    expect(parseVoiranimePlayer("<html><body>hi</body></html>")).toBeNull();
    expect(parseVoiranimePlayer("")).toBeNull();
  });
});

describe("resolveVoiranimeSeason", () => {
  const entries = [
    { title: "Code Geass: Lelouch of the Rebellion", url: "u1", slug: "code-geass-hangyaku-no-lelouch-vf", isVf: true },
    { title: "Code Geass: Lelouch of the Rebellion R2", url: "u2", slug: "code-geass-r2-vf", isVf: true },
    { title: "Code Geass: Rozé of the Recapture", url: "u3", slug: "code-geass-roze-vf", isVf: true }
  ];
  it("matches season 2 to the R2 entry", () => {
    expect(resolveVoiranimeSeason(entries, 2)?.slug).toBe("code-geass-r2-vf");
  });
  it("falls back to the first VF entry for season 1", () => {
    expect(resolveVoiranimeSeason(entries, 1)?.slug).toBe("code-geass-hangyaku-no-lelouch-vf");
  });
  it("returns null when nothing matches a higher season", () => {
    expect(resolveVoiranimeSeason(entries, 5)).toBeNull();
    expect(resolveVoiranimeSeason([], 1)).toBeNull();
  });
});

// ── 9.9 : organisation VF de l'écran de sélection ──────────────────────────
describe("organizeVfSelection (9.9)", () => {
  // Entrées réelles du transcript owner (recherche "demon slayer" sur voir-anime)
  const KIMETSU = [
    { title: "Kimetsu no Yaiba: Mugenjou-hen Movie 1 – Akaza Sairai", url: "u1", slug: "kimetsu-no-yaiba-mugenjou-hen-movie-1-akaza-sairai-vf", isVf: true },
    { title: "Kimetsu no Yaiba 4", url: "u2", slug: "kimetsu-no-yaiba-4-vf", isVf: true },
    { title: "Kimetsu no Yaiba 3", url: "u3", slug: "kimetsu-no-yaiba-3-vf", isVf: true },
    { title: "Kimetsu no Yaiba 2", url: "u4", slug: "kimetsu-no-yaiba-2-vf", isVf: true },
    { title: "Kimetsu no Yaiba: Mugen Ressha-hen", url: "u5", slug: "kimetsu-no-yaiba-mugen-ressha-hen-vf", isVf: true },
  ];

  it("regroupe par anime, saisons croissantes puis films nommés (transcript réel)", () => {
    const out = organizeVfSelection(KIMETSU);
    expect(out.map((o) => o.label)).toEqual([
      // film SANS marqueur structurel : titre complet, on n'invente pas « Saison 1 »
      "Kimetsu no Yaiba: Mugen Ressha-hen",
      "Kimetsu no Yaiba — Saison 2",
      "Kimetsu no Yaiba — Saison 3",
      "Kimetsu no Yaiba — Saison 4",
      "Kimetsu no Yaiba — Film : Mugenjou-hen Movie 1 – Akaza Sairai",
    ]);
  });

  it("R2 = saison 2 ; slug -N reconnu ; sans marqueur NI sous-titre = Saison 1", () => {
    const out = organizeVfSelection([
      { title: "Code Geass: Lelouch of the Rebellion R2", url: "u2", slug: "code-geass-r2-vf", isVf: true },
      { title: "Code Geass: Lelouch of the Rebellion", url: "u1", slug: "code-geass-hangyaku-no-lelouch-vf", isVf: true },
      { title: "Mushoku Tensei", url: "u3", slug: "mushoku-tensei-3-vf", isVf: true },
      { title: "Sparks of Tomorrow", url: "u4", slug: "sparks-of-tomorrow-vf", isVf: true },
    ]);
    expect(out.map((o) => `${o.label}|${o.season}`)).toEqual([
      // préfixe « : » partagé → même groupe, ordre d'apparition du groupe
      "Code Geass: Lelouch of the Rebellion|1",
      "Code Geass: Lelouch of the Rebellion — Saison 2|2",
      "Mushoku Tensei — Saison 3|3",
      "Sparks of Tomorrow — Saison 1|1",
    ]);
  });

  it("le résultat porte TOUJOURS l'entrée d'origine (mapping .a N intact)", () => {
    const out = organizeVfSelection(KIMETSU);
    expect(out.every((o) => KIMETSU.includes(o.result))).toBe(true);
    expect(out.length).toBe(KIMETSU.length);
  });
});

describe("wiring 9.9 (novabox + guidage agent)", () => {
  const readSrc = (rel: string) => require("fs").readFileSync(rel, "utf-8");

  it("9.18rrr : VOSTFR explicite → le catalogue par défaut (voir-anime), as reste explicite", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    // Owner 18/10 : la VOSTFR suit le défaut (voir-anime) — l'ancien détour
    // 9.9 par l'autre catalogue est retiré.
    expect(src).toContain("quickParams.source || effectiveDefaultSource()");
    expect(src).not.toContain('quickParams.language === "VOSTFR" ? "as"');
    // L'écran VOSTFR filtré et son message honnête sont branchés (2 flux).
    expect(src).toContain('organizeVfScreen(searchResults, { explicitVostfr: true })');
    expect(src).toContain("resolveVostfrRequest("); // 9.18sss : bascule auto
  });

  it("les DEUX écrans de sélection organisent le VF par défaut", () => {
    const src = readSrc("src/bot/commands/novabox.ts");
    const uses = src.split("organizeVfScreen(searchResults)").length - 1;
    expect(uses).toBeGreaterThanOrEqual(2); // flux quick + flux standard
  });

  it("la fiche agent .a documente le routing — SANS nommer la source (8.42)", () => {
    const src = readSrc("src/bot/commandKnowledge.ts");
    expect(src).toContain("VF d'abord"); // écran mixte 9.18ooo
    expect(src).toContain("écran VOSTFR seul"); // 9.18rrr
    expect(src).toContain("vostfr");
    expect(src).not.toContain("anime-sama"); // règle 8.42 : jamais de source privée nommée
  });
});
