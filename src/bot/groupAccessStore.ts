import fs from "fs";
import path from "path";
import { DEFAULT_GROUP_POLICY, GroupAccessPolicy, normalizePolicy } from "./accessControl.js";
import { recordAudit } from "./auditTrail.js";

/**
 * Persistent RoleGuard group policies (JSON file).
 * Failed writes only log — the bot must keep running even if the data dir is
 * read-only; the in-memory policy still applies for the session.
 */

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function getPoliciesFile(): string {
  return path.join(getDataDir(), "access_policies.json");
}

let policies: Record<string, GroupAccessPolicy> = {};
try {
  if (fs.existsSync(getPoliciesFile())) {
    const raw = JSON.parse(fs.readFileSync(getPoliciesFile(), "utf-8"));
    if (raw && typeof raw === "object") {
      policies = {};
      for (const [group, p] of Object.entries(raw)) {
        policies[group] = normalizePolicy(p as Partial<GroupAccessPolicy>);
      }
    }
  }
} catch (e: any) {
  console.warn("[AccessControl] Failed to load policies:", e?.message || e);
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistPolicies();
  }, 300);
}

export function persistPolicies() {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    const tmp = `${getPoliciesFile()}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(policies, null, 2), "utf-8");
    fs.renameSync(tmp, getPoliciesFile());
  } catch (e: any) {
    console.warn("[AccessControl] Failed to persist policies:", e?.message || e);
  }
}

export function getGroupPolicy(groupJid: string): GroupAccessPolicy {
  const norm = groupJid.replace(/[^0-9a-zA-Z@.:\-_]/g, "").toLowerCase();
  return policies[norm] || { ...DEFAULT_GROUP_POLICY };
}

export function setGroupPolicy(groupJid: string, policy: Partial<GroupAccessPolicy>): GroupAccessPolicy {
  const norm = groupJid.replace(/[^0-9a-zA-Z@.:\-_]/g, "").toLowerCase();
  policies[norm] = normalizePolicy(policy);
  recordAudit("panel-or-owner", "roleguard.policy_change", norm,
    `mode=${policies[norm].defaultTo} deny=[${policies[norm].memberDeny.join(",")}] allow=[${policies[norm].memberAllow.join(",")}] admin=[${policies[norm].adminAllow.join(",")}]`);
  scheduleSave();
  return policies[norm];
}

export function listGroupPolicies(): Record<string, GroupAccessPolicy> {
  return Object.fromEntries(Object.entries(policies).map(([k, v]) => [k, { ...v }]));
}

/** Backup/restore support: replace all policies (bounded, sanitized). */
export function replaceAllPolicies(entries: Record<string, Partial<GroupAccessPolicy>>): number {
  policies = {};
  for (const [group, policy] of Object.entries(entries || {})) {
    const norm = group.replace(/[^0-9a-zA-Z@.:\-_]/g, "").toLowerCase();
    if (norm) policies[norm] = normalizePolicy(policy);
  }
  persistPolicies();
  return Object.keys(policies).length;
}
