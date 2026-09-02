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
  return `❌ *Failed:* ${list} — stream unavailable on every mirror (CDN). Ask again for these episodes only in a few minutes.\n`;
}
