import fs from "fs";
import { describe, expect, it } from "vitest";
import { initRegistry, getCommands } from "../src/bot/commandRegistry.js";
import { APP_VERSION, MENU_SECTIONS } from "../src/bot/commands/menu.js";

/**
 * Menu style Na (8.60) : le contenu reste honnête.
 *  - chaque entrée affichée correspond à une commande réellement enregistrée ;
 *  - chaque commande enregistrée est couverte par le menu ;
 *  - la version affichée reste synchronisée avec package.json.
 */

/** Clé d'affichage du menu pour chaque nom enregistré (alias plus lisibles). */
const DISPLAY_KEY_FOR: Record<string, string> = {
  ytvideo: "ytv",
  song: "ytm",
  ytlink: "yts",
  anime: "a",
  w: "w",
};

describe("menu style Na (8.60)", () => {
  it("chaque entrée du menu correspond à une commande enregistrée", async () => {
    await initRegistry();
    const known = new Set<string>();
    for (const cmd of getCommands()) {
      known.add(cmd.name.toLowerCase());
      for (const a of cmd.aliases || []) known.add(a.toLowerCase());
    }
    for (const s of MENU_SECTIONS) {
      for (const [key] of s.entries) {
        expect(known, `le menu annonce "${key}" qui n'est pas enregistrée`).toContain(key.toLowerCase());
      }
    }
  });

  it("le menu couvre toutes les commandes enregistrées", async () => {
    await initRegistry();
    const listed = new Set<string>();
    for (const s of MENU_SECTIONS) {
      for (const [key] of s.entries) listed.add(key.toLowerCase());
    }
    for (const cmd of getCommands()) {
      const display = DISPLAY_KEY_FOR[cmd.name] || cmd.name;
      expect(listed, `"${cmd.name}" est enregistrée mais absente du menu`).toContain(display.toLowerCase());
    }
  });

  it("la version affichée dans le menu = package.json", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("footer owner Dark Neon présent (contacts confirmés par le owner)", async () => {
    await initRegistry();
    const src = fs.readFileSync("src/bot/commands/menu.ts", "utf-8");
    expect(src).toContain("wa.me/237640143760");
    expect(src).toContain("t.me/Neonjca2");
    expect(src).toContain("Dark Neon");
  });
});
