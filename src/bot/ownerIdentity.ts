/**
 * Identité owner & résolution LID (8.89).
 *
 * Contexte terrain (2026-10-03) : l'owner écrit au bot depuis un jid @lid —
 * WhatsApp « masquer mon numéro » / passage aux identifiants LID. Le gate
 * owner comparait le numéro du jid (le LID, ex. …5378) au OWNER_NUMBER
 * (numéro réel, ex. …3760) → jamais égal → `.purge` refusé à l'owner
 * lui-même. Le vrai numéro de l'owner et OWNER_NUMBER concordent ; seule
 * l'identité WhatsApp du message diffère.
 *
 * Résolution : Baileys 7 maintient une table LID↔numéro
 * (sock.signalRepository.lidMapping.getPNForLID) — on lui demande le numéro
 * réel derrière un jid @lid, puis la comparaison EXACTE (esprit C7, audit
 * 8.84 : jamais de correspondance partielle) se fait comme avant.
 *
 * 8.89b : si la direction LID→numéro ignore la paire, on tente la
 * direction INVERSE (numéro→LID pour chaque owner configuré) — celle-ci
 * sait interroger le serveur WhatsApp (USync), donc elle réussit même à
 * froid, avec OWNER_NUMBER seul.
 *
 * Filet de sécurité final : NEBULA_OWNER_LID (env optionnel, digits du LID
 * complet de l'owner — lisible via `.whois` en privé). Comparaison exacte
 * là aussi : un LID est unique et infalsifiable.
 *
 * Zéro régression : pour un jid téléphone (le cas commun), le comportement
 * est IDENTIQUE à l'ancien calcul (comparaison directe, aucun appel Baileys).
 */

/** Minimal structural type : évite d'importer les types Baileys ici. */
export interface LidMappingLike {
  getPNForLID?(lid: string): Promise<string | null>;
  /** 8.89b : direction inverse — sait interroger le serveur WhatsApp (USync). */
  getLIDForPN?(pn: string): Promise<string | null>;
}
export interface OwnerSockLike {
  signalRepository?: { lidMapping?: LidMappingLike } | null;
}

export interface OwnerIdentity {
  /** Digits du jid tel quel (numéro, ou digits du LID si jid @lid). */
  senderNumber: string;
  /** Numéro WhatsApp réel si un jid @lid a été résolu, sinon null. */
  resolvedNumber: string | null;
  isOwner: boolean;
}

/** Digits du jid : partie user, suffixe de device (":0") EXCLU, puis digits purs. */
function jidDigits(jid: string): string {
  const user = (jid.split("@")[0] || "").split(":")[0] || "";
  return user.replace(/[^0-9]/g, "");
}

/** Découpe une config (OWNER_NUMBER / NEBULA_OWNER_LID) en candidats digits. */
function numberCandidates(raw: string | null | undefined): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  return s.split(/[^0-9]+/).filter(Boolean);
}

// ── 9.16b → 9.18yy — mémoire process des LID owner reconnus ────────────────
//
// Retour terrain : l'owner s'est banni LUI-MÊME depuis le dashboard. Le gate
// moteur l'a correctement ignoré (isOwner bypass), mais sa fiche affichait
// « BANNI » — un état mensonger. Cause : les routes panneau ne voient que des
// digits, et le jid LID de l'owner (masquage du numéro) ≠ OWNER_NUMBER.
//
// Quand resolveOwnerIdentity reconnaît un jid @lid comme owner (via la table
// Baileys), on mémorise ses digits : les routes du MÊME process moteur
// (ban du gestionnaire d'utilisateurs, badge OWNER) peuvent alors refuser
// honnêtement. Froid (avant le 1er message) : NEBULA_OWNER_LID couvre la
// garde route, et le gate moteur reste la protection réelle dans tous les cas.
//
// 9.18yy : la mémoire devient lid → PN (quand il est connu) — les envois
// PROACTIFS du moteur (digest, « bot en ligne », réponses télécommande)
// livrent alors directement au LID (voir ownerDeliveryJid, F6 audit 16/10).

const knownOwnerLids = new Map<string, string | null>();

/** Le jid (@lid ou téléphone) est-il un LID owner reconnu ce cycle de vie ? */
export function isKnownOwnerLid(jid: string): boolean {
  const d = jidDigits(jid);
  return !!d && knownOwnerLids.has(d);
}

function rememberOwnerLid(jid: string, pn: string | null): void {
  const d = jidDigits(jid);
  if (d) knownOwnerLids.set(d, pn);
}

/** Tests uniquement. */
export function __resetOwnerLidsForTests(): void {
  knownOwnerLids.clear();
}

/**
 * 9.18yy (F6 audit 16/10) — jid de LIVRAISON de l'owner pour les envois
 * proactifs du moteur (digest 8 h, « bot en ligne », réponses télécommande).
 *
 * Terrain : l'owner est derrière un LID (masquage du numéro). WhatsApp route
 * le PN vers le LID « au mieux » — certains matins le digest peut se perdre.
 * Quand le moteur a mémorisé le LID de CET owner (résolution Baileys au
 * 1er message), on livre directement au LID ; à froid, NEBULA_OWNER_LID
 * couvre ; sinon le PN configuré (comportement historique inchangé).
 * Retourne "" si aucun PN exploitable (l'appelant garde sa garde).
 */
export function ownerDeliveryJid(pnDigits: string): string {
  const pn = (pnDigits || "").replace(/[^0-9]/g, "");
  if (pn) {
    for (const [lid, mappedPn] of knownOwnerLids) {
      if (mappedPn === pn) return `${lid}@lid`;
    }
  }
  const envLid = numberCandidates(process.env.NEBULA_OWNER_LID)[0];
  if (envLid) return `${envLid}@lid`;
  return pn ? `${pn}@s.whatsapp.net` : "";
}

/**
 * Résout l'identité d'un expéditeur et décide s'il est l'owner.
 * Ne jette JAMAIS (toute défaillance de résolution → non-owner, pas de crash).
 */
export async function resolveOwnerIdentity(
  sock: OwnerSockLike | null | undefined,
  senderJid: string,
  ownerCfg: string | null | undefined
): Promise<OwnerIdentity> {
  const senderNumber = jidDigits(senderJid);
  const owners = numberCandidates(ownerCfg);
  const isLid = senderJid.endsWith("@lid");

  if (owners.length === 0) {
    return { senderNumber, resolvedNumber: null, isOwner: false };
  }

  // Cas commun : jid téléphone — comparaison directe, inchangée depuis 8.59.
  if (!isLid) {
    return { senderNumber, resolvedNumber: null, isOwner: owners.includes(senderNumber) };
  }

  // Jid @lid : demander le numéro réel à la table Baileys.
  let resolvedNumber: string | null = null;
  try {
    const pnJid = await sock?.signalRepository?.lidMapping?.getPNForLID?.(senderJid);
    if (typeof pnJid === "string" && pnJid) {
      // Le PN revient sous forme "<numéro>:0@s.whatsapp.net" — jidDigits
      // retire le suffixe de device AVANT l'extraction des digits.
      resolvedNumber = jidDigits(pnJid) || null;
    }
  } catch {
    resolvedNumber = null;
  }
  if (resolvedNumber && owners.includes(resolvedNumber)) {
    rememberOwnerLid(senderJid, resolvedNumber); // 9.16b routes panneau + 9.18yy livraison LID
    return { senderNumber, resolvedNumber, isOwner: true };
  }

  // 8.89b : résolution INVERSE — demander à Baileys le LID de chaque numéro
  // owner configuré. Cette direction sait interroger le serveur WhatsApp
  // (USync) quand la paire n'est ni en cache ni dans le store, donc elle
  // réussit même à froid — avec OWNER_NUMBER seul, zéro configuration.
  // Suffixe de device éliminé par jidDigits avant comparaison exacte.
  for (const pn of owners) {
    try {
      const lidJid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(`${pn}@s.whatsapp.net`);
      if (typeof lidJid === "string" && lidJid && jidDigits(lidJid) === senderNumber) {
        rememberOwnerLid(senderJid, pn); // 9.16b + 9.18yy livraison LID
        return { senderNumber, resolvedNumber: pn, isOwner: true };
      }
    } catch {}
  }

  // Dernier recours : NEBULA_OWNER_LID (comparaison exacte du LID).
  const lidOwners = numberCandidates(process.env.NEBULA_OWNER_LID);
  if (lidOwners.includes(senderNumber)) rememberOwnerLid(senderJid, null); // 9.16b (PN non mappé)
  return { senderNumber, resolvedNumber, isOwner: lidOwners.includes(senderNumber) };
}
