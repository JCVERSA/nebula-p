/**
 * RoleGuard — declarative command access control.
 *
 * Pure, testable authorization for WhatsApp command execution:
 *  - roles: owner / admin / member
 *  - per-group policy: default flavour + allow/deny command lists
 *  - global defaults from config-like defaults in code (no new infra)
 *  - capability tags from commands (groupOnly etc.) are layered on top
 *
 * Design rules:
 *  - deny always beats allow for members; allow beats deny for admins
 *    (admins manage a group, so an explicit admin allow overrides a deny
 *    that was intended for members only).
 *  - owner can never be blocked by a group policy.
 *  - unknown commands are denied unless the policy says "allow unknown
 *    utility" (default: allow, matching today's behaviour; groups can lock
 *    down by flipping defaultTo `deny`).
 */

export type AccessRole = "owner" | "admin" | "member";

export interface CommandAccessTags {
  ownerOnly?: boolean;
  adminOnly?: boolean;
  groupOnly?: boolean;
  privateOnly?: boolean;
}

export interface GroupAccessPolicy {
  /** What happens to commands not mentioned in either list. */
  defaultTo: "allow" | "deny";
  /** Commands/categories always allowed for admins (overrides member deny). */
  adminAllow: string[];
  /** Commands/categories denied to members (and admins if defaultTo deny?). */
  memberDeny: string[];
  /** Commands/categories members may run even when defaultTo deny. */
  memberAllow: string[];
}

export const DEFAULT_GROUP_POLICY: GroupAccessPolicy = {
  defaultTo: "allow",
  adminAllow: [],
  memberDeny: [],
  memberAllow: [],
};

export interface AccessDecision {
  allowed: boolean;
  role: AccessRole;
  reason: string;
}

export function normalizePolicy(policy: Partial<GroupAccessPolicy> | undefined): GroupAccessPolicy {
  const base = { ...DEFAULT_GROUP_POLICY } as GroupAccessPolicy;
  if (!policy) return base;
  const cleanList = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 200)
      : [];
  if (policy.defaultTo === "deny" || policy.defaultTo === "allow") base.defaultTo = policy.defaultTo;
  base.adminAllow = cleanList(policy.adminAllow);
  base.memberDeny = cleanList(policy.memberDeny);
  base.memberAllow = cleanList(policy.memberAllow);
  return base;
}

/** Matches a command against an entry: exact command name or category. */
function matches(entry: string, cmd: { name: string; category: string }): boolean {
  return entry === cmd.name.toLowerCase() || entry === cmd.category.toLowerCase();
}

export function authorizeCommand(
  cmd: { name: string; category: string },
  role: AccessRole,
  policy: GroupAccessPolicy,
  tags: CommandAccessTags = {}
): AccessDecision {
  const name = cmd.name.toLowerCase();
  const category = cmd.category.toLowerCase();

  // Owner is never restricted by group policy or capability tags.
  if (role === "owner") return { allowed: true, role, reason: "Owner bypass" };

  // Capability tags are hard rules.
  if (tags.ownerOnly) return { allowed: false, role, reason: "Owner-only command" };
  if (tags.adminOnly && role !== "admin") return { allowed: false, role, reason: "Admin-only command" };

  // Group policy: deny lists first.
  const denied = policy.memberDeny.some((e) => matches(e, { name, category }));
  if (denied) {
    if (role === "admin" && policy.adminAllow.some((e) => matches(e, { name, category }))) {
      return { allowed: true, role, reason: "Admin allowlist override" };
    }
    return { allowed: false, role, reason: "Denied by group policy" };
  }

  if (role === "admin") {
    return { allowed: true, role, reason: "Admin role" };
  }

  // Member: explicit allow list wins over the default.
  if (policy.memberAllow.some((e) => matches(e, { name, category }))) {
    return { allowed: true, role, reason: "Member allowlist" };
  }

  if (policy.defaultTo === "allow") {
    return { allowed: true, role, reason: "Default allow" };
  }
  return { allowed: false, role, reason: "Default deny in this group" };
}

export function resolveRole(ctx: { isOwner: boolean; isAdmin: boolean; isGroup: boolean }): AccessRole {
  if (ctx.isOwner) return "owner";
  if (ctx.isAdmin && ctx.isGroup) return "admin";
  return "member";
}
