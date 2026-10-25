/**
 * 9.18mmmm — humanisation des envois (axe F du rapport R&D : anti-ban).
 *
 * Deux briques issues des pratiques 2026 (baileys-antiban, whatsapp-antiban) :
 *  - typingPresence : « est en train d'écrire » avant une réponse visible —
 *    un bot qui répond en 0 ms à chaque fois est un signal comportemental ;
 *  - jitterDelay : délai gaussien-ish entre envois en rafale (jamais
 *    d'intervalle mécanique fixe).
 *
 * Les deux échouent SILENCIEusement : l'humanisation ne doit jamais casser
 * un envoi.
 */

/** Affiche « composing » sur le chat — best effort, jamais bloquant. */
export async function typingPresence(sock: any, jid: string): Promise<void> {
  try {
    if (sock && typeof sock.sendPresenceUpdate === "function") {
      await sock.sendPresenceUpdate("composing", jid);
    }
  } catch {
    /* silencieux */
  }
}

/** Délai aléatoire borné (ms) — les coins sont arrondis vers le centre. */
export function jitterMs(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  const mid = (minMs + maxMs) / 2;
  const half = (maxMs - minMs) / 2;
  // Triangulaire centrée : plus de masse au milieu qu'aux bords.
  const u = Math.random();
  const v = Math.random();
  const tri = (u + v) / 2; // moyenne de deux uniformes ≈ triangulaire
  return Math.round(mid + (tri - 0.5) * 2 * half);
}

export async function jitterDelay(minMs = 2000, maxMs = 5000): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, jitterMs(minMs, maxMs)));
}
