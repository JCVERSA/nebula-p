import { execFileSync } from "child_process";

/**
 * 9.18ttt — identité du build pour les logs de démarrage moteur.
 *
 * Retour terrain 18/10 : le VPS tournait sur un code périmé sans que rien
 * ne le montre (l'owner synchronisait, le bouton Mettre à jour redémarrait,
 * mais le push Windows n'était pas arrivé). Désormais chaque démarrage
 * moteur journalise son sha git — un simple « nebula logs » dit ce qui
 * tourne VRAIMENT. Best-effort : pas de git / pas de repo → « ? ».
 */
export function readBuildSha(cwd = process.cwd()): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    }).trim();
    return /^[0-9a-f]{7,12}$/i.test(sha) ? sha : "?";
  } catch {
    return "?";
  }
}
