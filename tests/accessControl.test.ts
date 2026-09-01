import { describe, it, expect } from "vitest";
import {
  authorizeCommand,
  normalizePolicy,
  resolveRole,
  DEFAULT_GROUP_POLICY,
} from "../src/bot/accessControl.js";

const kick = { name: "kick", category: "moderation" };
const menu = { name: "menu", category: "core" };
const restart = { name: "restart", category: "owner" };

describe("RoleGuard access control", () => {
  it("owner bypasses every policy and capability tag", () => {
    const policy = normalizePolicy({ defaultTo: "deny", memberDeny: ["kick"] });
    expect(authorizeCommand(kick, "owner", policy, { ownerOnly: true }).allowed).toBe(true);
    expect(authorizeCommand(restart, "owner", policy, { ownerOnly: true }).allowed).toBe(true);
  });

  it("ownerOnly commands are denied to admins and members", () => {
    const policy = normalizePolicy({});
    expect(authorizeCommand(restart, "admin", policy, { ownerOnly: true }).allowed).toBe(false);
    expect(authorizeCommand(restart, "member", policy, { ownerOnly: true }).allowed).toBe(false);
  });

  it("adminOnly commands are denied to members but allowed to admins", () => {
    const policy = normalizePolicy({ defaultTo: "deny" });
    expect(authorizeCommand(kick, "admin", policy, { adminOnly: true }).allowed).toBe(true);
    expect(authorizeCommand(kick, "member", policy, { adminOnly: true }).allowed).toBe(false);
  });

  it("member deny list blocks members", () => {
    const policy = normalizePolicy({ defaultTo: "allow", memberDeny: ["kick", "moderation"] });
    expect(authorizeCommand(kick, "member", policy).allowed).toBe(false);
    expect(authorizeCommand(restart, "member", policy).allowed).toBe(true);
  });

  it("admin allow list overrides member deny for admins only", () => {
    const policy = normalizePolicy({
      defaultTo: "deny",
      memberDeny: ["download", "media"],
      adminAllow: ["download"],
    });
    expect(authorizeCommand({ name: "download", category: "media" }, "admin", policy).allowed).toBe(true);
    expect(authorizeCommand({ name: "download", category: "media" }, "member", policy).allowed).toBe(false);
  });

  it("default deny blocks members but not admins", () => {
    const policy = normalizePolicy({ defaultTo: "deny" });
    expect(authorizeCommand(menu, "member", policy).allowed).toBe(false);
    expect(authorizeCommand(menu, "admin", policy).allowed).toBe(true);
  });

  it("member allow list wins over default deny", () => {
    const policy = normalizePolicy({ defaultTo: "deny", memberAllow: ["menu", "core"] });
    expect(authorizeCommand(menu, "member", policy).allowed).toBe(true);
    expect(authorizeCommand(restart, "member", policy, { ownerOnly: true }).allowed).toBe(false);
  });

  it("category entries match all commands in that category", () => {
    const policy = normalizePolicy({ defaultTo: "allow", memberDeny: ["entertainment"] });
    expect(authorizeCommand({ name: "joke", category: "entertainment" }, "member", policy).allowed).toBe(false);
    expect(authorizeCommand({ name: "calc", category: "utility" }, "member", policy).allowed).toBe(true);
  });

  it("normalizePolicy strips junk and caps list sizes", () => {
    const policy = normalizePolicy({
      defaultTo: "banana" as any,
      memberDeny: ["KICK", 42 as any, "  promote  ", null as any, ...Array.from({ length: 300 }, (_, i) => `x${i}`)],
      adminAllow: ["restart"],
    });
    expect(policy.defaultTo).toBe(DEFAULT_GROUP_POLICY.defaultTo);
    expect(policy.memberDeny).toEqual(["kick", "promote", ...Array.from({ length: 198 }, (_, i) => `x${i}`)]);
    expect(policy.memberDeny.length).toBe(200);
    expect(policy.adminAllow).toEqual(["restart"]);
  });

  it("resolveRole maps owner/admin/member", () => {
    expect(resolveRole({ isOwner: true, isAdmin: false, isGroup: false })).toBe("owner");
    expect(resolveRole({ isOwner: false, isAdmin: true, isGroup: true })).toBe("admin");
    // Group admins do not exist outside groups → member is correct.
    expect(resolveRole({ isOwner: false, isAdmin: false, isGroup: false })).toBe("member");
  });
});
