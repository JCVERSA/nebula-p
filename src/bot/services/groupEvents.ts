/**
 * 9.18mmmm — événements groupe (welcome / goodbye), suite admin.
 *
 * Branché sur « group-participants-update » par botEngine. Règles :
 *  - welcome/goodbye DÉSACTIVÉS par défaut (jamais de message surprise) ;
 *  - variables : {user} (mention), {groupe} (nom réel du groupe, jamais codé),
 *    {count} (taille du groupe) ;
 *  - anti-spam : 5 arrivées ou plus d'un coup (ajout massif) → UN seul
 *    message récapitulatif, pas 5 messages individuels ;
 *  - le nom du groupe est mis en cache 10 min (jamais de requête metadata
 *    par arrivée) ;
 *  - NE JAMAIS lancer : toute erreur est avalée (un événement groupe ne
 *    peut pas tuer le moteur) ;
 *  - typing presence avant envoi (humanisation, axe F).
 */

import { resolveLiveSocket } from "../liveSocket.js";
import { typingPresence } from "./humanize.js";
import { getWelcome, getGoodbye, DEFAULT_WARN_TEXT, DEFAULT_GOODBYE_TEXT } from "./groupSettingsStore.js";

export interface ParticipantsUpdate {
  id: string;
  action: string;
  participants: string[];
}

interface GroupNameCacheEntry {
  name: string;
  size: number;
  at: number;
}

const NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const nameCache = new Map<string, GroupNameCacheEntry>();

async function groupName(sock: any, gid: string): Promise<GroupNameCacheEntry> {
  const cached = nameCache.get(gid);
  if (cached && Date.now() - cached.at < NAME_CACHE_TTL_MS) return cached;
  let entry: GroupNameCacheEntry = { name: "le groupe", size: 0, at: Date.now() };
  try {
    const meta = await sock.groupMetadata(gid);
    if (meta?.subject) entry = { name: String(meta.subject).slice(0, 60), size: Number(meta?.size) || (Array.isArray(meta?.participants) ? meta.participants.length : 0), at: Date.now() };
  } catch {
    /* cache une valeur de repli — jamais d'échec visible */
  }
  nameCache.set(gid, entry);
  return entry;
}

/** Remplace les variables du gabarit — pur, testé. */
export function renderGroupTemplate(
  template: string,
  vars: { userJids: string[]; groupName: string; memberCount: number },
): { text: string; mentions: string[] } {
  const mentions = vars.userJids.filter(j => j.endsWith("@s.whatsapp.net"));
  // Mention WhatsApp réelle : le texte doit contenir @<numéro> (pas un
  // placeholder) pour que le client rende la pastille cliquable.
  const userTag = mentions.length > 0 ? mentions.map(j => `@${j.split("@")[0]}`).join(", ") : "nouveau membre";
  const text = String(template || "")
    .split("{user}").join(userTag)
    .split("{groupe}").join(vars.groupName)
    .split("{count}").join(String(vars.memberCount));
  return { text, mentions };
}

/** Envoie un message de groupe avec mentions — via le socket vivant. */
async function sendGroupMessage(sock: any, gid: string, text: string, mentions: string[]): Promise<void> {
  const target = resolveLiveSocket(sock);
  await typingPresence(target, gid);
  await target.sendMessage(gid, { text, mentions });
}

const BURST_RECAP_THRESHOLD = 5;

/**
 * Traite un événement participants-update. Ne lance JAMAIS (l'appelant
 * enveloppe déjà, mais la défense en profondeur est la règle maison).
 */
export async function handleGroupParticipantsUpdate(sock: any, update: ParticipantsUpdate): Promise<void> {
  try {
    const gid = String(update?.id || "");
    if (!gid.endsWith("@g.us") || !Array.isArray(update?.participants) || update.participants.length === 0) return;
    const action = String(update.action || "");

    if (action === "add") {
      const conf = getWelcome(gid);
      if (!conf.enabled) return;
      const { name, size } = await groupName(sock, gid);
      // Anti-spam : arrivée massive → UN récap, pas N messages.
      if (update.participants.length >= BURST_RECAP_THRESHOLD) {
        const text = `👋 ${update.participants.length} nouveaux membres rejoignent *${name}* — bienvenue à tous !`;
        // Mentions complètes : chaque nouvel arrivant est notifié, en un seul message.
        await sendGroupMessage(sock, gid, text, update.participants);
        return;
      }
      const rendered = renderGroupTemplate(conf.text || DEFAULT_WARN_TEXT, {
        userJids: update.participants,
        groupName: name,
        memberCount: size,
      });
      await sendGroupMessage(sock, gid, rendered.text, rendered.mentions);
      return;
    }

    if (action === "remove" || action === "leave") {
      const conf = getGoodbye(gid);
      if (!conf.enabled) return;
      const { name, size } = await groupName(sock, gid);
      const rendered = renderGroupTemplate(conf.text || DEFAULT_GOODBYE_TEXT, {
        userJids: update.participants,
        groupName: name,
        memberCount: Math.max(0, size - update.participants.length),
      });
      await sendGroupMessage(sock, gid, rendered.text, rendered.mentions);
      return;
    }
    // promote / demote / etc. : rien à publier.
  } catch {
    /* un événement groupe ne tue jamais le moteur */
  }
}

/** Tests uniquement : vide le cache de noms. */
export function __resetGroupNameCacheForTests(): void {
  nameCache.clear();
}
