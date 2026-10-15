import fs from "fs";
import path from "path";
import crypto from "crypto";
import { restoreAgentState, setAgentStateSink, type AgentPersistedState } from "./agentBrain.js";

/**
 * 9.18w — persistance disque de l'état volatil de l'agent (audit 9.18).
 *
 * Avant : les confirmations en attente (réponse « OK ») et le budget horaire
 * d'exécutions vivaient en RAM — un redémarrage du bot les effaçait. C'était
 * fail-closed (au pire on redemande la confirmation), mais incorrect pour
 * l'utilisateur qui avait répondu OK pendant un redémarrage.
 *
 * Architecture : le cerveau (agentBrain.ts) reste PUR (aucune dépendance fs
 * — testable à plat). Ce store, câblé au boot par server.ts, lui injecte un
 * sink de persistance et restaure l'état sauvegardé. JSON à écriture
 * atomique comme les autres stores (aiMemory, mediaReuse…).
 *
 * Vie privée : AUCUN texte utilisateur — l'état ne contient que des noms de
 * commandes, leurs args (déjà audités) et des TTL.
 *
 * Env : rien de nouveau — NEBULA_DATA_DIR commun (un fichier par bot en
 * multi-bots, le supervisor donne un dataDir dédié à chaque moteur).
 */

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "agent_state.json");
}

/** Écriture atomique (tmp + rename) — échec disque jamais fatal. */
export function persistAgentState(s: AgentPersistedState): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, pending: s.pending, execLog: s.execLog }), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // Fail-closed : l'agent continue en mémoire, on perdra au pire une
    // confirmation au prochain redémarrage (comportement d'avant 9.18w).
  }
}

/**
 * Lit l'état sauvegardé. Zéro confiance : formes validées entrée par entrée,
 * tout écart → entrée ignorée ; fichier absent/corrompu → null (départ
 * propre, jamais de crash au boot).
 */
export function loadPersistedAgentState(): AgentPersistedState | null {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const pending: AgentPersistedState["pending"] = [];
    if (Array.isArray(obj.pending)) {
      for (const e of obj.pending) {
        if (
          Array.isArray(e) && typeof e[0] === "string" && e[1] && typeof e[1] === "object" &&
          typeof e[1].command === "string" && e[1].command && Array.isArray(e[1].args) &&
          typeof e[1].expiresAt === "number" && e[1].expiresAt > 0
        ) {
          pending.push([
            e[0],
            {
              command: e[1].command,
              args: e[1].args.map((a: unknown) => String(a)),
              say: typeof e[1].say === "string" ? e[1].say : undefined,
              expiresAt: e[1].expiresAt
            }
          ]);
        }
      }
    }
    const execLog: AgentPersistedState["execLog"] = [];
    if (Array.isArray(obj.execLog)) {
      for (const e of obj.execLog) {
        if (
          Array.isArray(e) && typeof e[0] === "string" && e[0] && Array.isArray(e[1]) &&
          e[1].length > 0 && e[1].every((t: unknown) => typeof t === "number" && Number.isFinite(t))
        ) {
          execLog.push([e[0], e[1] as number[]]);
        }
      }
    }
    return { pending, execLog };
  } catch {
    return null;
  }
}

let wired = false;

/**
 * Boot : restaure l'état sauvegardé puis branche le sink d'écriture.
 * Idempotent (server.ts peut l'appeler sur chaque chemin de démarrage).
 */
export function initAgentStatePersistence(): void {
  if (wired) return;
  wired = true;
  try {
    const saved = loadPersistedAgentState();
    if (saved) restoreAgentState(saved);
  } catch {
    // Départ propre si le fichier est illisible.
  }
  setAgentStateSink(persistAgentState);
}

/** Tests uniquement — re-autorise un nouveau câblage. */
export function __resetAgentStateStoreForTests(): void {
  wired = false;
}
