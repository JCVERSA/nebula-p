import fs from "fs";
import path from "path";

/**
 * 8.99 — métriques de l'agent IA (leçons OpenAI Agents SDK / VoltAgent :
 * tracer chaque run pour voir les régressions, pas seulement les deviner).
 *
 * Chaque tour de l'agent enregistre UN événet compact : action choisie,
 * moteur, latence, décision parsée ou dégradée. Rolling 48 h en JSON
 * atomique (comme les autres stores), AUCUN contenu de message (§ vie
 * privée — audit sans contenus). getAgentHealth() agrège 24 h pour le
 * panneau (/api/bot/agent-health) et le digest quotidien.
 */

export interface AgentTurnRecord {
  ts: number;
  action: "execute" | "ask" | "reply" | "degraded" | "denied" | "error";
  engine: "gemini" | "nim";
  latencyMs: number;
  /** true = l'IA a répondu un JSON conforme ; false = dégradation guidage. */
  parseOk: boolean;
  /** true = args nettoyés par le guardrail avant exécution. */
  argsSanitized: boolean;
}

export interface AgentHealthSummary {
  windowHours: number;
  turns: number;
  executes: number;
  asks: number;
  replies: number;
  degraded: number;
  denied: number;
  errors: number;
  parseOkRate: number; // 0..1
  avgLatencyMs: number | null;
  argsSanitized: number;
  lastDegradedAt: number | null;
}

const ROLL_HOURS = 48;
const MAX_RECORDS = 2000;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "agent_metrics.json");
}

function load(): AgentTurnRecord[] {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentTurnRecord[]) : [];
  } catch {
    return [];
  }
}

function save(records: AgentTurnRecord[]): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // best-effort : les métriques ne doivent jamais casser l'agent.
  }
}

/** Enregistre un tour (best-effort, jamais bloquant). */
export function recordAgentTurn(rec: AgentTurnRecord, now = Date.now()): void {
  try {
    const cutoff = now - ROLL_HOURS * 60 * 60 * 1000;
    const records = load().filter((r) => r.ts >= cutoff);
    records.push(rec);
    save(records.slice(-MAX_RECORDS));
  } catch {}
}

/** Agrégat des dernières heures (défaut 24 h) pour le panneau/digest. */
export function getAgentHealth(windowHours = 24, now = Date.now()): AgentHealthSummary {
  const cutoff = now - windowHours * 60 * 60 * 1000;
  const records = load().filter((r) => r.ts >= cutoff);
  const count = (a: AgentTurnRecord["action"]) => records.filter((r) => r.action === a).length;
  const parsed = records.filter((r) => r.parseOk).length;
  const latencies = records.map((r) => r.latencyMs).filter((n) => Number.isFinite(n) && n >= 0);
  const lastDegraded = records.filter((r) => r.action === "degraded" || !r.parseOk).map((r) => r.ts);
  return {
    windowHours,
    turns: records.length,
    executes: count("execute"),
    asks: count("ask"),
    replies: count("reply"),
    degraded: count("degraded"),
    denied: count("denied"),
    errors: count("error"),
    parseOkRate: records.length > 0 ? parsed / records.length : 1,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    argsSanitized: records.filter((r) => r.argsSanitized).length,
    lastDegradedAt: lastDegraded.length > 0 ? Math.max(...lastDegraded) : null
  };
}
