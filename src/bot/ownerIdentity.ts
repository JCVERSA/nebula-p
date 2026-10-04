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
      // Le PN revient sous forme "237640143760:0@s.whatsapp.net" — jidDigits
      // retire le suffixe de device AVANT l'extraction des digits.
      resolvedNumber = jidDigits(pnJid) || null;
    }
  } catch {
    resolvedNumber = null;
  }
  if (resolvedNumber && owners.includes(resolvedNumber)) {
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
        return { senderNumber, resolvedNumber: pn, isOwner: true };
      }
    } catch {}
  }

  // Dernier recours : NEBULA_OWNER_LID (comparaison exacte du LID).
  const lidOwners = numberCandidates(process.env.NEBULA_OWNER_LID);
  return { senderNumber, resolvedNumber, isOwner: lidOwners.includes(senderNumber) };
}
