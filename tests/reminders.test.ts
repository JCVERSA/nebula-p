/**
 * 9.18bb (P7) — rappels programmés : parsing déterministe du moment (heure
 * Cameroun), store atomique par chat, échéances et tentatives.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseReminderSpec,
  tzOffsetMinutes,
  listReminders,
  addReminder,
  cancelReminder,
  getDueReminders,
  removeReminder,
  markReminderAttempt,
  MAX_TEXT_CHARS
} from "../src/bot/services/reminderService.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reminders-"));
  process.env.NEBULA_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.18bb (P7) — tzOffsetMinutes (heure Cameroun)", () => {
  it("Africa/Douala = UTC+1 toute l'année (pas de DST)", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(60);
  });
});

describe("9.18bb (P7) — parseReminderSpec (pur)", () => {
  it("« dans 30 min texte » → échéance relative", () => {
    const now = Date.now();
    const r = parseReminderSpec("dans 30 min faire une pause", now);
    expect(r && r.kind === "set").toBe(true);
    if (r && r.kind === "set") {
      expect(r.dueAt).toBe(now + 30 * 60_000);
      expect(r.text).toBe("faire une pause");
      expect(r.humanWhen).toContain("30");
    }
  });

  it("variantes : dans 2h / dans 1h30 / dans 2 heures 15 minutes", () => {
    const now = Date.now();
    expect(parseReminderSpec("dans 2h couper le feu", now)).toMatchObject({ kind: "set", dueAt: now + 2 * 3_600_000 });
    expect(parseReminderSpec("dans 1h30 réunion", now)).toMatchObject({ kind: "set", dueAt: now + 90 * 60_000 });
    expect(parseReminderSpec("dans 2 heures 15 minutes pause", now)).toMatchObject({ kind: "set", dueAt: now + 135 * 60_000 });
  });

  it("« 18h texte » → aujourd'hui (ou demain si déjà passé), heure Douala", () => {
    const now = Date.now();
    const r = parseReminderSpec("18h télécharger mushoku", now);
    expect(r && r.kind === "set").toBe(true);
    if (r && r.kind === "set") {
      expect(r.text).toBe("télécharger mushoku");
      expect(r.humanWhen).toContain("18h00");
      // dans la fenêtre [maintenant-2min, maintenant+24h]
      expect(r.dueAt).toBeGreaterThan(now - 2 * 60_000);
      expect(r.dueAt).toBeLessThanOrEqual(now + 24 * 3_600_000);
    }
  });

  it("« demain 9h texte » → demain, bornes respectées", () => {
    const now = Date.now();
    const r = parseReminderSpec("demain 9h réviser les annales", now);
    expect(r && r.kind === "set").toBe(true);
    if (r && r.kind === "set") {
      expect(r.text).toBe("réviser les annales");
      expect(r.dueAt).toBeGreaterThan(now);
      expect(r.dueAt).toBeLessThanOrEqual(now + 48 * 3_600_000); // demain = 0 à ~24 h plus tard
    }
  });

  it("sous-commandes list et cancel", () => {
    expect(parseReminderSpec("list")).toEqual({ kind: "list" });
    expect(parseReminderSpec("liste")).toEqual({ kind: "list" });
    expect(parseReminderSpec("cancel 2")).toEqual({ kind: "cancel", index: 2 });
    expect(parseReminderSpec("annule 1")).toEqual({ kind: "cancel", index: 1 });
  });

  it("rejets honnêtes : vide, sans texte, invalide, trop tôt, trop loin, heure impossible", () => {
    expect(parseReminderSpec("")).toBeNull();
    expect(parseReminderSpec("18h")).toBeNull(); // pas de texte
    expect(parseReminderSpec("télécharger mushoku")).toBeNull(); // pas de moment
    expect(parseReminderSpec("dans 0 min x")).toBeNull(); // trop tôt
    expect(parseReminderSpec("dans 500h x")).toBeNull(); // > 7 jours
    expect(parseReminderSpec("25h x")).toBeNull(); // heure impossible
    expect(parseReminderSpec("18h99 x")).toBeNull(); // minutes impossibles
  });
});

describe("9.18bb (P7) — store (JSON atomique, par chat)", () => {
  it("add → list → cancel, texte plafonné", () => {
    const now = Date.now();
    const rec = addReminder("chat1", now + 3_600_000, "télécharger mushoku", now);
    expect(rec).not.toBeNull();
    addReminder("chat1", now + 7_200_000, "deuxième", now);
    expect(listReminders("chat1").length).toBe(2);
    expect(listReminders("chat1")[0].text).toBe("télécharger mushoku"); // tri par échéance
    expect(listReminders("chat2").length).toBe(0); // chats isolés
    expect(cancelReminder("chat1", 1)).toBe(true);
    expect(listReminders("chat1").length).toBe(1);
    expect(cancelReminder("chat1", 5)).toBe(false);
    const long = addReminder("chat1", now + 3_600_000, "x".repeat(MAX_TEXT_CHARS + 50), now);
    expect(long?.text.length).toBe(MAX_TEXT_CHARS);
  });

  it("plafond de 10 rappels actifs par chat", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) addReminder("chat1", now + (i + 1) * 60_000, `r${i}`, now);
    expect(addReminder("chat1", now + 20 * 60_000, "onze", now)).toBeNull();
    expect(listReminders("chat1").length).toBe(10);
  });

  it("échéances : dus ressortent, tentatives capées puis abandon", () => {
    const now = Date.now();
    const rec = addReminder("chat1", now - 1000, "dû", now);
    expect(rec).not.toBeNull();
    expect(getDueReminders(now).length).toBe(1);
    removeReminder(rec!.id);
    expect(getDueReminders(now).length).toBe(0);
    // tentatives : 5 échecs → retiré
    const rec2 = addReminder("chat1", now - 1000, "retry", now)!;
    for (let i = 0; i < 5; i++) markReminderAttempt(rec2.id);
    expect(listReminders("chat1").find((r) => r.id === rec2.id)).toBeUndefined();
  });
});
