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
