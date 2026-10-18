/**
 * Batch failure recap (audit 8.40, 2026-09-01).
 *
 * Production log evidence: when an episode's stream dies on every mirror
 * (e.g. urlset master.m3u8 returning 403 to both download engines), the
 * batch silently delivered N-1 links and the summary only said
 * "Ready Episodes: 4/5" — the user had to guess WHICH episode was missing
 * and whether it was intentional. This helper makes the gap explicit and
 * tells the user what to do next.
 */

export function formatFailedEpisodes(requestedEpNums: number[], deliveredEpNums: number[]): string {
  if (!requestedEpNums || requestedEpNums.length === 0) return "";
  const delivered = new Set(deliveredEpNums);
  const failed = [...new Set(requestedEpNums)].filter(n => !delivered.has(n));
  if (failed.length === 0) return "";
  const list = failed.map(n => `Episode ${n}`).join(", ");
  return `❌ *Épisodes échoués :* ${list} — la source les refuse pour le moment.\n🔁 Redemande ces épisodes dans quelques minutes.\n`;
}

/** 9.18xxx : plafond honnête d'un épisode fast-lane 480P/360P (~24 min ≈ 90-200 Mo). */
export const FASTLANE_HONEST_MAX_BYTES = 250 * 1024 * 1024;

/**
 * 9.18xxx (terrain 18/10) : certains embeds servent un flux 1080P sous une
 * variante étiquetée 480P (Jaadugar E05/E08 : 710-725 Mo livrés pour un
 * 480P demandé, ~90 Mo attendus — ces embeds n'exposent AUCUNE liste de
 * pistes, donc la garde fast-lane existante « >200 Mo → variante plus
 * légère » ne pouvait même pas s'exécuter). La seule vérité est le FICHIER :
 * taille + hauteur réelle (ffprobe). Retourne l'étiquette RÉELLE quand le
 * fast-lane demandé a été trompé, sinon null (le label demandé reste vrai).
 */
export function fastLaneMismatch(requestedRes: string, sizeBytes: number, height: number | null): string | null {
  if (requestedRes !== "480P" && requestedRes !== "360P") return null; // fast lanes seulement
  if (!Number.isFinite(sizeBytes) || sizeBytes <= FASTLANE_HONEST_MAX_BYTES) return null;
  if (height === null || height <= 0) return "SOURCE"; // gros, hauteur inconnue → neutre honnête
  if (height >= 1000) return "1080P";
  if (height >= 700) return "720P";
  return null; // réellement ≤ 480p (épisode long) — le label demandé reste vrai
}
