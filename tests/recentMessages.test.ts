/**
 * 9.8 — recentMessages : registre borné qui résout les replies à citation
 * épurée (constat prod 9.6c : extendedTextMessage + messageContextInfo,
 * quotedMessage absent — chat à messages éphémères).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRecentMessagesForTests,
  getRecentMessage,
  recordRecentMessage,
} from "../src/bot/services/recentMessages.js";

const JID = "1555999000111@s.whatsapp.net";

beforeEach(() => __resetRecentMessagesForTests());
afterEach(() => __resetRecentMessagesForTests());

describe("recentMessages (9.8)", () => {
  it("enregistre puis retrouve un message par jid+id", () => {
    recordRecentMessage(JID, "ID1", { videoMessage: { mimetype: "video/mp4" } });
    expect(getRecentMessage(JID, "ID1")).toEqual({ videoMessage: { mimetype: "video/mp4" } });
  });

  it("les clés invalides sont ignorées, les inconnues rendent null", () => {
    recordRecentMessage("", "ID", {});
    recordRecentMessage(JID, "", {});
    recordRecentMessage(JID, "ID", null);
    expect(getRecentMessage(JID, "autre")).toBeNull();
  });

  it("TTL 2 h : entrée expirée → null (fenêtre glissante)", () => {
    const now = 10_000_000;
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now);
    try {
      recordRecentMessage(JID, "OLD", { conversation: "x" });
      recordRecentMessage(JID, "NEW", { conversation: "y" });
      spy.mockReturnValue(now + 2 * 60 * 60 * 1000 - 1);
      expect(getRecentMessage(JID, "OLD")).toBeTruthy(); // pas encore
      spy.mockReturnValue(now + 2 * 60 * 60 * 1000 + 1);
      expect(getRecentMessage(JID, "OLD")).toBeNull(); // expirée
      expect(getRecentMessage(JID, "NEW")).toBeNull(); // purge globale
    } finally {
      spy.mockRestore();
    }
  });

  it("cap mémoire 400 : éviction FIFO, les plus récents survivent", () => {
    for (let i = 0; i < 450; i++) {
      recordRecentMessage(JID, `ID${i}`, { i });
    }
    expect(getRecentMessage(JID, "ID0")).toBeNull(); // évacqué
    expect(getRecentMessage(JID, "ID449")).toBeTruthy();
    expect(getRecentMessage(JID, "ID100")).toBeTruthy(); // dans le cap
  });
});

describe("wiring 9.8", () => {
  it("botEngine enregistre CHAQUE message upsert (reçus et émis) AVANT tout traitement", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/bot/botEngine.ts", "utf-8");
    const rec = src.indexOf("recordRecentMessage(String(msg.key?.remoteJid");
    const unwrap = src.indexOf("// Unwrap ephemeral, viewOnce, or other wrapper messages");
    expect(rec).toBeGreaterThan(-1);
    expect(rec).toBeLessThan(unwrap); // enregistré même si le traitement saute
  });

  it("commandDispatch mémorise la sortie des commandes PREFIX (le « 3 » nu)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/bot/commandDispatch.ts", "utf-8");
    expect(src).toContain("setLastObservation(senderJid, commandName, outcome.texts)");
  });
});
