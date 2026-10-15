/**
 * 9.18z — `.resume` (P5 du plan owner) : résumé IA d'une page web.
 * Partie pure : extraction/normalisation d'URL (args ou message cité).
 */
import { describe, it, expect } from "vitest";
import { extractFirstUrl, normalizeUrl } from "../src/bot/commands/resume.js";

describe("9.18z — extractFirstUrl", () => {
  it("première URL d'un texte, ponctuation finale retirée", () => {
    expect(extractFirstUrl("regarde https://exemple.com/article, tu vas voir.")).toBe("https://exemple.com/article");
    expect(extractFirstUrl("va sur https://a.io/x puis https://b.io/y")).toBe("https://a.io/x");
  });

  it("URL nue www. sans schéma", () => {
    expect(extractFirstUrl("lis www.exemple.com/page stp")).toBe("www.exemple.com/page");
  });

  it("pas d'URL → chaîne vide", () => {
    expect(extractFirstUrl("aucun lien ici")).toBe("");
    expect(extractFirstUrl("")).toBe("");
  });

  it("parenthèses et guillemets ne sont pas avalés", () => {
    expect(extractFirstUrl("(voir https://fr.wikipedia.org/wiki/Cameroun)")).toBe("https://fr.wikipedia.org/wiki/Cameroun");
  });
});

describe("9.18z — normalizeUrl", () => {
  it("ajoute https:// quand le schéma manque", () => {
    expect(normalizeUrl("www.exemple.com/page")).toBe("https://www.exemple.com/page");
  });

  it("URL valide inchangée (forme normale)", () => {
    expect(normalizeUrl("https://exemple.com/a?b=1")).toContain("https://exemple.com/a?b=1");
  });

  it("URL invalide ou schéma non web → null", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("pas une url")).toBeNull();
  });
});
