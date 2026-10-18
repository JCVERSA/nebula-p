/**
 * 9.18bb (P7) — rappels programmés : parsing déterministe du moment (fuseau
 * configurable NEBULA_TZ, défaut UTC — 9.18hhh), store atomique par chat.
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
  process.env.NEBULA_TZ = "UTC"; // 9.18hhh : arithmétique déterministe, aucun pays
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
  delete process.env.NEBULA_TZ;
});

describe("9.18hhh — tzOffsetMinutes (fuseau configurable, défaut UTC)", () => {
  it("aucune variable posée : UTC (aucun pays codé dur)", () => {
    delete process.env.NEBULA_TZ;
    delete process.env.NEBULA_WATCH_TZ;
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(0);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(0);
  });

  it("NEBULA_TZ global : ex. Africa/Douala = UTC+1 toute l'année (pas de DST)", () => {
    process.env.NEBULA_TZ = "Africa/Douala";
    try {
      expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(60);
      expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(60);
    } finally {
      delete process.env.NEBULA_TZ;
    }
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

  it("« 18h texte » → aujourd'hui (ou demain si déjà passé), heure configurée", () => {
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
    const r = parseReminderSpec("demain 9h réviser l'examen", now);
    expect(r && r.kind === "set").toBe(true);
    if (r && r.kind === "set") {
      expect(r.text).toBe("réviser l'examen");
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

  it("audit 9.18 : « 18h » tapé juste avant/après 18h (±2 min) → borné à +30 s, pas rejeté", () => {
    // 17:59:50 UTC : 18h00 est à +10 s → clamp +30 s
    const avant = Date.UTC(2026, 9, 15, 17, 59, 50);
    const r1 = parseReminderSpec("18h télécharger mushoku", avant);
    expect(r1 && r1.kind === "set").toBe(true);
    if (r1 && r1.kind === "set") expect(r1.dueAt).toBe(avant + 30_000);
    // 18:01:30 UTC : 18h00 est passé d'1 min 30 → clamp +30 s
    const apres = Date.UTC(2026, 9, 15, 18, 1, 30);
    const r2 = parseReminderSpec("18h télécharger mushoku", apres);
    expect(r2 && r2.kind === "set").toBe(true);
    if (r2 && r2.kind === "set") expect(r2.dueAt).toBe(apres + 30_000);
    // 17h55 tapé à 18:01 (passé de 6 min > 2 min) → demain 17h55, pas de clamp
    const loin = Date.UTC(2026, 9, 15, 18, 1, 0); // 18:01 UTC
    const r3 = parseReminderSpec("17h55 x", loin);
    expect(r3 && r3.kind === "set").toBe(true);
    if (r3 && r3.kind === "set") expect(r3.dueAt).toBeGreaterThan(loin + 20 * 3_600_000);
    // « dans 0 min » explicite reste rejeté (pas un cas horloge)
    expect(parseReminderSpec("dans 0 min x", avant)).toBeNull();
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
