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
