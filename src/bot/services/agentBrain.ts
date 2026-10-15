/**
 * 8.93 — Cerveau pur de l'agent IA (beta, privé uniquement).
 *
 * Aucune dépendance réseau ou Baileys ici : tout est testable à plat.
 * L'orchestration (appels IA, exécution, messages) vit dans agentRunner.ts.
 *
 * Décisions owner :
 *  - l'IA traduit une demande naturelle en commande EXISTANTE du bot ;
 *  - elle exécute EN TANT QUE l'utilisateur (RoleGuard s'applique) ;
 *  - léger = direct, lourd = confirmation explicite (fail-closed) ;
 *  - max 10 exécutions/heure/utilisateur (anti-boucle, leçon budget
 *    Laudacode) en plus du quota IA quotidien ;
 *  - en groupe : JAMAIS d'exécution (beta) — l'IA guide seulement.
 */

import type { AnimeSourceId } from "./animeSources.js";

// ── Décision renvoyée par l'IA ─────────────────────────────────────────────

export type AgentDecision =
  | { action: "execute"; command: string; args: string; say?: string }
  | { action: "ask"; text: string }
  | { action: "reply"; text: string };

/**
 * Extrait la décision JSON de la réponse de l'IA, en tolérant les fences
 * ```json et le texte parasite autour. Zéro confiance : forme validée
 * champ par champ, toute déviation → null (dégradation en guidage).
 */
export function parseAgentDecision(raw: string): AgentDecision | null {
  if (!raw || typeof raw !== "string") return null;
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: any;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const action = String(obj.action || "").toLowerCase();
  if (action === "execute") {
    const command = String(obj.command || "").trim().toLowerCase();
    if (!/^[a-z0-9]+$/.test(command)) return null;
    const args = typeof obj.args === "string" ? obj.args.trim().slice(0, 400) : "";
    const say = typeof obj.say === "string" && obj.say.trim() ? obj.say.trim().slice(0, 300) : undefined;
    return { action: "execute", command, args, say };
  }
  if (action === "ask" || action === "reply") {
    const text = String(obj.text || "").trim();
    if (!text || text.length > 2000) return null;
    return { action, text };
  }
  return null;
}

// ── Denylist : commandes que l'agent n'invoquera JAMAIS ────────────────────

/** L'IA ne doit jamais s'invoquer elle-même (boucle) ni mobiliser .ai. */
export const AGENT_DENYLIST: ReadonlySet<string> = new Set(["agent", "ai"]);

export function isAgentDeniedCommand(canonicalName: string): boolean {
  return AGENT_DENYLIST.has(canonicalName.toLowerCase());
}

// ── Table de risque : léger (direct) vs lourd (confirmation) ───────────────

/** Commandes toujours lourdes, quel que soit l'appelant. */
const HEAVY_NAMES: ReadonlySet<string> = new Set(["purge", "watch"]);

/**
 * Une demande est LOURDE si :
 *  - la commande est purge/watch (actions système ou récurrentes) ;
 *  - la commande est owner-only/admin-only (puissance élevée) ;
 *  - anime multi-épisodes (all, plage 1-5, liste 2,5, saison entière d-) ;
 *  - playlist YouTube (9.11 audit B2 : jusqu'à 25 vidéos, ~75 min de yt-dlp
 *    et 2 Go — le même ordre de grandeur qu'une saison animée confirmée).
 */
export function isHeavyAgentCommand(
  command: { name: string; ownerOnly?: boolean; adminOnly?: boolean },
  args: string[]
): boolean {
  const name = command.name.toLowerCase();
  if (HEAVY_NAMES.has(name)) return true;
  if (command.ownerOnly || command.adminOnly) return true;
  if (name === "anime") {
    const a = args.join(" ").toLowerCase();
    if (/(^|\s)(all|d-)(\s|$)/.test(a)) return true;
    if (/\d+\s*-\s*\d+/.test(a)) return true;
    if (/\d+,\d+/.test(a)) return true;
  }
  if (name === "ytvideo" && /(^|\s)(playlist|pl)(\s|$)/.test(args.join(" ").toLowerCase())) return true;
  return false;
}

// ── Budget d'exécutions : 10/heure/utilisateur (fenêtre glissante) ─────────

const AGENT_EXEC_PER_HOUR = 10;
const AGENT_WINDOW_MS = 60 * 60 * 1000;
const execLog = new Map<string, number[]>();

export function checkAgentBudget(sender: string, now = Date.now()): boolean {
  const log = (execLog.get(sender) || []).filter((t) => now - t < AGENT_WINDOW_MS);
  execLog.set(sender, log);
  persistState(); // 9.18w : le prune compte comme mutation
  return log.length < AGENT_EXEC_PER_HOUR;
}

export function recordAgentExecution(sender: string, now = Date.now()): void {
  const log = (execLog.get(sender) || []).filter((t) => now - t < AGENT_WINDOW_MS);
  log.push(now);
  execLog.set(sender, log);
  persistState(); // 9.18w
}

/** Tests uniquement. */
export function __resetAgentStateForTests(): void {
  execLog.clear();
  pending.clear();
  stateSink = null;
}

// ── Confirmations en attente (fail-closed, TTL 2 min) ──────────────────────

export interface AgentPending {
  command: string;
  args: string[];
  say?: string;
  expiresAt: number;
}

const PENDING_TTL_MS = 2 * 60 * 1000;
const pending = new Map<string, AgentPending>();

export function setPendingConfirmation(sender: string, p: Omit<AgentPending, "expiresAt">, now = Date.now()): void {
  pending.set(sender, { ...p, expiresAt: now + PENDING_TTL_MS });
  persistState(); // 9.18w
}

/** Lit sans consommer ; retourne null si absent ou expiré. */
export function peekPendingConfirmation(sender: string, now = Date.now()): AgentPending | null {
  const p = pending.get(sender);
  if (!p) return null;
  if (now > p.expiresAt) {
    pending.delete(sender);
    persistState(); // 9.18w : expiration = mutation
    return null;
  }
  return p;
}

/** Lit ET consomme (l'appelant a décidé d'agir dessus). */
export function takePendingConfirmation(sender: string, now = Date.now()): AgentPending | null {
  const p = peekPendingConfirmation(sender, now);
  pending.delete(sender);
  persistState(); // 9.18w
  return p;
}

export function clearPendingConfirmation(sender: string): void {
  pending.delete(sender);
  persistState(); // 9.18w
}

// ── 9.18w : persistance optionnelle de l'état volatil ─────────────────────

/**
 * État sérialisable de l'agent : confirmations en attente + budget horaire.
 * Le cerveau reste PUR — c'est l'orchestration (agentStateStore, câblé au
 * boot par server.ts) qui branche le sink disque. Aucun texte utilisateur :
 * commandes, args (déjà audités) et TTL uniquement.
 */
export interface AgentPersistedState {
  pending: Array<[sender: string, p: AgentPending]>;
  execLog: Array<[sender: string, ts: number[]]>;
}

let stateSink: ((s: AgentPersistedState) => void) | null = null;

/** Branche (ou débranche) la persistance. Tests purs : jamais branchée. */
export function setAgentStateSink(fn: ((s: AgentPersistedState) => void) | null): void {
  stateSink = fn;
}

function persistState(): void {
  if (!stateSink) return;
  try {
    stateSink({ pending: [...pending.entries()], execLog: [...execLog.entries()] });
  } catch {}
}

/**
 * Restaure un état sauvegardé (boot après redémarrage). Fail-closed :
 * confirmations expirées et entrées de budget hors fenêtre glissante sont
 * jetées, formes invalides ignorées — au pire on redemande une confirmation.
 */
export function restoreAgentState(s: AgentPersistedState, now = Date.now()): void {
  pending.clear();
  execLog.clear();
  for (const entry of Array.isArray(s?.pending) ? s.pending : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") continue;
    const p = entry[1];
    if (typeof p.command !== "string" || !Array.isArray(p.args) || typeof p.expiresAt !== "number") continue;
    if (now > p.expiresAt) continue; // déjà expirée au moment du boot
    pending.set(entry[0], {
      command: p.command,
      args: p.args.map((a) => String(a)),
      say: typeof p.say === "string" ? p.say : undefined,
      expiresAt: p.expiresAt
    });
  }
  for (const entry of Array.isArray(s?.execLog) ? s.execLog : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
    const kept = entry[1].filter((t) => typeof t === "number" && Number.isFinite(t) && now - t < AGENT_WINDOW_MS);
    if (kept.length) execLog.set(entry[0], kept);
  }
}

/**
 * Fail-closed : SEULES ces réponses comptent comme une confirmation.
 * Tout autre message (question, bla-bla, « non », TTL dépassé) = pas
 * d'exécution — la demande en cours est simplement remplacée.
 */
const AFFIRMATIVES: ReadonlySet<string> = new Set([
  "ok", "oks", "okay", "oui", "yes", "y", "go", "vas-y", "vasy",
  "confirme", "confirmer", "execute", "exécute", "lance", "fais-le", "fais le",
  "c'est parti", "c est parti", "go ahead",
]);

export function isConfirmationAffirmative(text: string): boolean {
  const t = text
    .toLowerCase()
    .trim()
    .replace(/^[!.…\s]+/, "")
    .replace(/[!.…\s]+$/, "")
    .replace(/[’']/g, "'")
    .replace(/vas y/, "vas-y");
  return AFFIRMATIVES.has(t);
}

// ── Hint « autre catalogue » (politique langue anime, animeSources.ts) ─────

/**
 * Vrai quand une réponse de la commande signale qu'il manque la langue
 * demandée sur le catalogue courant et suggère l'autre catalogue. Chaînes
 * stables émises par applyLanguagePolicy (en-tête ℹ️ VF absente, échec
 * VOSTFR, guideHint). L'agent peut alors proposer DÉTERMINISTEMENT le
 * même one-liner sur l'autre catalogue (pas d'appel IA nécessaire).
 */
export function replySuggestsOtherCatalog(text: string): boolean {
  return /aucune vf pour ce titre|aucun vostfr pour ce titre|l'autre catalogue/i.test(text || "");
}

/**
 * Bascule le one-liner anime sur l'autre catalogue :
 * [titre, s2, e1] → [va, titre, s2, e1] ; [va, titre, …] → [titre, …].
 */
/**
 * 8.99 — guardrail d'arguments (leçon OpenAI Agents SDK : guardrails en
 * entrée de l'exécution, pas seulement sur le nom de commande). L'IA ne
 * doit JAMAIS pouvoir glisser une URL, des backticks ou des flags shell
 * dans les args d'une commande autorisée. Pur et testé à plat.
 * Retourne les args nettoyés + un flag quand quelque chose a bougé
 * (l'appelant audite l'événement — exécution avec les args nettoyés,
 * la commande revalide ses arguments de toute façon).
 */
export function sanitizeAgentArgs(
  args: string[],
  opts: { allowUrls?: boolean } = {}
): { args: string[]; changed: boolean } {
  const MAX_TOTAL = 200;
  const MAX_TOKEN = 80;
  // 9.3b : les commandes qui DÉCLARENT prendre des URLs (acceptsUrlArgs —
  // ytv, sweb, fetch, tiktok, instagram) les préservent, avec leur propre
  // cap (une URL légitime dépasse souvent 80 chars) et hors budget total.
  // Retour terrain 9.3 : « .ytv <url> 360p » devenait « .ytv 360p » → le
  // bot cherchait « 360p » comme titre de vidéo.
  const MAX_URL_TOKEN = 500;
  const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
  const cleaned: string[] = [];
  let changed = false;
  for (const raw of args) {
    let token = String(raw ?? "");
    const before = token;
    if (URL_RE.test(token)) {
      if (opts.allowUrls) {
        // URL légitime pour CETTE commande : préservée en place (cap
        // dédié) — l'ordre des arguments compte (url puis qualité).
        if (token.length > MAX_URL_TOKEN) token = token.slice(0, MAX_URL_TOKEN);
        if (token !== before) changed = true;
        cleaned.push(token);
        continue;
      }
      token = "";
    }
    token = token.replace(/[`*'"]+/g, "");
    if (/^--\w+/.test(token)) token = "";
    if (token.length > MAX_TOKEN) token = token.slice(0, MAX_TOKEN);
    if (token !== before) changed = true;
    if (token) cleaned.push(token);
  }
  // Les tokens URL préservés ne comptent pas dans le budget « texte ».
  const total = cleaned.filter((t) => !URL_RE.test(t)).join(" ");
  if (total.length > MAX_TOTAL) {
    // Coupe au dernier token TEXTE complet qui tient dans le budget —
    // les URLs restent quoi qu'il arrive (elles sont la cible).
    const kept: string[] = [];
    let len = 0;
    for (const t of cleaned) {
      if (URL_RE.test(t)) { kept.push(t); continue; }
      if (len + t.length + 1 > MAX_TOTAL) break;
      kept.push(t);
      len += t.length + 1;
    }
    if (kept.length !== cleaned.length) {
      cleaned.length = 0;
      cleaned.push(...kept);
      changed = true;
    }
  }
  return { args: cleaned, changed };
}

/**
 * 8.94/8.96 — bascule vers l'AUTRE catalogue : va ↔ as, en respectant le
 * catalogue par défaut (fourni par l'appelant — va depuis 8.96, via
 * effectiveDefaultSource()). Un one-liner nu vise le défaut ; si l'autre
 * catalogue EST le défaut, le flag disparaît (commande nu).
 */
export function toggleCatalogFlag(args: string[], defaultSource: AnimeSourceId): string[] {
  const first = args[0]?.toLowerCase();
  const flagged = first === "va" || first === "as";
  const current: AnimeSourceId = flagged ? first : defaultSource;
  const rest = flagged ? args.slice(1) : args;
  const target: AnimeSourceId = current === "va" ? "as" : "va";
  return target === defaultSource ? rest : [target, ...rest];
}

// ── 9.18x (P1) : « épisode suivant » déterministe — zéro token IA ──────────

/**
 * Contexte minimal exigé (structurellement compatible avec AnimeChoiceRecord
 * du service animeChoices — l'appelant passe le dernier choix du chat tel
 * quel, sans conversion : le cerveau ne dépend d'aucun module externe).
 */
export interface NextEpisodeContext {
  title: string;
  source: string;
  seasonName: string;
  quality: string;
  lastEpisode: number | null;
}

/**
 * Phrases qui désignent CLAIREMENT l'épisode suivant. « la suite » seule est
 * VOLONTAIREMENT exclue : ambigu (saison suivante possible) → chemin IA.
 */
const NEXT_EP_PHRASE_RE =
  /(?:^|\s)(?:épisode|episode|ép|ep)\s+(?:suivant|suivante|suivants|suivantes|d\s*(?:après|apres))(?:\s|$)|(?:^|\s)prochain(?:e|s)?\s+(?:épisode|episode|ép|ep)(?:\s|$)|(?:^|\s)next\s+episode(?:\s|$)/i;

/** Vocabulaire de l'intention : ne porte aucune information autre que l'intention. */
const NEXT_EP_VOCAB = new Set([
  "épisode", "episode", "ép", "ep", "suivant", "suivante", "suivants", "suivantes",
  "prochain", "prochaine", "prochains", "prochaines", "d", "après", "apres", "next"
]);

/** Mots creux (politesse, articles, verbes de demande) tolérés autour de l'intention. */
const NEXT_EP_FILLER = new Set([
  "le", "la", "les", "l", "un", "une", "du", "de", "des", "moi", "donne", "donnes", "donnez",
  "peux", "peut", "pouvez", "tu", "te", "t", "stp", "svp", "please", "si", "plait", "plaît",
  "il", "vous", "me", "m", "j", "je", "on", "nous", "en", "va", "vas", "y", "cherche", "cherchez",
  "trouve", "trouves", "veux", "veut", "voudrais", "aimerais", "hey", "salut", "hola", "holà",
  "bot", "file", "passe", "envoi", "envoie", "montre", "lance", "lances", "dis", "dit", "fais",
  "fait", "c", "est", "quoi", "et", "puis", "allez", "allons", "go", "encore", "avec", "pour"
]);

/**
 * 9.18x (P1, plan owner « crée ton propre plan ») — la demande la plus
 * courante après un téléchargement est « l'épisode suivant », et l'historique
 * anime du chat contient déjà TOUT (titre, catalogue, saison, dernier
 * épisode, qualité). Décision calculée localement : ZÉRO appel IA, ZÉRO quota
 * consommé — même esprit que la bascule catalogue déterministe (8.94/8.96).
 *
 * Fail-open : le moindre doute (titre mentionné dans le message, qualité
 * différente demandée, historique incomplet, saison illisible, phrase qui
 * dépasse la simple intention) → null, le chemin IA normal prend le relais.
 * Zéro confiance sur l'historique : chaque champ est revalidé.
 */
export function deterministicNextEpisodeDecision(
  text: string,
  last: NextEpisodeContext | null
): AgentDecision | null {
  if (!last || typeof text !== "string") return null;
  const title = String(last.title || "").trim();
  if (!title) return null;
  const lastEp =
    typeof last.lastEpisode === "number" && Number.isFinite(last.lastEpisode)
      ? Math.floor(last.lastEpisode)
      : null;
  if (lastEp === null || lastEp < 1) return null;
  const seasonMatch = String(last.seasonName || "").match(/\d+/);
  if (!seasonMatch) return null;
  const source = String(last.source || "").toLowerCase();
  if (source !== "va" && source !== "as") return null;
  const nextEp = lastEp + 1;
  if (nextEp > 500) return null; // historique aberrant → pas de décision locale

  const norm = text.toLowerCase().replace(/[\u2019\u2018\u0060\u00B4]/g, "'").replace(/\s+/g, " ").trim();
  if (!NEXT_EP_PHRASE_RE.test(norm.replace(/'/g, " "))) return null;

  // Le message ne doit RIEN désigner d'autre : ni titre, ni numéro, ni
  // qualité — chaque token restant doit être de l'intention ou un mot creux.
  const tokens = norm.split(/[\s'\u2019,.!?;:()\-\u2013\u2014]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 10) return null;
  for (const tok of tokens) {
    if (!NEXT_EP_VOCAB.has(tok) && !NEXT_EP_FILLER.has(tok)) return null;
  }

  const quality = String(last.quality || "").trim().toLowerCase();
  const args = [
    source,
    ...title.split(/\s+/).filter(Boolean),
    `s${seasonMatch[0]}`,
    `e${nextEp}`,
    ...(quality ? [quality] : [])
  ];
  return {
    action: "execute",
    command: "anime",
    args: args.join(" "),
    say: `⚡ La suite — épisode ${nextEp} !`
  };
}

// ── 9.18cc (P8) : demandes doubles liées (« X ET Y ») ───────────────────────

/** Familles d'intention détectables par mots-clés (une par domaine). */
// NB : \b (ASCII) ne coupe pas autour des accents (é ∉ \w) — frontières
// Unicode via lookarounds \p{L}\p{N}, sinon « épisode »/« chanson » ne
// matchaient pas et « et » matchait dans « été ».
const MULTI_INTENT_FAMILIES: Array<{ name: string; re: RegExp }> = [
  { name: "anime", re: /(?<![\p{L}\p{N}])(animes?|épisodes?|episodes?|ép|ep|saisons?|novabox)(?![\p{L}\p{N}])/iu },
  { name: "musique", re: /(?<![\p{L}\p{N}])(chansons?|musiques?|génériques?|generiques?|song|audio|mp3)(?![\p{L}\p{N}])/iu },
  { name: "youtube", re: /(?<![\p{L}\p{N}])(youtube|vidéos?|videos?|yt)(?![\p{L}\p{N}])/iu },
  { name: "social", re: /(?<![\p{L}\p{N}])(tiktok|instagram|reels?|insta)(?![\p{L}\p{N}])/iu },
  { name: "web", re: /(?<![\p{L}\p{N}])(résume|resume|article|pages?)(?![\p{L}\p{N}])/iu },
  { name: "traduction", re: /(?<![\p{L}\p{N}])(traduis|traduction)(?![\p{L}\p{N}])/iu }
];

/** Mots qui lient deux demandes dans une même phrase. */
const MULTI_INTENT_LINKERS = /(?<![\p{L}\p{N}])(et|puis|ensuite|aussi|également|en plus)(?![\p{L}\p{N}])/iu;

/**
 * 9.18cc (P8, plan owner) — « télécharge l'épisode 1 ET la chanson du
 * générique » : vrai quand le message contient un mot de liaison ET des
 * mots-clés d'AU MOINS DEUX familles d'intention distinctes. Pur, éco :
 * une seule famille (« mushoku s1 e5 et e6 ») ou pas de liaison → false,
 * aucun tour IA de relance inutile.
 */
export function messageSuggestsMultiIntent(text: string): boolean {
  const t = String(text || "");
  if (!t || t.length > 400) return false;
  if (!MULTI_INTENT_LINKERS.test(t)) return false;
  let families = 0;
  for (const f of MULTI_INTENT_FAMILIES) {
    if (f.re.test(t)) families++;
    if (families >= 2) return true;
  }
  return false;
}

// ── Observation compacte : la queue des écrans interactifs ─────────────────

/**
 * 9.18w (audit 9.18, point 2) — les écrans interactifs mettent leur
 * consigne (« 👉 Réponds avec .a 1 ») à la FIN de leur sortie ; une coupe
 * head-only la perdait et l'agent redemandait une info déjà affichée
 * (retour terrain 13/10). On garde la tête (contexte) ET la queue
 * (consigne + dernières entrées de liste), dans le budget imparti. Pur.
 */
export function keepHeadAndTail(text: string, maxChars: number): string {
  const t = String(text ?? "");
  const max = Math.floor(maxChars);
  if (!(max > 0)) return "";
  if (t.length <= max) return t;
  if (max < 24) return t.slice(0, max); // budget dégénéré : coupe simple
  const MARKER = "\n[…]\n";
  const tail = Math.min(700, Math.max(80, Math.floor(max / 3)));
  const head = max - MARKER.length - tail;
  return t.slice(0, head) + MARKER + t.slice(t.length - tail);
}

// ── Rattrapage : réponse de l'IA après une commande en erreur ──────────────

export interface AgentFix {
  say: string;
  offer: { command: string; args: string } | null;
}

/** Parse la réponse du rattrapage (même tolérance zéro confiance). */
export function parseAgentFix(raw: string): AgentFix | null {
  if (!raw || typeof raw !== "string") return null;
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: any;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const say = String(obj.say || "").trim();
  if (!say || say.length > 600) return null;
  let offer: { command: string; args: string } | null = null;
  if (obj.offer && typeof obj.offer === "object") {
    const command = String(obj.offer.command || "").trim().toLowerCase();
    if (/^[a-z0-9]+$/.test(command)) {
      offer = { command, args: typeof obj.offer.args === "string" ? obj.offer.args.trim().slice(0, 400) : "" };
    }
  }
  return { say, offer };
}
