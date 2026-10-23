/**
 * 9.18vv — audit design : garde-fous des normalisations décidées.
 *
 * D1 : 8 noirs « panel » → 2 valeurs (#0b0b0c page/cartes, #0e0e11
 *      surélevé). La famille WhatsApp du simulateur est intentionnelle.
 * D2 : (faux constat de l'audit — le plancher 8.92 couvrait déjà focus
 *      clavier + prefers-reduced-motion : on le GARDE couvert ici.)
 * D3 : zinc-600 (contraste ~2,9:1, échec WCAG AA) banni des textes.
 * D4 : taille standard 11px — plus de 10.5px.
 * D8 : Nova (APK) unifiée sur l'identité panel : ambre, plus de cyan néon.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");
const files = ["src/App.tsx", ...fs.readdirSync("src/components").filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${f}`)];
const all = files.map(read).join("\n");

describe("9.18vv — audit design : normalisations D1/D3/D4 + plancher D2", () => {
  it("D1 : les 6 noirs retirés ne réapparaissent dans aucun composant", () => {
    for (const hex of ["#0a0a0c", "#141416", "#18181b", "#1c1c1e", "#0b1216", "#0d1420"]) {
      expect(all, `${hex} est revenu`).not.toContain(`bg-[${hex}]`);
    }
  });

  it("D1 : la palette réduite est bien là (#0b0b0c + #0e0e11)", () => {
    expect(all).toContain("bg-[#0b0b0c]");
    expect(all).toContain("bg-[#0e0e11]");
  });

  it("D1 : le mockup WhatsApp du simulateur est intact (familles intentionnelles)", () => {
    expect(all).toContain("#111b21"); // fond de chat WhatsApp
    expect(all).toContain("#1f2c34"); // en-tête WhatsApp
  });

  it("D3 : zinc-600 (échec contraste AA) banni des textes", () => {
    expect(all).not.toContain("text-zinc-600");
  });

  it("D4 : plus de texte 10.5px (standard 11px)", () => {
    expect(all).not.toContain("text-[10.5px]");
  });

  it("D2 : le plancher d'accessibilité 8.92 reste en place (focus + reduced-motion)", () => {
    const css = read("src/index.css");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
  });
});

describe("9.18vv — D8 : Nova (APK) unifiée sur l'identité panel (ambre)", () => {
  const colors = read("android/app/src/main/java/com/example/ui/theme/Color.kt");

  it("plus aucun cyan néon dans les tokens", () => {
    expect(colors).not.toContain("0xFF00E5FF");
    expect(colors).not.toContain("0x3300E5FF");
  });

  it("les tokens portent la palette panel : noir #0b0b0c, ambre 500", () => {
    expect(colors).toContain("Color(0xFF0B0B0C)"); // DarkBackground
    expect(colors).toContain("Color(0xFFF59E0B)"); // CyanNeon → ambre
  });

  it("les couleurs sémantiques du panel : emerald (succès), rose (erreur), zinc (textes)", () => {
    expect(colors).toContain("Color(0xFF34D399)"); // MintGreen → emerald
    expect(colors).toContain("Color(0xFFFB7185)"); // CoralRed → rose
    expect(colors).toContain("Color(0xFF71717A)"); // TextMuted → zinc-500
  });
});

/**
 * 9.18iiii — audit design v3 (simulateur) : normalisations D9-D12.
 *
 * D9  : Quick Send utilise le préfixe DYNAMIQUE (la liste codée ".ping"
 *       envoyait des commandes mortes dès que le préfixe changeait).
 * D10 : hauteur du chat en dvh par breakpoint (100vh coupe sous la barre
 *       d'URL mobile ; -180px mobile / -120px desktop, plus de nombre magique
 *       unique) + sticky xl pour rester visible au scroll de la colonne droite.
 * D11 : les entrées et boutons icône du simulateur portent leurs labels
 *       accessibles (aria-label / aria-expanded) — placeholder ≠ label.
 * D12 : le pouce de scrollbar dark-scroll passe 3:1 de contraste (WCAG
 *       1.4.11) et Firefox est supporté (scrollbar-color).
 */
describe("9.18iiii — audit design v3 (simulateur) : D9-D12", () => {
  const app = read("src/App.tsx");
  const css = read("src/index.css");

  it("D9 : Quick Send envoie le préfixe configuré, pas un point littéral", () => {
    expect(app).not.toContain('[".ping", ".menu"');
    expect(app).toContain("simulateCommandFromDoc(`${config.prefix}${cmd}`)");
  });

  it("D10 : hauteur du chat en dvh responsive + sticky sur écran large", () => {
    expect(app).not.toContain("h-[calc(100vh-180px)]");
    expect(app).toContain("h-[calc(100dvh-180px)] md:h-[calc(100dvh-120px)]");
    expect(app).toContain("xl:sticky xl:top-8");
  });

  it("D11 : labels accessibles sur les entrées et boutons icône du simulateur", () => {
    expect(app).toContain('aria-label="Search messages in the simulator conversation"');
    expect(app).toContain('aria-label="Clear search"');
    expect(app).toContain('aria-label="Message the bot in the simulator"');
    const batch = read("src/components/BatchDownloadStatus.tsx");
    expect(batch).toContain("aria-expanded={showDetails}");
    expect(batch).toContain('id="batch-download-details"');
  });

  it("D12 : scrollbar dark-scroll lisible (>= 3:1) et supportee par Firefox", () => {
    expect(css).not.toContain(".dark-scroll::-webkit-scrollbar-thumb {\n  background: #334155;\n}");
    expect(css).toContain(".dark-scroll::-webkit-scrollbar-thumb {\n  background: #64748b;\n}");
    expect(css).toContain("scrollbar-color: #64748b transparent");
  });
});

/**
 * 9.18jjjj — audit design v4 (onglet Système) : normalisations D13-D16.
 *
 * D13 : DIAGNOSTICS RÉELS — le moniteur affichait des données simulées
 *       (Math.random, PIDs 4110/4112/4119 codés en dur, « Speed Test
 *       Burst », « RAM Cache Flush » factices). Désormais il pole
 *       /api/system/metrics et ce qui n'est pas mesuré s'affiche « — ».
 * D14 : SystemPanel unifié sur la palette D1 (#0b0b0c, plus de cartes
 *       bg-white/5) et l'accent ambre (plus de sky, identité D8).
 * D15 : la modale destructive (stop = extinction) est un vrai dialogue :
 *       role/aria-modal/aria-labelledby, Escape = Annuler, focus initial
 *       sur Annuler. Labels accessibles sur les champs du simulateur système.
 * D16 : le gradient from-[#141416] (hex banni D1, échappé via le préfixe
 *       from-) est parti — le garde-fou couvre désormais tout préfixe.
 */
describe("9.18jjjj — audit design v4 (onglet Système) : D13-D16", () => {
  const panel = read("src/components/SystemPanel.tsx");
  const diag = read("src/components/SystemDiagnostics.tsx");
  const routes = read("src/panel/systemRoutes.ts");

  it("D13 : diagnostics réels — plus de simulacre, polling de vraies mesures", () => {
    expect(diag).not.toContain("Math.random("); // appel reel — le commentaire historique est autorise
    expect(diag).not.toContain("PID 4110");
    expect(diag).not.toContain("handleSpeedTest"); // action factice retiree
    expect(diag).not.toContain("handleFlushMemory"); // action factice retiree
    expect(diag).toContain("/api/system/metrics");
    expect(routes).toContain('"/api/system/metrics"');
    // Ce qui n'est pas mesuré s'affiche « — », jamais un 0 inventé.
    expect(diag).toContain(': "—"');
  });

  it("D14 : SystemPanel dans la palette D1 + accent ambre (plus de sky, plus de bg-white/5)", () => {
    expect(panel).toContain("bg-[#0b0b0c] border border-white/10 rounded-2xl");
    expect(panel).not.toContain("bg-white/5 border border-white/10");
    expect(panel).not.toContain("sky-");
    expect(panel).not.toContain("text-zinc-500");
  });

  it("D15 : modale destructive accessible + labels des champs", () => {
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('aria-labelledby="system-modal-title"');
    expect(panel).toContain('e.key === "Escape"');
    expect(panel).toContain("autoFocus");
    expect(panel).toContain('aria-label={`Nouvelle valeur pour'); // template literal
    expect(panel).toContain('role="log"');
  });

  it("D16 : aucun hex banni D1, quel que soit le préfixe (bg-, from-, to-…)", () => {
    for (const hex of ["#0a0a0c", "#141416", "#18181b", "#1c1c1e", "#0b1216", "#0d1420", "#0e0e10"]) {
      expect(diag, `${hex} dans SystemDiagnostics`).not.toContain(`[${hex}]`);
      expect(panel, `${hex} dans SystemPanel`).not.toContain(`[${hex}]`);
    }
  });
});
