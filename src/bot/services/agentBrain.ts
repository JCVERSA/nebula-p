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
 *  - anime multi-épisodes (all, plage 1-5, liste 2,5, saison entière d-).
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
  return false;
}

// ── Budget d'exécutions : 10/heure/utilisateur (fenêtre glissante) ─────────

const AGENT_EXEC_PER_HOUR = 10;
const AGENT_WINDOW_MS = 60 * 60 * 1000;
const execLog = new Map<string, number[]>();

export function checkAgentBudget(sender: string, now = Date.now()): boolean {
  const log = (execLog.get(sender) || []).filter((t) => now - t < AGENT_WINDOW_MS);
  execLog.set(sender, log);
  return log.length < AGENT_EXEC_PER_HOUR;
}

export function recordAgentExecution(sender: string, now = Date.now()): void {
  const log = (execLog.get(sender) || []).filter((t) => now - t < AGENT_WINDOW_MS);
  log.push(now);
  execLog.set(sender, log);
}

/** Tests uniquement. */
export function __resetAgentStateForTests(): void {
  execLog.clear();
  pending.clear();
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
}

/** Lit sans consommer ; retourne null si absent ou expiré. */
export function peekPendingConfirmation(sender: string, now = Date.now()): AgentPending | null {
  const p = pending.get(sender);
  if (!p) return null;
  if (now > p.expiresAt) {
    pending.delete(sender);
    return null;
  }
  return p;
}

/** Lit ET consomme (l'appelant a décidé d'agir dessus). */
export function takePendingConfirmation(sender: string, now = Date.now()): AgentPending | null {
  const p = peekPendingConfirmation(sender, now);
  pending.delete(sender);
  return p;
}

export function clearPendingConfirmation(sender: string): void {
  pending.delete(sender);
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
