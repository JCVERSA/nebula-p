import { describe, it, expect } from "vitest";
import { decideBridgeAcl } from "../src/bot/bridgeAcl.js";

const base = { isOwner: false, isAdmin: false, isGroup: true, isBotAdmin: true };

describe("decideBridgeAcl", () => {
  it("denies ownerOnly commands to admins and members", () => {
    const cmd = { name: "broadcast", ownerOnly: true };
    expect(decideBridgeAcl(cmd, { ...base, isAdmin: true }).allowed).toBe(false);
    expect(decideBridgeAcl(cmd, base).allowed).toBe(false);
    expect(decideBridgeAcl(cmd, { ...base, isOwner: true }).allowed).toBe(true);
  });

  it("hard-denies dangerous commands by name even without metadata", () => {
    for (const name of ["restart", "update", "broadcast", "block", "setprefix"]) {
      const res = decideBridgeAcl({ name }, { ...base, isAdmin: true });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("owner");
    }
  });

  it("requires admin for adminOnly commands", () => {
    const cmd = { name: "kick", adminOnly: true };
    expect(decideBridgeAcl(cmd, base).allowed).toBe(false);
    expect(decideBridgeAcl(cmd, { ...base, isAdmin: true }).allowed).toBe(true);
    expect(decideBridgeAcl(cmd, { ...base, isOwner: true }).allowed).toBe(true);
  });

  it("enforces group-only and private-only scopes", () => {
    expect(decideBridgeAcl({ groupOnly: true }, { ...base, isGroup: false }).allowed).toBe(false);
    expect(decideBridgeAcl({ privateOnly: true }, base).allowed).toBe(false);
    expect(decideBridgeAcl({ privateOnly: true }, { ...base, isGroup: false }).allowed).toBe(true);
  });

  it("enforces bot-admin requirement", () => {
    expect(decideBridgeAcl({ botAdminNeeded: true }, base).allowed).toBe(true);
    expect(decideBridgeAcl({ botAdminNeeded: true }, { ...base, isBotAdmin: false }).allowed).toBe(false);
  });

  it("allows unrestricted member commands by default", () => {
    expect(decideBridgeAcl({ name: "joke" }, base).allowed).toBe(true);
    expect(decideBridgeAcl({ name: "joke" }, { ...base, isGroup: false }).allowed).toBe(true);
  });
});
