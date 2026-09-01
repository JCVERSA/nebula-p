import fs from "fs";
import path from "path";

/**
 * Append-only (in practice: bounded ring) audit trail for security-relevant
 * events: RoleGuard policy changes, ACL denials, panel auth events, panel
 * command saves, config/secret changes. Persisted to the data dir and exposed
 * through the panel API (owner/panel-audience only).
 */

export interface AuditEvent {
  id: string;
  at: string; // ISO timestamp
  actor: string; // e.g. "panel", "owner:<number>", "group:<gid>@g.us"
  action: string;
  target: string;
  detail?: string;
}

const MAX_EVENTS = 1000;

let events: AuditEvent[] = [];
let nextId = 1;

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getAuditFile(): string {
  return path.join(getDataDir(), "audit_trail.json");
}

try {
  if (fs.existsSync(getAuditFile())) {
    const raw = JSON.parse(fs.readFileSync(getAuditFile(), "utf-8"));
    if (Array.isArray(raw)) {
      events = raw.slice(-MAX_EVENTS).map((e: any) => ({
        id: String(e.id || ""),
        at: String(e.at || ""),
        actor: String(e.actor || ""),
        action: String(e.action || ""),
        target: String(e.target || ""),
        detail: e.detail ? String(e.detail).slice(0, 300) : undefined,
      }));
      for (const e of events) {
        const n = parseInt(e.id.replace(/\D/g, ""), 10);
        if (!Number.isNaN(n) && n >= nextId) nextId = n + 1;
      }
    }
  }
} catch (e: any) {
  console.warn("[Audit] Failed to load audit trail:", e?.message || e);
}

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    const tmp = `${getAuditFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(events, null, 2), "utf-8");
    fs.renameSync(tmp, getAuditFile());
  } catch (e: any) {
    console.warn("[Audit] Failed to persist trail:", e?.message || e);
  }
}
function schedulePersist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 250);
}

export function recordAudit(actor: string, action: string, target = "", detail?: string): void {
  events.push({
    id: String(nextId++),
    at: new Date().toISOString(),
    actor: String(actor || "unknown").slice(0, 64),
    action: String(action || "event").slice(0, 64),
    target: String(target || "").slice(0, 96),
    detail: detail ? String(detail).slice(0, 300) : undefined,
  });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  schedulePersist();
}

export function getAuditEvents(limit = 100): AuditEvent[] {
  const n = Math.min(Math.max(1, limit), MAX_EVENTS);
  return events.slice(-n).reverse();
}

export function clearAudit(): void {
  events = [];
  persist();
}
