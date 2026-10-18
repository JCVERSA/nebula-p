/**
 * 9.18ggg — socket WhatsApp VIVANT, lisible de partout sans cycle d'import.
 *
 * Audit 17/10 (docs/audit-connexion-whatsapp-2026-10-17.md §1 et §5) :
 * les réponses de commandes, l'agent (texte/voix) et les rappels partaient
 * sur le socket CAPTURÉ à l'arrivée du message. Après une reconnexion
 * (408/515), un flux long — téléchargement de 30 min — livrait dans un
 * socket mort depuis longtemps : « Error sending message: Connection
 * Closed » avalé, réponse perdue, utilisateur sans nouvelles. Les rappels,
 * eux, lisaient getBotState().socket, un champ qui n'EXISTE pas → jamais
 * livrés.
 *
 * Ce module minimal (zéro import : aucun cycle possible) casse le problème
 * à la racine :
 *  - botEngine y publie le socket courant (setLiveSocket) à chaque
 *    (re)connexion et l'efface à chaque fermeture ;
 *  - tout envoi tardif fait resolveLiveSocket(sockCapturé) AU MOMENT
 *    d'envoyer : le vivant s'il existe, sinon le capturé — jamais pire
 *    qu'avant.
 */

let liveSocket: any = null;

/** botEngine uniquement : publie le socket courant (null = déconnecté). */
export function setLiveSocket(sock: any): void {
  liveSocket = sock ?? null;
}

/** Le socket vivant actuel, ou null si le moteur est déconnecté. */
export function getLiveSocket(): any {
  return liveSocket;
}

/**
 * Le socket à utiliser POUR CET ENVOI : le vivant s'il existe et sait
 * envoyer, sinon celui capturé au moment du message (repli identique à
 * l'ancien comportement).
 */
export function resolveLiveSocket(captured: any): any {
  if (liveSocket && typeof liveSocket.sendMessage === "function") {
    return liveSocket;
  }
  return captured;
}
