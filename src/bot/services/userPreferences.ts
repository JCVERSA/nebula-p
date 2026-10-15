import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * 9.18aa (P2, décision owner 15/10) — préférences déclarées par chat.
 *
 * « à partir de maintenant, toujours en 720p » → mémorisé, appliqué
 * automatiquement aux commandes anime de l'agent quand la demande ne
 * précise PAS la qualité, avec mention honnête « (720p — ta préférence) ».
 *
 * Décisions de design (esprit éco-tokens + fail-open) :
 *  - la DÉCLARATION est détectée déterministement (parsePreferenceDeclaration,
 *    pur) : confirmer une préférence ne coûte AUCUN token IA ;
 *  - l'APPLICATION est déterministe aussi (applyDefaultQuality, pur) :
 *    la préférence est APPENDUE aux args si absente — l'IA n'a pas à s'en
 *    souvenir, elle ne peut pas se tromper ;
 *  - toujours la qualité EXPLICITE (720p…), jamais un flag r1-r4 : leur
 *    mapping dépend du catalogue ;
 *  - clé = chat (senderJid), comme l'historique anime ; JSON atomique,
 *    AUCUN contenu de message stocké (une qualité + un timestamp) ;
 *  - « annule ma préférence » retire la préférence (déterministe aussi).
 *
 * La règle « préférence non précisée → ask » de l'agent est préservée
 * SAUF pour la qualité quand une préférence déclarée existe : c'est la
 * décision owner P2 (moins de questions répétitives).
 */

export interface ChatPreference {
  quality: string;
  ts: number;
}

type PrefStore = Record<string, ChatPreference>;

const MAX_STORED_CHATS = 500;
const VALID_QUALITIES = new Set(["360p", "480p", "720p", "1080p"]);
/** Mapping des flags r (guide agent) → qualité explicite. */
const R_FLAG_QUALITY: Record<string, string> = { r1: "480p", r2: "360p", r3: "720p", r4: "1080p" };

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "user_prefs.json");
}

function loadStore(): PrefStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PrefStore;
  } catch {
    return {};
  }
}

function saveStore(store: PrefStore): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // Fail-closed : la préférence reste en RAM ce tour, rien de fatal.
  }
}

/** Qualité normalisée (720P → 720p) ou null si invalide. Pur. */
export function normalizeQuality(raw: string): string | null {
  const q = String(raw || "").toLowerCase().trim();
  return VALID_QUALITIES.has(q) ? q : null;
}

export function setChatPreference(chatJid: string, quality: string, now = Date.now()): boolean {
  const q = normalizeQuality(quality);
  if (!chatJid || !q) return false;
  const store = loadStore();
  store[chatJid] = { quality: q, ts: now };
  const keys = Object.keys(store);
  if (keys.length > MAX_STORED_CHATS) {
    keys
      .sort((a, b) => store[a].ts - store[b].ts)
      .slice(0, keys.length - MAX_STORED_CHATS)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
  return true;
}

/** Préférence du chat (zéro confiance : qualité stockée revalidée). */
export function getChatPreference(chatJid: string): ChatPreference | null {
  if (!chatJid) return null;
  const e = loadStore()[chatJid];
  if (!e || typeof e !== "object") return null;
  const q = normalizeQuality((e as ChatPreference).quality);
  if (!q) return null;
  return { quality: q, ts: Number(e.ts) || 0 };
}

export function clearChatPreference(chatJid: string): boolean {
  if (!chatJid) return false;
  const store = loadStore();
  const had = !!store[chatJid];
  delete store[chatJid];
  if (had) saveStore(store);
  return had;
}

/**
 * Bloc contexte compact pour le prompt de l'agent (injecté seulement si
 * le message parle d'anime — éco tokens). Dit à l'IA de NE PAS demander
 * la qualité : elle est appliquée déterministement côté runner.
 */
export function preferenceContextBlock(chatJid: string): string | null {
  const pref = getChatPreference(chatJid);
  if (!pref) return null;
  return (
    `## Préférence déclarée\n` +
    `Qualité par défaut pour les animes : ${pref.quality} — appliquée automatiquement quand la ` +
    `demande n'en précise pas. Ne demande JAMAIS la qualité à l'utilisateur, elle sera ajoutée.`
  );
}

// ── Parsing déterministe des déclarations (pur) ─────────────────────────────

export type PreferenceDeclaration =
  | { kind: "set"; quality: string }
  | { kind: "clear" };

/** Marqueurs d'intention persistante — au moins un est requis pour un set. */
const PERSISTENCE_MARKERS = new Set([
  "toujours", "désormais", "défaut", "defaut", "retiens", "retenir",
  "mets", "met", "configure", "partir", "maintenant", "note"
]);

/** Vocabulaire autorisé autour de la déclaration (tout autre mot → null). */
const PREF_FILLER = new Set([
  "le", "la", "les", "l", "un", "une", "du", "de", "des", "moi", "mes", "mon", "pour", "en",
  "à", "a", "par",
  "stp", "svp", "please", "qualité", "qualite", "animes", "anime", "animés", "téléchargements",
  "telechargements", "vidéos", "videos", "je", "veux", "voudrais", "souhaite", "bien", "que",
  "est", "c'est", "ce", "soit", "sur", "mes", "annule", "annuler", "oublie", "oublier",
  "retire", "retirer", "enlève", "enlever", "supprime", "supprimer", "ma", "préférence",
  "preference", "préférences", "preferences", "plus", "va", "vas", "y"
]);

/** Détecte une DÉCLARATION de préférence pure. Null si le message est autre chose. Pur. */
export function parsePreferenceDeclaration(text: string): PreferenceDeclaration | null {
  const norm = String(text || "")
    .toLowerCase()
    .replace(/[\u2019\u2018\u0060\u00B4]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length > 120) return null;
  const tokens = norm.split(/[\s',.!?;:()\-]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 12) return null;

  // Annulation : verbe + « préférence(s) », ou « plus de préférence ».
  const hasPrefWord = tokens.some((t) => t === "préférence" || t === "preference" || t === "préférences" || t === "preferences");
  const hasClearVerb = tokens.some((t) => /^(annule|annuler|oublie|oublier|retire|retirer|enlève|enlever|supprime|supprimer)$/.test(t));
  if (hasPrefWord && (hasClearVerb || tokens.some((t) => t === "plus"))) {
    // Tout token restant doit être du vocabulaire connu.
    for (const t of tokens) {
      if (!PREF_FILLER.has(t)) return null;
    }
    return { kind: "clear" };
  }

  // Déclaration : une qualité (explicite ou flag r) + un marqueur de persistance.
  let quality: string | null = null;
  const others: string[] = [];
  for (const t of tokens) {
    if (/^(360|480|720|1080)p$/.test(t)) {
      quality = t;
      continue;
    }
    if (R_FLAG_QUALITY[t]) {
      quality = R_FLAG_QUALITY[t];
      continue;
    }
    others.push(t);
  }
  if (!quality) return null;
  const hasMarker = others.some((t) => PERSISTENCE_MARKERS.has(t));
  if (!hasMarker) return null;
  for (const t of others) {
    if (!PERSISTENCE_MARKERS.has(t) && !PREF_FILLER.has(t)) return null;
  }
  return { kind: "set", quality };
}

// ── Application déterministe aux args d'exécution (pur) ─────────────────────

/** Token qualité déjà présent (explicite ou flag r) dans les args ? Pur. */
function argsHaveQuality(args: string[]): boolean {
  return args.some((a) => /^(360|480|720|1080)p$/i.test(a) || /^r[1-4]$/i.test(a));
}

/**
 * Ajoute la qualité préférée aux args d'une commande anime qui n'en précise
 * pas — retourne les args finaux + un flag quand l'ajout a eu lieu (pour la
 * mention honnête et l'audit). Pur : tout doute → inchangé.
 */
export function applyDefaultQuality(
  commandName: string,
  args: string[],
  quality: string | null
): { args: string[]; applied: boolean } {
  const q = quality ? normalizeQuality(quality) : null;
  if (!q) return { args, applied: false };
  if (String(commandName || "").toLowerCase() !== "anime") return { args, applied: false };
  if (!Array.isArray(args) || args.length === 0) return { args, applied: false };
  if (argsHaveQuality(args)) return { args, applied: false };
  return { args: [...args, q], applied: true };
}
