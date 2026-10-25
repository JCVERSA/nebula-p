/**
 * 9.18mmmm — cibles de modération groupe (pures, testées).
 *
 * Trois sources de cibles, par ordre de priorité et fusionnées :
 *  1. mentions explicites du texte (contextInfo.mentionedJid) — caption ou
 *     texte étendu, enveloppes dépliées via normalizeMessageContent ;
 *  2. participant du message cité (reply) ;
 *  3. numéros de téléphone dans les args (« @2376… », « 2376… », « +2376… »).
 *
 * Sortie : JIDs @s.us dédupliqués, ordre stable, SANS le bot lui-même
 * (exclu ici — les commandes affichent un message dédié si on tente de
 * cibler le bot).
 */

import { normalizeMessageContent } from "@whiskeysockets/baileys";

export function groupJidOf(msg: any): string | null {
  const jid = String(msg?.key?.remoteJid || "");
  return jid.endsWith("@g.us") ? jid : null;
}

/** Le JID du bot, normalisé @s.us (sock.user.id peut porter un suffixe d'appareil ou être un LID). */
export function botJidOf(sock: any): string | null {
  const raw = sock?.user?.id || sock?.user?.lid;
  if (!raw) return null;
  const digits = String(raw).split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
  return digits.length >= 5 ? `${digits}@s.whatsapp.net` : null;
}

function unwrap(content: any): any {
  return (normalizeMessageContent(content as any) as any) || content;
}

/** JIDs mentionnés dans le texte du message (une seule passe, toutes les formes). */
function mentionedJidsOf(msg: any): string[] {
  const c = unwrap(msg?.message);
  if (!c || typeof c !== "object") return [];
  const out: string[] = [];
  for (const value of Object.values(c)) {
    const mentions = (value as any)?.contextInfo?.mentionedJid;
    if (Array.isArray(mentions)) out.push(...mentions.map(String));
  }
  return out;
}

/** Participant du message cité (reply), s'il existe. */
function quotedParticipantOf(msg: any): string | null {
  const c = unwrap(msg?.message);
  const ctx =
    c?.extendedTextMessage?.contextInfo ||
    c?.imageMessage?.contextInfo ||
    c?.videoMessage?.contextInfo ||
    c?.documentMessage?.contextInfo;
  const p = ctx?.participant;
  return p ? String(p) : null;
}

/** Numéros de téléphone nus dans les args (≥ 8 chiffres). */
function phoneTargetsFromArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const raw of args) {
    const digits = String(raw).replace(/[^0-9]/g, "");
    if (digits.length >= 8 && digits.length <= 15) out.push(`${digits}@s.whatsapp.net`);
  }
  return out;
}

/**
 * Toutes les cibles du message, dédupliquées. `botJid` est retiré de la
 * liste (les commandes gèrent le « cibler le bot » avec un message dédié).
 */
export function extractModerationTargets(msg: any, args: string[], botJid: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const jid of [...mentionedJidsOf(msg), ...(quotedParticipantOf(msg) ? [quotedParticipantOf(msg)!] : []), ...phoneTargetsFromArgs(args || [])]) {
    const clean = jid.split(":")[0];
    if (!clean || seen.has(clean)) continue;
    if (botJid && clean === botJid) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
