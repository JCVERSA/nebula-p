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

describe("9.18k — SLIM : l'erreur ffmpeg enfin visible + durcissement TS", () => {
  const kit = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/mediaToolkit.ts"), "utf-8");
  const slim = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/videoSlim.ts"), "utf-8");

  it("runFfmpegKit garde la FIN de stderr (fenêtre glissante), pas le début figé", () => {
    // L'ancien cap arrêtait l'accumulation à 8000 : la bannière + les
    // premières frames figeaient le buffer et l'erreur fatale (toujours en
    // FIN d'encodage) n'était jamais capturée — deux échecs « identiques »
    // en production (frame=3, time=0.64s) venaient de ce artefact.
    expect(kit).toContain("stderr = stderr.slice(-4000)");
    expect(kit).not.toContain("if (stderr.length < 8000) stderr +=");
  });

  it("SLIM durcit ffmpeg pour les entrées issues de TS consolidés (DTS non monotones)", () => {
    expect(slim).toContain('"+genpts"');
    expect(slim).toContain('"aresample=async=1:first_pts=0"');
    expect(slim).toContain('"make_zero"');
  });

  it("agent : un écran qui se termine par « Réponds avec » ne déclenche plus de question redondante", () => {
    const runner = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/agentRunner.ts"), "utf-8");
    expect(runner).toContain("il sait quoi faire");
    expect(runner).toContain("Ne redemande JAMAIS une information que l'écran affiche déjà");
  });
});

describe("9.18l — agent : le tour INITIAL n'annonce pas ce que la commande affichera", () => {
  it("« Peux-tu télécharger X ? » s'exécute tel quel — jamais de question preemptive", () => {
    const ck = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commandKnowledge.ts"), "utf-8");
    // Retour terrain 01:42 : « Quel numéro d'anime choisir ? » posé AVANT la
    // recherche — la commande .a affiche elle-même la liste des choix.
    expect(ck).toContain("EXÉCUTABLE tel quel");
    expect(ck).toContain("Ne demande JAMAIS à l'avance");
    expect(ck).toContain("l'écran suivant les propose");
  });
});

describe("9.18n — agent : l'auto-sélection reprend le dessus sur le relais (Mushoku s1)", () => {
  const runner = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/agentRunner.ts"), "utf-8");

  it("la règle « exécute le choix » est marquée PRIORITAIRE et précède la règle du relais", () => {
    const execRule = runner.indexOf("PRIORITAIRE — La demande initiale de l'utilisateur désigne CLAIREMENT");
    const relayRule = runner.indexOf("L'écran observé se termine DÉJÀ par une consigne");
    expect(execRule).toBeGreaterThan(-1);
    expect(relayRule).toBeGreaterThan(-1);
    expect(execRule).toBeLessThan(relayRule); // la priorité se lit EN PREMIER dans le prompt
  });

  it("une consigne en fin d'écran n'interdit plus l'auto-sélection (conflit 9.1 × 9.18k résolu)", () => {
    expect(runner).toContain("ne t'empêche PAS de choisir toi-même");
    expect(runner).toContain("si sa demande contient DÉJÀ la réponse, tu exécutes son choix");
  });

  it("la règle du relais ne vaut QUE lorsque la demande ne désigne pas l'information", () => {
    expect(runner).toContain("ET sa demande ne désigne PAS l'information demandée : il sait quoi faire");
  });
});

describe("9.18o — audit agent : contradictions du prompt réconciliées", () => {
  const ck = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commandKnowledge.ts"), "utf-8");

  it("A2 : la règle 8.79 « tu ne peux pas télécharger » ne contredit plus le pilotage autonome 9.1", () => {
    expect(ck).not.toContain("Tu ne peux pas télécharger ni envoyer de fichiers");
    expect(ck).not.toContain("ex. « ${p}a solo leveling »)");
    // nouvelle règle : exécute si commande existe, commande à taper SEULEMENT si aucune commande ne sert la demande
    expect(ck).toContain("exécute-la (pilotage autonome)");
    expect(ck).toContain("Rien ne sert sa demande");
  });

  it("A3 : « Décide » est cadré à ytv/ytm, l'anime reste TOUJOURS à l'utilisateur", () => {
    expect(ck).not.toContain("Choix laissé ? Décide.");
    expect(ck).toContain("anime : préférences utilisateur");
    expect(ck).toContain("vont TOUJOURS à l'utilisateur");
  });
});
