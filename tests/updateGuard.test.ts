/**
 * 9.18ttt — marqueur de build + garde « batch en cours » côté CLI.
 *
 * Terrain 18/10 : le VPS tournait sur un code périmé (le push Windows
 * n'était pas arrivé) et une mise à jour lancée en plein batch a tué
 * 8 épisodes de téléchargement. Désormais : chaque démarrage moteur
 * journalise son sha git, et manage.sh refuse update/restart tant qu'un
 * batch vit (claim disque au PID vivant).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { readBuildSha } from "../src/bot/buildInfo.js";

describe("9.18ttt — readBuildSha (marqueur de build)", () => {
  it("dans ce repo git : un sha court hexadécimal", () => {
    const sha = readBuildSha();
    expect(sha).toMatch(/^[0-9a-f]{7,12}$/i);
    expect(sha).not.toBe("?");
  });

  it("hors repo / git absent → « ? » (best-effort, jamais d'échec)", () => {
    expect(readBuildSha("/definitely/not/a/repo")).toBe("?");
  });

  it("le démarrage moteur journalise le build (vérifiable via nebula logs)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "engine.ts"), "utf-8");
    expect(src).toContain("build ${readBuildSha()}");
  });
});

describe("9.18ttt — manage.sh : la garde vit aussi côté CLI", () => {
  const sh = () => fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");

  it("syntaxe bash valide", () => {
    execFileSync("bash", ["-n", path.resolve(process.cwd(), "manage.sh")]);
  });

  it("la garde est définie et branchée sur update ET restart, avec l'échappatoire force", () => {
    const src = sh();
    expect(src).toContain("live_batch_claims()");
    expect(src).toContain("require_no_live_batch   # 9.18ttt : ne jamais tuer un batch en cours");
    expect(src).toContain("cmd_restart() { require_no_live_batch;");
    expect(src).toContain("NEBULA_FORCE_UPDATE");
  });
});
