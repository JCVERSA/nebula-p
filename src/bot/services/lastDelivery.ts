/**
 * 9.18eeee — mémoire de la dernière livraison à LIEN d'un chat.
 *
 * Le dispatch enregistre CHAQUE reply de commande contenant un lien de
 * téléchargement temporaire (route /api/media/download/) ; l'agent rejoue
 * cette livraison sur « renvoie le lien » — zéro token IA, zéro
 * re-téléchargement (le fichier reste servi par le lien existant).
 *
 * TTL = durée de vie maximale des liens (2 h glissantes) : au-delà, le lien
 * est mort et l'intention repart sur le chemin IA normal (fail-open).
 */

export interface LastDelivery {
  chatJid: string;
  text: string;
  ts: number;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const store = new Map<string, LastDelivery>();

export function recordLastDelivery(chatJid: string, text: string, now = Date.now()): void {
  if (!chatJid || !text) return;
  store.set(chatJid, { chatJid, text, ts: now });
}

export function getLastDelivery(chatJid: string, now = Date.now(), ttlMs = DEFAULT_TTL_MS): LastDelivery | null {
  const entry = store.get(chatJid);
  if (!entry) return null;
  if (now - entry.ts > ttlMs) {
    store.delete(chatJid);
    return null;
  }
  return entry;
}

export function __resetLastDeliveryForTests(): void {
  store.clear();
}
