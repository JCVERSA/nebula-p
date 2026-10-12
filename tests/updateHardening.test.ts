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

describe("9.18d — échec de build : erreur visible + auto-réparation (manage.sh)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");

  it("l'échec de build déclenche une réparation node_modules puis UNE seconde tentative", () => {
    expect(src).toContain("réparation de node_modules");
    expect(src).toContain("2ᵉ tentative");
    // La réparation force le registre (pas de --prefer-offline : un cache
    // npm local corrompu est précisément ce qu'on veut contourner).
    const repair = src.split("\n").find((l) => l.includes("npm install --no-audit --no-fund 2>&1"));
    expect(repair).toBeTruthy();
    expect(repair).not.toContain("--prefer-offline");
  });

  it("la ligne d'erreur n'est plus tronquée : 30 lignes de build (le tail à 6 cachait « Cannot find module »)", () => {
    expect(src).toContain("| tail -n 30 |");
    expect(src).not.toContain("| tail -n 6 |");
    expect(src).not.toContain("| tail -n 4 |");
    // Installs élargis aussi (10 lignes) — plus aucun tail -n 2 d'install.
    expect(src).toContain("| tail -n 10 |");
    expect(src).not.toContain("| tail -n 2 |");
  });

  it("la réparation est NON destructive : aucun rm -rf de node_modules", () => {
    expect(src).not.toMatch(/rm -rf[^\n]*node_modules/);
  });
});

describe("9.18e — fuite de clés « Removing old closed session »", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/suppressLibsignalNoise.ts"), "utf-8");

  it("le dump de session supprimée est avalé sur log/info/warn (préfixe, deux-points optionnel)", () => {
    expect(src).toContain('SUPPRESSED_DUMP_PREFIX = "Removing old closed session"');
    expect(src).toContain("isSessionDump(args)");
    expect(src).toContain("startsWith");
    // console.log est hooké EN PLUS d'info/warn : la méthode exacte varie
    // selon la version de libsignal.
    expect(src).toContain("const originalLog = console.log.bind(console);");
  });

  it("la suppression reste un préfixe étroit — pas d'avalage au mot près", () => {
    // startsWith sur le PRÉFIXE complet uniquement : « Removing old … » ne
    // peut pas matcher d'autres messages, et rien d'autre n'est filtré.
    const hook = src.split("\n").filter((l) => l.includes("isSessionDump(args)"));
    expect(hook.length).toBeGreaterThanOrEqual(3); // log + info + warn
  });
});

describe("9.18f — process antérieur au build (build sans redémarrage)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");

  it("« Déjà à jour » vérifie AUSSI le process et redémarre si besoin", () => {
    // Helper best-effort + branche dans le retour anticipé « build à jour »
    expect(src).toContain("panel_older_than_bundle");
    expect(src).toContain("Processus antérieur au build — redémarrage nécessaire");
    const guard = src.indexOf('&& panel_older_than_bundle; then');
    const okLine = src.indexOf("ok \"Déjà à jour (${new_rev}) — build à jour.\"");
    expect(guard).toBeGreaterThan(-1);
    expect(okLine).toBeGreaterThan(guard); // le garde-fou PRÉCÈDE le « rien à faire »
    // Redémarrage via le script À JOUR (exec) avec verrou libéré avant
    const branch = src.slice(guard, src.indexOf("return 0", guard));
    expect(branch).toContain("update_lock_release");
    expect(branch).toContain('exec bash "${self_path}" restart');
  });

  it("détection best-effort : lecture impossible → jamais de faux positif", () => {
    const fn = src.slice(
      src.indexOf("panel_older_than_bundle() {"),
      src.indexOf("\n}", src.indexOf("panel_older_than_bundle() {")),
    );
    expect(fn).toContain("return 1"); // chaque lecture ratée sort en « non »
    expect(fn).toContain("+ 2 "); // tolérance même-seconde
    expect(fn).toContain("dist/server.cjs");
  });
});
