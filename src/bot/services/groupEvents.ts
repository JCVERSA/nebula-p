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
import { cardAssetPath, isCardPreset, renderCard, type CardKind } from "./cardRenderer.js";

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

// ── 9.18pppp : avatar du membre (cache 10 min, échecs compris) ─────────────

interface AvatarCacheEntry {
  buf: Buffer | null;
  at: number;
}
const AVATAR_CACHE_TTL_MS = 10 * 60 * 1000;
const avatarCache = new Map<string, AvatarCacheEntry>();

/** Photo de profil du membre (Buffer) ou null — best effort, jamais bloquant. */
async function fetchAvatarBuffer(sock: any, jid: string): Promise<Buffer | null> {
  const cached = avatarCache.get(jid);
  if (cached && Date.now() - cached.at < AVATAR_CACHE_TTL_MS) return cached.buf;
  let buf: Buffer | null = null;
  try {
    const url = await sock.profilePictureUrl(jid, "image");
    if (url && /^https?:\/\//i.test(String(url))) {
      const res = await fetch(String(url), { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 100 && ab.byteLength < 3 * 1024 * 1024) buf = Buffer.from(ab);
      }
    }
  } catch {
    buf = null; // photo privée / indisponible → silhouette sur la card
  }
  avatarCache.set(jid, { buf, at: Date.now() });
  return buf;
}

/** Numéro lisible sur la card : +237 6 99 88 77 66. */
export function formatPhoneJid(jid: string): string {
  const d = String(jid || "").split("@")[0].replace(/\D/g, "");
  if (!d) return "Membre";
  if (d.length <= 4) return `+${d}`;
  const head = d.slice(0, -8) || d.slice(0, 2);
  const tail = d.slice(-8).replace(/(\d{2})(?=\d)/g, "$1 ");
  return `+${head} ${tail}`.trim();
}

/**
 * 9.18pppp — envoie la CARD (image + caption) si la config l'exige.
 * Retourne false quand il faut replier sur le message texte seul :
 * card désactivée, preset inconnu, plusieurs participants (anti-rafale :
 * pas de N cards d'un coup), asset introuvable ou rendu échoué.
 */
async function trySendCard(
  sock: any,
  gid: string,
  kind: CardKind,
  conf: { card?: { enabled: boolean; preset: string } },
  participants: string[],
  groupName: string,
  memberCount: number,
  caption: { text: string; mentions: string[] },
): Promise<boolean> {
  const card = conf.card;
  if (!card?.enabled || !isCardPreset(card.preset)) return false;
  if (participants.length !== 1) return false; // un seul départ/arrivée = une card
  try {
    const target = resolveLiveSocket(sock);
    const jid = participants[0]!;
    await typingPresence(target, gid);
    const asset = cardAssetPath(card.preset, kind);
    if (asset) {
      // Preset image (bannières owner) : art intact, mention en caption.
      await target.sendMessage(gid, { image: { url: asset }, caption: caption.text, mentions: caption.mentions });
      return true;
    }
    const avatar = await fetchAvatarBuffer(target, jid);
    const buf = await renderCard({
      kind,
      preset: card.preset,
      userName: formatPhoneJid(jid),
      userNumber: jid,
      avatar,
      groupName,
      memberCount,
    });
    if (!buf) return false; // rendu impossible → texte seul
    await target.sendMessage(gid, { image: buf, caption: caption.text, mentions: caption.mentions });
    return true;
  } catch {
    return false; // un envoi de card ne casse JAMAIS la notification
  }
}

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
      // 9.18pppp : card graphique si configurée, sinon message texte.
      const sent = await trySendCard(sock, gid, "welcome", conf, update.participants, name, size, rendered);
      if (!sent) await sendGroupMessage(sock, gid, rendered.text, rendered.mentions);
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
      const sent = await trySendCard(sock, gid, "goodbye", conf, update.participants, name, Math.max(0, size - update.participants.length), rendered);
      if (!sent) await sendGroupMessage(sock, gid, rendered.text, rendered.mentions);
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

/** Tests uniquement : vide le cache d'avatars. */
export function __resetAvatarCacheForTests(): void {
  avatarCache.clear();
}
