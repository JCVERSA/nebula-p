/**
 * 9.1 — Mémoire d'observation de l'agent (par chat).
 *
 * Pourquoi : l'agent exécute une commande, la commande répond DANS WhatsApp
 * (liste de sélection, choix de saison…), mais au tour SUIVANT l'agent
 * repart d'une page blanche — quand l'utilisateur répond « le 2e » ou
 * « en VF », l'agent ne sait plus à quoi ça se rapporte → boucle.
 *
 * Ce module garde, par chat, la dernière sortie de commande interactive
 * (les textes capturés par dispatchBotCommand) pendant 10 minutes :
 * le tour suivant de l'agent la reçoit dans son prompt et peut relier
 * la réponse naturelle de l'utilisateur au choix en attente.
 *
 * En mémoire uniquement (pas de fichier) : cette mémoire est courte par
 * nature ; un redémarrage du bot invalide de toute façon les sessions
 * interactives des commandes. AUCUN contenu de message n'y est journalisé.
 */

export interface AgentObservation {
  command: string;
  /** Textes capturés, dans l'ordre d'émission. */
  texts: string[];
  ts: number;
}

const TTL_MS = 10 * 60 * 1000;

/** Cap par observation : au-delà, on tronque les plus anciens. */
const MAX_CHARS = 2400;

const store = new Map<string, AgentObservation>();

function prune(): void {
  const now = Date.now();
  for (const [jid, obs] of store) {
    if (now - obs.ts > TTL_MS) store.delete(jid);
  }
}

/**
 * 9.13 (éco tokens, inspiré de free-claude-code) : compacte les sorties
 * répétitives AVANT stockage — une progression « ⏳ Épisode 4/12… » sur 12
 * lignes ne vaut pas 12 lignes de contexte agent. Pur — testé.
 *
 * Règle : dans un texte de plus de 8 lignes, si >60 % des lignes partagent
 * la même forme (chiffres/pourcentages neutralisés), on garde les 2
 * premières + un marqueur honnête + les 2 dernières. Les écrans de choix
 * interactifs (courts, non répétitifs) passent INTACTS.
 */
export function compactObservationTexts(texts: string[]): string[] {
  return texts.map((t) => {
    const lines = t.split("\n");
    if (lines.length <= 8) return t;
    const shape = (l: string) => l.replace(/\d+(?:[.,]\d+)?%?/g, "#").trim();
    const counts = new Map<string, number>();
    for (const l of lines) {
      const s = shape(l);
      if (s.length > 2) counts.set(s, (counts.get(s) || 0) + 1);
    }
    let best = 0;
    for (const n of counts.values()) if (n > best) best = n;
    if (best / lines.length <= 0.6) return t;
    return [...lines.slice(0, 2), `[… ${lines.length - 4} lignes similaires compactées …]`, ...lines.slice(-2)].join("\n");
  });
}

export function setLastObservation(chatJid: string, command: string, texts: string[]): void {
  if (!texts.length) return;
  texts = compactObservationTexts(texts);
  let total = 0;
  const kept: string[] = [];
  // On garde les DERNIERS textes (le choix en attente est en fin de flow).
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    if (total + t.length > MAX_CHARS && kept.length > 0) break;
    kept.unshift(t);
    total += t.length;
  }
  store.set(chatJid, { command, texts: kept, ts: Date.now() });
}

export function getLastObservation(chatJid: string): AgentObservation | null {
  prune();
  const obs = store.get(chatJid);
  if (!obs) return null;
  if (Date.now() - obs.ts > TTL_MS) return null;
  return obs;
}

/** Une sortie ressemble-t-elle à un écran qui attend un choix ? */
export function outputLooksInteractive(texts: string[]): boolean {
  const joined = texts.join("\n");
  // Écrans novabox réels : sélection d'anime, saison, épisodes, qualité.
  // La question de langue (« continuer en VOSTFR ? ») est VOLONTAIREMENT
  // absente : c'est une préférence utilisateur — l'agent ne doit jamais
  // y répondre à sa place, l'utilisateur répond directement (8.95b).
  return /👉\s*Répond(?:s|ez)\s+avec/i.test(joined) || /Sélectionnez l['’]/i.test(joined);
}

/** Bloc de contexte à injecter dans le prompt agent (null si rien de frais). */
export function observationContext(chatJid: string): string | null {
  const obs = getLastObservation(chatJid);
  if (!obs) return null;
  const ageMin = Math.max(1, Math.round((Date.now() - obs.ts) / 60_000));
  const body = obs.texts.join("\n—\n").slice(0, MAX_CHARS);
  return (
    `## Écran en attente dans ce chat (commande .${obs.command}, il y a ${ageMin} min)\n` +
    `Le bot a affiché ceci à l'utilisateur et attend une réponse :\n\n${body}\n\n` +
    `Si le message de l'utilisateur répond à cet écran (un numéro, « le 2e », « en VF », ` +
    `un titre de la liste…), exécute la commande qui choisit (ex. \`.a 2\`) au lieu de ` +
    `recommencer la recherche.`
  );
}

/** Test/vidage complet. */
export function __resetObservationsForTests(): void {
  store.clear();
}
