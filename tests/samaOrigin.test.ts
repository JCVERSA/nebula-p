import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
import axios from "axios";
import {
  ensureSamaOrigin,
  normalizeSamaOrigin,
  parseLauncherOrigin,
  samaOrigin,
  samaTrustedHosts,
  __resetSamaOriginForTests,
  __setSamaOriginForTests
} from "../src/bot/services/samaOrigin.js";

/**
 * 9.19h — origine DYNAMIQUE d'anime-sama.
 *
 * Terrain 01/11 : anime-sama.to renvoie 404 (déménagement habituel du site)
 * et Cloudflare bloque les IP datacenter (« you have been blocked »).
 * Technique des scrapers à jour (better-ani-scraped) : la page lanceur
 * anime-sama.pw porte un bouton vers le domaine COURANT. Le bot résout via
 * elle (cache 24 h, single-flight, repli .to) et plus AUCUNE URL anime-sama
 * n'est codée en dur hors ce module.
 */

const mGet = vi.mocked(axios.get);
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const LAUNCHER_HTML = (href: string) =>
  `<html><body><a class="btn-primary" href="${href}">Entrer</a></body></html>`;

beforeEach(() => {
  vi.clearAllMocks();
  __resetSamaOriginForTests();
  delete process.env.NEBULA_SAMA_ORIGIN;
});

afterEach(() => {
  __resetSamaOriginForTests();
  delete process.env.NEBULA_SAMA_ORIGIN;
});

describe("9.19h — normalizeSamaOrigin / parseLauncherOrigin (purs)", () => {
  it("normalise protocole + hôte, sans slash final", () => {
    expect(normalizeSamaOrigin("https://anime-sama.si/")).toBe("https://anime-sama.si");
    expect(normalizeSamaOrigin("http://example.com/path/deep")).toBe("http://example.com");
    expect(normalizeSamaOrigin("ftp://example.com")).toBeNull();
    expect(normalizeSamaOrigin("n'importe quoi")).toBeNull();
    expect(normalizeSamaOrigin("")).toBeNull();
  });

  it("extrait l'origine du bouton lanceur (href relatif ou absolu)", () => {
    expect(parseLauncherOrigin(LAUNCHER_HTML("https://anime-sama.fr"), "https://anime-sama.pw")).toBe("https://anime-sama.fr");
    expect(parseLauncherOrigin(LAUNCHER_HTML("/go/site"), "https://anime-sama.pw")).toBe("https://anime-sama.pw");
  });

  it("pas de bouton, page vide ou HTML cassé → null", () => {
    expect(parseLauncherOrigin("<html>Pas de bouton</html>", "https://anime-sama.pw")).toBeNull();
    expect(parseLauncherOrigin("", "https://anime-sama.pw")).toBeNull();
    expect(parseLauncherOrigin(LAUNCHER_HTML("https://[::invalide"), "https://anime-sama.pw")).toBeNull(); // URL malformée
  });
});

describe("9.19h — samaOrigin : override owner > cache > repli", () => {
  it("repli historique quand rien n'est résolu", () => {
    expect(samaOrigin()).toBe("https://anime-sama.to");
  });

  it("NEBULA_SAMA_ORIGIN fige l'origine (court-circuit total)", () => {
    process.env.NEBULA_SAMA_ORIGIN = "https://anime-sama.si/";
    expect(samaOrigin()).toBe("https://anime-sama.si");
    expect(samaTrustedHosts()).toContain("anime-sama.si");
  });

  it("le domaine résolu est servi et entre dans les hôtes de confiance", () => {
    __setSamaOriginForTests("https://anime-sama.fr");
    expect(samaOrigin()).toBe("https://anime-sama.fr");
    const hosts = samaTrustedHosts();
    expect(hosts).toContain("anime-sama.fr");
    expect(hosts).toContain("anime-sama.to"); // le repli reste confiance (vieux liens)
  });
});

describe("9.19h — ensureSamaOrigin : résolution via le lanceur, jamais d'échec", () => {
  it("lanceur OK → bouton suivi jusqu'au domaine final, mis en cache", async () => {
    mGet.mockResolvedValueOnce({ data: LAUNCHER_HTML("https://anime-sama.si") } as any)
      .mockResolvedValueOnce({ request: { res: { responseUrl: "https://anime-sama.fr/catalogue/" } }, data: { destroy: vi.fn() } } as any);
    expect(await ensureSamaOrigin()).toBe("https://anime-sama.fr"); // la redirection finale gagne
    expect(samaOrigin()).toBe("https://anime-sama.fr");
    expect(mGet).toHaveBeenCalledTimes(2);
  });

  it("échec du suivi de redirection → le bouton suffit", async () => {
    mGet.mockResolvedValueOnce({ data: LAUNCHER_HTML("https://anime-sama.si") } as any)
      .mockRejectedValueOnce(new Error("network") as any);
    expect(await ensureSamaOrigin()).toBe("https://anime-sama.si");
  });

  it("lanceur muet (403/timeout/vide) → repli sans JETER (jamais d'échec visible)", async () => {
    mGet.mockRejectedValue(new Error("getaddrinfo ENOTFOUND anime-sama.pw") as any);
    expect(await ensureSamaOrigin()).toBe("https://anime-sama.to");
    mGet.mockResolvedValue({ status: 403, data: "Sorry, you have been blocked" } as any);
    __resetSamaOriginForTests();
    expect(await ensureSamaOrigin()).toBe("https://anime-sama.to");
  });

  it("single-flight + cache : N appels → 2 requêtes réseau maximum", async () => {
    mGet.mockResolvedValueOnce({ data: LAUNCHER_HTML("https://anime-sama.si") } as any)
      .mockResolvedValueOnce({ request: { res: { responseUrl: "https://anime-sama.si" } }, data: { destroy: vi.fn() } } as any);
    const results = await Promise.all([ensureSamaOrigin(), ensureSamaOrigin(), ensureSamaOrigin()]);
    expect(new Set(results).size).toBe(1);
    await ensureSamaOrigin(); // cache
    expect(mGet).toHaveBeenCalledTimes(2);
  });
});

describe("9.19h — câblage : plus aucune URL anime-sama codée en dur", () => {
  it("seul samaOrigin.ts contient le domaine littéral (repli)", () => {
    const files = [
      "src/bot/services/animeSources.ts",
      "src/bot/commands/novabox.ts",
      "src/bot/services/animeStreamExtractor.ts",
      "src/bot/services/hlsDownloader.ts",
      "src/bot/urlSafety.ts"
    ];
    for (const f of files) {
      expect(read(f)).not.toContain('"https://anime-sama');
    }
    expect(read("src/bot/services/samaOrigin.ts")).toContain("https://anime-sama.to"); // le repli vit ICI
  });

  it("la recherche utilise le domaine résolu ; referers et allowlist sont dynamiques", () => {
    expect(read("src/bot/services/animeSources.ts")).toContain("await ensureSamaOrigin()");
    expect(read("src/bot/services/animeSources.ts")).toContain("${samaBase}/template-php/defaut/fetch.php");
    expect(read("src/bot/commands/novabox.ts")).toContain("`${samaOrigin()}/`");
    expect(read("src/bot/services/hlsDownloader.ts")).toContain("`${samaOrigin()}/`");
    expect(read("src/bot/services/animeStreamExtractor.ts")).toContain("await ensureSamaOrigin()");
    expect(read("src/bot/urlSafety.ts")).toContain("...samaTrustedHosts()");
    expect(read(".env.example")).toContain("NEBULA_SAMA_ORIGIN");
  });
});
