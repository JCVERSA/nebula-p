/**
 * 9.18oo — build conditionnel : le panel React (vite, l'étape lourde) n'est
 * reconstruit que si ses sources ont changé depuis le dernier build réussi.
 *
 * Retour terrain 16/10 : « le build prend trop de temps » — 9+ min d'écran
 * figé (sortie avalée par `| tail -30`) pour un sync de 2 fichiers serveur :
 * le panel rebuildé était identique au bit près. Les 3 bundles esbuild
 * (secondes) restent toujours reconstruits.
 *
 * Preuve fonctionnelle exécutée au développement : 1er passage panel built,
 * 2ᵉ passage panel sauté (0,25 s total), toucher src/index.css → rebuild.
 * Ici : syntaxe, logique de saut, périmètre de l'empreinte, câblage des
 * appelants (package.json, manage.sh).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

describe("9.18oo — build conditionnel (panel vite sauté si inchangé)", () => {
  it("scripts/build.sh : syntaxe bash valide", () => {
    execSync("bash -n scripts/build.sh", { cwd: process.cwd(), stdio: "pipe" });
  });

  it("logique de saut : empreinte persistée + force + garde dist", () => {
    const src = read("scripts/build.sh");
    expect(src).toContain(".nebula-panel-hash");
    expect(src).toContain("NEBULA_FORCE_PANEL_BUILD");
    expect(src).toContain("dist/index.html");
    expect(src).toContain("dist/assets");
    expect(src).toContain("inchangées — sauté");
  });

  it("empreinte panel : sources client suivies, src/bot EXCLU (update bot-only = panel sauté)", () => {
    const src = read("scripts/build.sh");
    const findLine = src.split("\n").find((l) => l.includes("find src/components"));
    expect(findLine).toBeTruthy();
    expect(findLine).toContain("src/lib");
    expect(findLine).toContain("src/utils");
    expect(findLine).toContain("src/types");
    expect(findLine).toContain("src/panel");
    expect(findLine).not.toContain("src/bot"); // jamais dans l'empreinte panel
  });

  it("package.json : build → bash scripts/build.sh (install.sh, setup et update en profitent)", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toBe("bash scripts/build.sh");
  });

  it("manage.sh : sortie du build EN DIRECT — plus de tail qui fige l'écran 9 min", () => {
    const sh = read("manage.sh");
    expect(sh).not.toContain("npm run build 2>&1 | tail");
    expect(sh.split("npm run build 2>&1 | sed").length - 1).toBeGreaterThanOrEqual(3);
  });
});
