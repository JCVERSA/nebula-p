import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * 9.18j — correctifs de retour terrain (13/10, transcript réel) :
 *
 *  1. DM : un média sans caption (sticker, image) déclenchait un tour IA à
 *     PROMPT VIDE — Gemini répondait n'importe quoi (« Je suis NOVA… »,
 *     « Je suis à ton écoute ! ») et brûlait le quota. La porte IA exige
 *     désormais un texte non vide.
 *  2. Films voiranime (The Garden of Words) : une saison sans épisodes
 *     numérotés (film/OAV, n=0) tuait la session (« aucun épisode numéroté
 *     trouvé ») — l'utilisateur tournait en rond. Repli : les entrées film
 *     deviennent la liste sélectionnable.
 *
 * Tests structurels (le moteur WhatsApp ne se lance pas en CI).
 */

describe("9.18j — DM : plus de tour IA sur prompt vide", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");

  it("la porte IA DM exige un texte non vide (stickers/images muets)", () => {
    expect(src).toContain(
      "if (!isGroup && !isFromMe && text.trim() && !text.startsWith(prefix)) {"
    );
    // plus aucun chemin DM IA sans garde-texte
    expect(src).not.toContain("if (!isGroup && !isFromMe && !text.startsWith(prefix)) {");
  });

  it("les notes vocales restent traitées AVANT la porte (l'ASR ne passe pas par le prompt vide)", () => {
    const asr = src.indexOf("!isFromMe && !text.trim() && messageContent.audioMessage");
    const gate = src.indexOf(
      "if (!isGroup && !isFromMe && text.trim() && !text.startsWith(prefix)) {"
    );
    expect(asr).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(asr).toBeLessThan(gate); // le bloc ASR précède la porte IA
  });
});

describe("9.18j — films voiranime : une saison sans numéros n'est plus une erreur", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");

  it("repli film : saison sans épisodes numérotés → entrées film sélectionnables (les DEUX chemins)", () => {
    expect(src).toContain("function voiranimeSelectableEpisodes");
    // définition + les deux sites d'appel (chemin rapide + étape saison)
    expect(src.match(/voiranimeSelectableEpisodes\(/g)?.length).toBeGreaterThanOrEqual(3);
    // plus aucun filtre direct qui vide les listes de films
    expect(src).not.toContain("voiranimeEpisodes(targetSeason.url)).filter((e) => e.n > 0)");
    expect(src).not.toContain("voiranimeEpisodes(selectedSeason.url)).filter((e) => e.n > 0)");
  });

  it("une saison mixte (numérotés + film) reste inchangée — pas de décalage d'indices", () => {
    const helper = src.slice(
      src.indexOf("function voiranimeSelectableEpisodes"),
      src.indexOf("export async function fillVoiranimePlayers")
    );
    expect(helper).toContain("numbered.length > 0 ? numbered : all");
  });

  it("l'étape épisode affiche « Film détecté » avec le label réel (Film/OAV)", () => {
    expect(src).toContain("Film détecté");
    expect(src).toMatch(/map\(\(e\) => e\.label\)/);
  });
});
