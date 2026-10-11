import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * 9.18b — durcissement du déploiement (retour terrain : update sans effet).
 *
 * Symptôme : l'owner a poussé a320964 puis cliqué « Mettre à jour » — le
 * bot a redémarré mais tournait sur l'ANCIEN build. Le script update fait
 * un `git pull --ff-only` refusé par tout fichier suivi modifié localement
 * (package-lock.json réécrit par le npm du VPS), ou relance l'ancien build
 * si install/build échoue. Vérifs structurelles des deux garde-fous.
 */

describe("9.18b — update résilient (manage.sh)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");

  it("auto-stash avant le pull : un arbre sale ne bloque plus jamais l'update", () => {
    expect(src).toContain("nebula-update-auto-stash");
    expect(src).toContain("Auto-stash impossible");
    // Restauration si le pull échoue, écart sinon
    expect(src).toContain("stash pop");
    expect(src).toContain("stash drop");
  });

  it("le stash ne touche QUE les fichiers suivis (.env/bots.json jamais)", () => {
    // Pas de --include-untracked ni -u dans le push
    const pushLine = src.split("\n").find((l) => l.includes("stash push"));
    expect(pushLine).toBeTruthy();
    expect(pushLine).not.toContain("--include-untracked");
    expect(pushLine).not.toMatch(/\bstash\s+push\s+[^|]*\s-u\b/);
  });

  it("en cas d'échec d'étape : l'ancien build est relancé (jamais de bot down)", () => {
    expect(src).toContain("update_fail");
    expect(src).toContain("relance de l'ancien build");
  });
});

describe("9.18b — bruit libsignal « Bad MAC » (suppressLibsignalNoise)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/suppressLibsignalNoise.ts"), "utf-8");

  it("la forme « Session error: + Bad MAC » est avalée, le reste passe", () => {
    expect(src).toContain('SUPPRESSED_ERR_PREFIX = "Session error:"');
    expect(src).toContain('text.includes("Bad MAC")');
    // chirurgical : les autres erreurs passent toujours
    expect(src).toContain("originalError(...args)");
  });

  it("les fuites de clés restent couvertes (9.0c inchangé)", () => {
    expect(src).toContain('SUPPRESSED_INFO = "Closing session:"');
    expect(src).toContain('SUPPRESSED_WARN = "Session already closed"');
  });
});

describe("9.18c — update auto-réparant : build périmé détecté (manage.sh)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");

  it("un build réussi marque son rev (update ET setup écrivent le marqueur)", () => {
    // Deux écritures : cmd_update et cmd_setup — le setup seul ne doit pas
    // laisser un dist sans marqueur (il deviendrait « périmé » à tort).
    const needle = '> "${APP_DIR}/dist/.nebula-build-rev"';
    expect(src.split(needle).length - 1).toBe(2);
  });

  it("« Déjà à jour » ne sort QUE si le build correspond au HEAD (anti no-op)", () => {
    // Retour terrain : checkout à jour, UI ancienne — le bouton no-opait
    // pour toujours. Le retour anticipé exige maintenant l'égalité
    // marqueur/HEAD, sinon reconstruction complète.
    expect(src).toContain("stale_rebuild");
    expect(src).toContain("build périmé");
    const guard = src.indexOf('[ "${built_rev}" = "${head_full}" ]');
    const early = src.indexOf("Déjà à jour (${new_rev}) — build à jour.");
    expect(guard).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(guard);
  });

  it("rebuild d'un build périmé : npm install forcé (état node_modules inconnu)", () => {
    const lines = src.split("\n");
    const idx = lines.findIndex((l) => l.includes('[ "${stale_rebuild}" = "yes" ]'));
    expect(idx).toBeGreaterThan(-1);
    // La branche stale installe dans les 3 lignes qui suivent le if
    expect(lines.slice(idx, idx + 4).join("\n")).toContain("npm install");
  });
});
