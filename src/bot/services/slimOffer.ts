/**
 * 9.18ddd — offres d'allègement (.slim), sur demande uniquement.
 *
 * Décision owner 17/10 : « il ne faut pas imposer la conversion à tous les
 * utilisateurs, il faut demander ; si oui on convertit, sinon on ne fait
 * rien ». Donc : un fichier lourd est livré IMMÉDIATEMENT en original (lien
 * /d/), accompagné d'une offre. Si l'utilisateur répond `.slim`, la version
 * allégée (2-pass, cible ~NEBULA_SLIM_TARGET_MB) est encodée et livrée à
 * côté. Sans réponse, il ne se passe rien — le fichier original et son lien
 * restent la livraison.
 *
 * Registre en mémoire, clé = JID du chat, UNE offre par chat (la plus
 * récente remplace), TTL 10 min — le fichier sous-jacent vit 30 min dans
 * le magasin temporaire, l'offre doit expirer bien avant.
 */

export interface SlimOffer {
  /** Chemin du fichier original DANS le magasin temporaire (lien /d/ actif). */
  tempFilePath: string;
  /** Lien /d/ public de l'original — l'encodeur GitHub le télécharge (9.18eee). */
  sourceUrl: string;
  filename: string;
  bytes: number;
  targetMB: number;
  /** Contexte pour le message de livraison de la version allégée. */
  meta: {
    title?: string;
    season?: string;
    episode?: string;
    resolution?: string;
    lang?: string;
    player?: string;
  };
  askedAt: number;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const offers = new Map<string, SlimOffer>();

/** Enregistre (ou remplace) l'offre d'un chat — purge les offres expirées. */
export function registerSlimOffer(chatJid: string, offer: Omit<SlimOffer, "askedAt" | "expiresAt">, now = Date.now()): SlimOffer {
  sweepExpiredSlimOffers(now);
  const full: SlimOffer = { ...offer, askedAt: now, expiresAt: now + TTL_MS };
  offers.set(chatJid, full);
  return full;
}

/** L'offre vivante d'un chat (null si absente/expirée). */
export function getSlimOffer(chatJid: string, now = Date.now()): SlimOffer | null {
  const o = offers.get(chatJid);
  if (!o) return null;
  if (now >= o.expiresAt) {
    offers.delete(chatJid);
    return null;
  }
  return o;
}

/** Consomme (retire) l'offre — l'utilisateur a répondu .slim. */
export function consumeSlimOffer(chatJid: string, now = Date.now()): SlimOffer | null {
  const o = getSlimOffer(chatJid, now);
  if (o) offers.delete(chatJid);
  return o;
}

/** Purge des offres expirées (appelée à chaque enregistrement). */
export function sweepExpiredSlimOffers(now = Date.now()): number {
  let n = 0;
  for (const [jid, o] of offers) {
    if (now >= o.expiresAt) {
      offers.delete(jid);
      n++;
    }
  }
  return n;
}

/** Tests uniquement. */
export function __resetSlimOffersForTests(): void {
  offers.clear();
}

/**
 * Pur : la ligne d'offre ajoutée à la livraison — la question, honnête sur
 * la cible et le temps (ETA 2-pass selon la taille).
 */
export function slimOfferLine(bytes: number, targetMB: number, etaMinutes: number): string {
  const mb = Math.round(bytes / (1024 * 1024));
  return (
    `⚖️ *${mb} Mo — c'est lourd ?* Réponds \`.slim\` pour une version allégée (~${targetMB} Mo, ` +
    `même résolution, ~${etaMinutes} min d'encodage) — ou ne fais rien, ce lien reste valable.`
  );
}
