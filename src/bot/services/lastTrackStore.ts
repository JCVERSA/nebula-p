/**
 * 9.18nnnn (P2) — dernière piste musicale par chat (couplage .lyrics ↔ .ytm).
 *
 * Quand .ytm/.song livre une chanson, le titre est mémorisé pour ce chat :
 * `.lyrics` sans argument reprend alors cette chanson (« les paroles de ce
 * que je viens d'envoyer »). TTL 30 min — au-delà, .lyrics demande une
 * requête explicite.
 *
 * En mémoire de session uniquement : après un redémarrage, `.lyrics` sans
 * argument dit honnêtement qu'il faut préciser le titre (rien de critique
 * à persister).
 */

const TRACK_TTL_MS = 30 * 60 * 1000;
const MAX_CHATS = 200;

interface Entry {
  title: string;
  at: number;
}

const store = new Map<string, Entry>();

/** .ytm/.song : mémorise la piste livrée dans ce chat. */
export function rememberLastTrack(chatJid: string, title: string): void {
  const clean = String(title || "").trim();
  if (!clean || !chatJid) return;
  if (store.size >= MAX_CHATS) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(String(chatJid), { title: clean.slice(0, 200), at: Date.now() });
}

/** Dernière piste mémorisée pour ce chat, ou null si absente/expirée. */
export function getLastTrack(chatJid: string, now = Date.now()): string | null {
  const entry = store.get(String(chatJid));
  if (!entry) return null;
  if (now - entry.at > TRACK_TTL_MS) {
    store.delete(String(chatJid));
    return null;
  }
  return entry.title;
}

/** Tests uniquement : vide le store. */
export function __resetLastTrackForTests(): void {
  store.clear();
}
