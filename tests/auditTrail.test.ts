import { describe, it, expect, beforeEach } from "vitest";
import { recordAudit, getAuditEvents, clearAudit } from "../src/bot/auditTrail.js";
import { maskLogNumber, maskLogText } from "../src/bot/botEngine.js";

describe("Audit trail", () => {
  beforeEach(() => clearAudit());

  it("records and returns events newest-first", () => {
    recordAudit("panel", "auth.login", "panel", "one");
    recordAudit("wa:…1234", "roleguard.deny", "kick", "Denied by group policy");
    const events = getAuditEvents(10);
    expect(events.length).toBe(2);
    expect(events[0].action).toBe("roleguard.deny");
    expect(events[1].action).toBe("auth.login");
  });

  it("caps the ring buffer", () => {
    for (let i = 0; i < 1200; i++) recordAudit("tester", `event.${i}`);
    expect(getAuditEvents(2000).length).toBe(1000);
  });
});

describe("Log redaction (M6)", () => {
  it("masks numbers down to the last 4 digits", () => {
    expect(maskLogNumber("10000000001@s.whatsapp.net")).toBe("…0001");
    expect(maskLogNumber("123")).toBe("…123");
  });

  it("hides message content by default", () => {
    expect(maskLogText("secret group message")).toBe("[content hidden]");
  });
});
