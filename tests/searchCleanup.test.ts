import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { cleanWebSnippet } from "../src/bot/services/webText.js";
import { searchResultVideoFollowUp } from "../src/bot/services/agentBrain.js";

/**
 * 9.19g — terrain 01/11 04:34-04:35 (groupe, Dark Neon) :
 * 1. « télécharge la vidéo de natori » → l'agent cherchait le lien via
 *    .search mais le tour s'arrêtait NET (sortie non interactive) : la
 *    vidéo n'était jamais téléchargée, 2 recherches d'affilée.
 * 2. Les résultats .search arrivaient avec du JSON brut, des templates
 *    {{#list}}, des titres markdown et des balises [VIDEO] tels quels.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("9.19g — cleanWebSnippet : le chat ne reçoit plus le bruit des pages", () => {
  it("JSON brut et séquences échappées éliminés", () => {
    const BS = String.fromCharCode(92);
    const Q = String.fromCharCode(34);
    const junk = "start making music?" + Q + "}]artist" + BS + "songs" + Q + ":[{" + Q + "type" + Q + ":song";
    const out = cleanWebSnippet(junk);
    expect(out).not.toContain("{");
    expect(out).not.toContain("}");
    expect(out).not.toContain(BS);
    expect(out).toContain("start making music?");
  });

  it("templates handlebars éliminés (résidu de ponctuation seule → vide)", () => {
    expect(cleanWebSnippet("{{#list}} {{#archiveflg}}- {{/archiveflg}} {{^archiveflg}}- {{/archiveflg}}")).toBe("");
  });

  it("titres markdown et balises crochets nettoyés", () => {
    expect(cleanWebSnippet("## Channel: なとり / natori (verified)")).toBe("Channel: なとり / natori (verified)");
    expect(cleanWebSnippet("[VIDEO] Director：Emi Fukayama")).not.toContain("[");
    expect(cleanWebSnippet("# Nostalgia")).toBe("Nostalgia");
  });

  it("texte propre préservé tel quel", () => {
    expect(cleanWebSnippet("Natori is a Japanese musician and producer.")).toBe("Natori is a Japanese musician and producer.");
  });

  it("câblage : .search affiche extraits et titres nettoyés", () => {
    const src = read("src/bot/commands/search.ts");
    expect(src).toContain("cleanWebSnippet(h.snippet)");
    expect(src).toContain("cleanWebSnippet(h.title)");
  });
});

describe("9.19g — searchResultVideoFollowUp : recherche trouvée → téléchargement enchaîné", () => {
  const RESULTS = ["🔍 *Recherche — natori*", "1. *Nostalgia*", "   https://www.youtube.com/watch?v=uLfiVjjNVEI", "_Via Tavily._"];

  it("verbe de téléchargement + mot vidéo + lien YouTube → .ytv enchaîné", () => {
    expect(searchResultVideoFollowUp("search", RESULTS, "Non je voulais la vidéo télécharge la et envoi la stp"))
      .toEqual({ url: "https://www.youtube.com/watch?v=uLfiVjjNVEI" });
    expect(searchResultVideoFollowUp("search", ["clip : https://youtu.be/dQw4w9WgXcQ"], "télécharge le clip stp"))
      .toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("question d'info (« c'est quoi le clip X ? ») → AUCUN téléchargement auto", () => {
    expect(searchResultVideoFollowUp("search", RESULTS, "c'est quoi le clip de natori ?")).toBeNull();
  });

  it("sans intention vidéo, sans lien, ou commande ≠ search → null", () => {
    expect(searchResultVideoFollowUp("search", RESULTS, "télécharge la dernière musique de natori stp")).toBeNull();
    expect(searchResultVideoFollowUp("search", ["aucun lien ici"], "télécharge la vidéo stp")).toBeNull();
    expect(searchResultVideoFollowUp("wiki", RESULTS, "télécharge la vidéo stp")).toBeNull();
  });

  it("câblage : la boucle agent chaîne après une recherche non interactive", () => {
    const src = read("src/bot/services/agentRunner.ts");
    expect(src).toContain("searchResultVideoFollowUp(canonical.name, out.texts, text)");
    expect(src).toContain("let searchChainUsed = false;");
  });

  it("câblage : le guide interdit le pavé de commandes et le double astérisque", () => {
    const src = read("src/bot/commandKnowledge.ts");
    expect(src).toContain("JAMAIS la liste complète");
    expect(src).toContain("jamais **");
  });
});
