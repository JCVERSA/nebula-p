/**
 * 9.0 — outils web : .search / .fetch / .wiki.
 *
 * Tout ce qui touche le réseau est mocké ou contourné : parseurs purs
 * (fixtures HTML), quota sur dataDir temporaire, wiring par lecture
 * source (pattern établi du repo). AUCUN appel réseau dans les tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync } from "fs";

import {
  buildDDGUrl,
  extractRealUrl,
  parseDDGResults,
  buildTavilyRequest,
} from "../src/bot/services/webSearch.js";
import {
  decodeHtmlEntities,
  cleanForWhatsApp,
  htmlToText,
  capText,
  domainOf,
} from "../src/bot/services/webText.js";
import { parseSearchArgs } from "../src/bot/commands/search.js";
import { checkWebQuota, consumeWebQuota, getWebDailyLimit } from "../src/bot/webQuota.js";

const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");

describe("webText — purs (9.0)", () => {
  it("decodeHtmlEntities : nommées, numériques, hex, invalides", () => {
    expect(decodeHtmlEntities("&eacute;&egrave;&amp;&lt;&quot;")).toBe("éè&<\"");
    expect(decodeHtmlEntities("&#233;&#x41;")).toBe("éA");
    expect(decodeHtmlEntities("&inconnue;")).toBe("&inconnue;"); // inconnue préservée
    expect(decodeHtmlEntities("&#0;")).toBe(""); // hors plage ignorée
  });

  it("cleanForWhatsApp : balises de formatage neutralisées", () => {
    expect(cleanForWhatsApp("*gras* et _italique_")).toBe("gras et italique");
    expect(cleanForWhatsApp("~~barré~~")).toBe("barré");
  });

  it("htmlToText : script/style retirés, listes, entités, espaces", () => {
    const html = `<html><head><title>T</title><style>.a{}</style></head>
      <body><script>evil()</script>
      <h1>Titre</h1><p>Premier &amp; paragraphe</p>
      <ul><li>Un</li><li>Deux</li></ul><div>Fin<br>Ligne</div>
      <noscript>FUITLEAK</noscript></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Titre");
    expect(text).toContain("Premier & paragraphe");
    expect(text).toContain("• Un");
    expect(text).toContain("• Deux");
    expect(text).toContain("Fin\nLigne");
    expect(text).not.toContain("evil()");
    expect(text).not.toContain(".a{}");
    expect(text).not.toContain("FUITLEAK");
  });

  it("capText : coupe au dernier espace avec ellipse, sinon dur", () => {
    expect(capText("court", 50)).toBe("court");
    const long = "mot ".repeat(100).trim();
    const cut = capText(long, 50);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut.endsWith("…")).toBe(true);
    expect(capText("x".repeat(100), 30).length).toBe(31); // pas d'espace → coupe dure
  });

  it("domainOf : www retiré, invalide → vide", () => {
    expect(domainOf("https://www.example.com/a?b=1")).toBe("example.com");
    expect(domainOf("pas une url")).toBe("");
  });
});

describe("parseSearchArgs — flags de fraîcheur (9.0)", () => {
  it("extrait le flag et la requête", () => {
    expect(parseSearchArgs(["-w", "canon", "de", "la", "victoire"])).toEqual({
      query: "canon de la victoire",
      freshness: "week",
    });
    expect(parseSearchArgs(["-d", "loto"])).toEqual({ query: "loto", freshness: "day" });
    expect(parseSearchArgs(["-m", "x"])).toEqual({ query: "x", freshness: "month" });
    expect(parseSearchArgs(["-y", "x"])).toEqual({ query: "x", freshness: "year" });
    expect(parseSearchArgs(["-J", "x"])).toEqual({ query: "x", freshness: "day" }); // insensible à la casse
  });

  it("sans flag → pas de fraîcheur (toutes années)", () => {
    expect(parseSearchArgs(["histoire", "du", "cameroun"])).toEqual({
      query: "histoire du cameroun",
      freshness: undefined,
    });
  });

  it("seul le premier flag compte, les autres restent dans la requête", () => {
    expect(parseSearchArgs(["-w", "météo", "-d"])).toEqual({ query: "météo -d", freshness: "week" });
  });
});

describe("parseDDGResults — parseur DuckDuckGo (pur, fixture)", () => {
  const FIXTURE = `
  <div class="result results_links web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.journal.example%2Farticle-1&amp;rut=abc">Cameroun : les <b>actualit&eacute;s</b> du jour</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.journal.example%2Farticle-1">Toute l&#x27;actualit&eacute; *camerounaise* en continu.</a>
  </div>
  <div class="result result--ad">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=foo">Publicit&eacute; sponsoris&eacute;e</a>
    </h2>
  </div>
  <div class="result results_links web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.journal.example%2Farticle-1&amp;rut=def">Doublon du premier résultat</a>
    </h2>
  </div>
  <div class="result results_links web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://www.example.org/direct">Lien direct sans snippet</a>
    </h2>
  </div>`;

  it("parse titres/snippets, décode les redirections uddg, ignore les pubs et doublons", () => {
    const hits = parseDDGResults(FIXTURE);
    expect(hits.length).toBe(2);
    expect(hits[0].title).toBe("Cameroun : les actualités du jour");
    expect(hits[0].url).toBe("https://www.journal.example/article-1");
    expect(hits[0].domain).toBe("journal.example");
    expect(hits[0].snippet).toContain("actualité camerounaise"); // entités + * nettoyés
    expect(hits[0].snippet).not.toContain("*");
    expect(hits[1].title).toBe("Lien direct sans snippet");
    expect(hits[1].snippet).toBe("");
    expect(hits.some((h) => h.title.includes("Publicit"))).toBe(false);
  });

  it("plafonne le nombre de résultats", () => {
    const many = Array.from(
      { length: 10 },
      (_, i) =>
        `<a class="result__a" href="https://site${i}.com/x">Résultat ${i}</a>`,
    ).join("\n");
    expect(parseDDGResults(many, 6).length).toBe(6);
  });
});

describe("buildDDGUrl / extractRealUrl / buildTavilyRequest (purs)", () => {
  it("buildDDGUrl encode la requête et mappe la fraîcheur vers df=", () => {
    expect(buildDDGUrl("loto cameroun")).toBe("https://html.duckduckgo.com/html/?q=loto+cameroun");
    expect(buildDDGUrl("x", "week")).toContain("df=w");
    expect(buildDDGUrl("x", "day")).toContain("df=d");
    expect(buildDDGUrl("x", "month")).toContain("df=m");
    expect(buildDDGUrl("x", "year")).toContain("df=y");
    expect(buildDDGUrl("x")).not.toContain("df=");
  });

  it("extractRealUrl décode uddg, gère // et les hrefs directs", () => {
    expect(extractRealUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.com%2Fa&rut=1")).toBe("https://ex.com/a");
    expect(extractRealUrl("https://ex.com/direct")).toBe("https://ex.com/direct");
    expect(extractRealUrl("n'importe quoi")).toBe("n'importe quoi"); // entrée non-URL intacte
  });

  it("buildTavilyRequest : corps JSON correct, time_range seulement si fraîcheur", () => {
    const r = buildTavilyRequest("gce results", "day");
    expect(r.url).toBe("https://api.tavily.com/search");
    const body = JSON.parse(r.body);
    expect(body.query).toBe("gce results");
    expect(body.time_range).toBe("day");
    expect(body.include_answer).toBe(false);
    expect(JSON.parse(buildTavilyRequest("x").body).time_range).toBeUndefined();
  });
});

describe("webQuota — budget partagé (dataDir temporaire)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webquota-"));
    process.env.NEBULA_DATA_DIR = dir;
    process.env.NEBULA_WEB_DAILY_LIMIT = "3";
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.NEBULA_DATA_DIR;
    delete process.env.NEBULA_WEB_DAILY_LIMIT;
  });

  it("limite par utilisateur, épuisement, persistance", async () => {
    const sender = "237640143760@s.whatsapp.net";
    expect(checkWebQuota(sender)).toEqual({ allowed: true, remaining: 3, limit: 3 });
    consumeWebQuota(sender);
    consumeWebQuota(sender);
    expect(checkWebQuota(sender).remaining).toBe(1);
    consumeWebQuota(sender);
    expect(checkWebQuota(sender).allowed).toBe(false);
    // Un AUTRE utilisateur a son propre budget
    expect(checkWebQuota("autre@s.whatsapp.net").allowed).toBe(true);
    // Le fichier persiste (save débouncé 500 ms — redémarrage → budget conservé)
    await new Promise((r) => setTimeout(r, 650));
    const stored = JSON.parse(readFileSync(join(dir, "web_usage.json"), "utf-8"));
    expect(stored[sender].count).toBe(3);
  });

  it("getWebDailyLimit : défaut 20 sans env, bornes sûres", () => {
    delete process.env.NEBULA_WEB_DAILY_LIMIT;
    expect(getWebDailyLimit()).toBe(20);
    process.env.NEBULA_WEB_DAILY_LIMIT = "0"; // 0 = tout couper (famine impossible)
    expect(getWebDailyLimit()).toBe(0);
  });
});

describe("wiring 9.0 — commandes enregistrées et sures", () => {
  it("les trois commandes sont dans le registre statique", () => {
    const reg = read("../src/bot/commandRegistry.ts");
    for (const name of ["searchCommand", "fetchCommand", "wikiCommand"]) {
      expect(reg).toContain(name);
    }
  });

  it(".fetch passe par safeFetch (SSRF : localhost/IPs privées bloqués)", () => {
    const cmd = read("../src/bot/commands/fetch.ts");
    expect(cmd).toContain("safeFetch");
    expect(cmd).toContain("isReadableContentType");
  });

  it(".search et .wiki respectent le quota web (et le réseau passe par safeFetch)", () => {
    const search = read("../src/bot/commands/search.ts");
    expect(search).toContain("searchWeb"); // → safeFetch dans webSearch.ts
    expect(search).toContain("checkWebQuota");
    expect(search).toContain("consumeWebQuota");
    expect(read("../src/bot/services/webSearch.ts")).toContain("safeFetch");
    const wiki = read("../src/bot/commands/wiki.ts");
    expect(wiki).toContain("safeFetch");
    expect(wiki).toContain("checkWebQuota");
    expect(wiki).toContain("consumeWebQuota");
  });

  it("les commandes web restent LÉGÈRES pour l'agent (pas dans HEAVY_NAMES)", () => {
    const brain = read("../src/bot/services/agentBrain.ts");
    const heavy = brain.match(/HEAVY_NAMES[^;]*;/)?.[0] ?? "";
    for (const name of ["search", "fetch", "wiki"]) {
      expect(heavy).not.toContain(`"${name}"`);
    }
  });

  it("l'agent sait exécuter les recherches directement (guidance 9.0)", () => {
    const knowledge = read("../src/bot/commandKnowledge.ts");
    expect(knowledge).toContain("RECHERCHE D'INFO (9.0)");
    expect(knowledge).toContain("search");
    expect(knowledge).toContain("wiki");
    expect(knowledge).toContain("fetch");
  });

  it("la recherche avoue son moteur (transparence M11)", () => {
    const cmd = read("../src/bot/commands/search.ts");
    expect(cmd).toContain("la requête leur est transmise");
  });

  it("nebula env propose TAVILY_API_KEY et le budget web (le owner colle juste la clé)", () => {
    const manage = read("../manage.sh");
    expect(manage).toContain("TAVILY_API_KEY|");
    expect(manage).toContain("NEBULA_WEB_DAILY_LIMIT|");
  });
});
