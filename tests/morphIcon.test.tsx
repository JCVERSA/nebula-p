// @vitest-environment jsdom
/**
 * 9.18rr — MorphIcon : portage web du concept SwiftSlate de l'APK
 * (SlateMorphIcon). Deux morphs à utilité d'ÉTAT (pas de décoration —
 * esprit du grand nettoyage 9.18qq) : ChatBubble ouvert/fermé, fin de
 * mise à jour qui se dessine.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import { render, screen } from "@testing-library/react";
import { MenuCloseMorph, CheckMorph } from "../src/components/MorphIcon";
import { MorphIcon } from "morphicons/react";
import { Pause as PauseData, Play as PlayData } from "lucide";
import ChatBubble from "../src/components/ChatBubble";

describe("9.18rr — MorphIcon (concept SwiftSlate sur le web)", () => {
  it("MenuCloseMorph : traits + bulle rendus, croix quand open", () => {
    const { container, rerender } = render(<MenuCloseMorph open={false} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(container.querySelectorAll("line").length).toBe(2); // les 2 traits qui pivotent
    expect(container.querySelector("rect")).toBeTruthy(); // la bulle
    // état croix : même structure, animation pilotée par props (pas de crash)
    rerender(<MenuCloseMorph open={true} />);
    expect(container.querySelectorAll("line").length).toBe(2);
  });

  it("CheckMorph : anneau + coche rendus (dessin pathLength)", () => {
    const { container } = render(<CheckMorph />);
    expect(container.querySelector("circle")).toBeTruthy();
    expect(container.querySelector("path")).toBeTruthy(); // la coche qui se trace
  });

  it("ChatBubble : bulle du terminal — morph + état exposé (aria-expanded)", () => {
    const { rerender } = render(<ChatBubble onClick={() => {}} isOpen={false} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    rerender(<ChatBubble onClick={() => {}} isOpen={true} />);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("wiring : la fin de mise à jour utilise la coche qui se dessine (LoadingSuccess)", () => {
    const src = fs.readFileSync("src/components/SystemPanel.tsx", "utf-8");
    expect(src).toContain('<CheckMorph size={14}');
    expect(src).not.toContain("<CheckCircle2"); // la coche statique est remplacée
  });
});

describe("9.18ss — morphicons v2 (morph universel) sur les 4 spots à état", () => {
  it("la lib rend une icône lucide (données) qui répond au prop", () => {
    const { container, rerender } = render(<MorphIcon icon={PauseData} size={12} />);
    expect(container.querySelector("svg")).toBeTruthy();
    rerender(<MorphIcon icon={PlayData} size={12} />);
    expect(container.querySelector("svg")).toBeTruthy(); // morph déclenché sans crash
  });

  it("wiring : les 4 sites utilisent morphicons/react (journal, sidebar, batchs, update)", () => {
    const read = (f: string) => fs.readFileSync(`src/components/${f}`, "utf-8");
    const sys = read("SystemPanel.tsx");
    expect(sys).toContain('icon={logsPaused ? PlayData : PauseData}');   // Pause/Play journal
    expect(sys).toContain('icon={busy ? LoaderData : RocketData}');     // bouton Mettre à jour
    expect(read("Sidebar.tsx")).toContain('icon={collapsed ? PanelLeftData : PanelLeftCloseData}');
    expect(read("BatchDownloadStatus.tsx")).toContain('icon={showDetails ? ChevronUpData : ChevronDownData}');
  });

  it("accessibilité : reducedMotion suit l'OS partout (parité SlateMotion APK)", () => {
    for (const f of ["SystemPanel.tsx", "Sidebar.tsx", "BatchDownloadStatus.tsx"]) {
      const src = fs.readFileSync(`src/components/${f}`, "utf-8");
      expect(src).toContain('reducedMotion="user"');
    }
  });
});

describe("9.18tt — perf build : lucide importé PAR FICHIER (retour terrain 17/10)", () => {
  it("aucun composant n'importe l'index lucide (~1900 modules transformés pour 8 icônes)", () => {
    for (const f of ["SystemPanel.tsx", "Sidebar.tsx", "BatchDownloadStatus.tsx"]) {
      const src = fs.readFileSync(`src/components/${f}`, "utf-8");
      expect(src).not.toMatch(/from "lucide";/); // index interdit — 2698→4608 modules
      expect(src).toMatch(/lucide\/dist\/esm\/icons\//); // par fichier uniquement
    }
  });

  it("manage.sh setup : le bot est arrêté pendant le build (curl|sh, RAM 1 Go)", () => {
    const sh = fs.readFileSync("manage.sh", "utf-8");
    expect(sh).toContain("setup_was_running");
    expect(sh).toContain("Bot arrêté pendant le build");
  });
});
