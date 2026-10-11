/**
 * recentMessages (9.8) — registre borné des messages récents, par chat.
 *
 * Constat prod (9.6c) : un reply peut arriver SANS le contenu du message
 * cité (clés : extendedTextMessage + messageContextInfo, quotedMessage épuré
 * — chats à messages éphémères, citation d'un message disparu). Le stanzaId
 * de contextInfo identifie pourtant TOUJOURS l'original.
 *
 * Ce registre garde les N derniers messages reçus/émis (contenu brut,
 * enveloppes comprises) pour retrouver l'original par son ID :
 * borné (400 entrées) et caduc (2 h) — mémoire chaude, jamais sur disque.
 * Les vidéos que le BOT envoie passent aussi par messages.upsert (fromMe)
 * quand Baileys les échoe : y répondre fonctionne donc aussi.
 */

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

const store = new Map<string, { at: number; content: any }>();

function key(jid: string, id: string): string {
  return `${jid}:${id}`;
}

function prune(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}

/** Enregistre (ou rafraîchit) le contenu d'un message identifié par jid+id. */
export function recordRecentMessage(jid: string, id: string, content: any): void {
  if (!jid || !id || !content) return;
  prune();
  store.set(key(jid, id), { at: Date.now(), content });
  // Cap mémoire : éviction FIFO (l'insertion la plus ancienne d'abord).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Contenu brut du message (enveloppes comprises), ou null. */
export function getRecentMessage(jid: string, id: string): any | null {
  prune();
  const hit = store.get(key(jid, id));
  return hit ? hit.content : null;
}

/** Tests uniquement. */
export function __resetRecentMessagesForTests(): void {
  store.clear();
}
