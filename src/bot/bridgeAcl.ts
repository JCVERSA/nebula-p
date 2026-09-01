/**
 * Bridge access control for imported (vendored) commands.
 *
 * The vendored command corpus declares privileges via metadata flags
 * (ownerOnly/adminOnly/groupOnly/privateOnly/botAdminNeeded) but its
 * handlers never check them. This module converts those flags into real,
 * centralized enforcement at the bridge boundary:
 *
 *  - ownerOnly   → only the bot owner may run it
 *  - adminOnly   → only owner/group admins
 *  - groupOnly   → group chats only
 *  - privateOnly → private chats only
 *  - botAdminNeeded → the bot must be a group admin
 *
 * A hard-deny list additionally blocks commands that mutate process state
 * or the project itself (restart, self-update) for everyone but the owner.
 * Nothing in this module trusts per-command code; even if a handler forgets
 * a check, the boundary denies by default (fail-closed).
 */

export type BridgeRole = "owner" | "admin" | "member";

export interface BridgeAclResult {
  allowed: boolean;
  reason: string;
}

export interface BridgeCommandMetadata {
  ownerOnly?: boolean;
  adminOnly?: boolean;
  groupOnly?: boolean;
  privateOnly?: boolean;
  botAdminNeeded?: boolean;
}

/** Commands that must never run for non-owners regardless of metadata. */
const HARD_OWNER_ONLY = new Set([
  "restart",
  "reboot",
  "reload",
  "update",
  "upgrade",
  "broadcast",
  "bc",
  "block",
  "unblock",
  "gm",
  "setbotname",
  "setprefix",
  "setbotpp",
  "setmenuimage",
  "setnewsletter",
  "mode",
  "newsletter",
  "remote",
  "anticall",
  "autoreact",
  "botgroup",
]);

function toRole(ctx: { isOwner: boolean; isAdmin: boolean; isGroup: boolean }): BridgeRole {
  if (ctx.isOwner) return "owner";
  if (ctx.isAdmin && ctx.isGroup) return "admin";
  return "member";
}

/** Returns the effective escalation requirement for a command. */
function requiredRole(cmd: BridgeCommandMetadata & { name?: string }): BridgeRole | null {
  if (cmd.ownerOnly || HARD_OWNER_ONLY.has((cmd.name || "").toLowerCase())) return "owner";
  if (cmd.adminOnly) return "admin";
  return null;
}

/**
 * Pure authorization decision — no I/O, fully unit-testable.
 *
 * Order of checks (fail-closed): hard/explicit role → group/private scope →
 * bot-admin requirement.
 */
export function decideBridgeAcl(
  cmd: BridgeCommandMetadata & { name?: string },
  ctx: { isOwner: boolean; isAdmin: boolean; isGroup: boolean; isBotAdmin: boolean },
  opts: { requireGroupCommandPermission?: boolean } = {}
): BridgeAclResult {
  const role = toRole(ctx);

  const needRole = requiredRole(cmd);
  if (needRole === "owner" && role !== "owner") {
    return { allowed: false, reason: "This command is restricted to the bot owner." };
  }
  if (needRole === "admin" && role !== "owner" && role !== "admin") {
    return { allowed: false, reason: "This command is restricted to group administrators." };
  }

  if (cmd.groupOnly && !ctx.isGroup) {
    return { allowed: false, reason: "This command can only be used in group chats." };
  }
  if (cmd.privateOnly && ctx.isGroup) {
    return { allowed: false, reason: "This command can only be used in private chats." };
  }

  if (cmd.botAdminNeeded && !ctx.isBotAdmin) {
    return { allowed: false, reason: "The bot needs to be a group administrator to run this command." };
  }

  // Policy extension point (RoleGuard M1): when the panel gates group
  // commands, the engine calls with requireGroupCommandPermission=true for
  // members; denied here centrally.
  if (opts.requireGroupCommandPermission && ctx.isGroup && role === "member") {
    return { allowed: false, reason: "This command is restricted in this group." };
  }

  return { allowed: true, reason: "" };
}
