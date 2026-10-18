/**
 * 9.18ggg (audit 17/10 §3/§2/§7) — politique de reconnexion du moteur.
 *
 * §3 : au 5e échec consécutif, le moteur s'arrêtait DÉFINITIVEMENT alors
 *      que le process vivait (health-check 200) : plus personne ne le
 *      relançait jamais. Le budget se renouvelle désormais après une pause
 *      longue, indéfiniment.
 * §2 : keepAliveIntervalMs 10 s → 30 s (défaut Baileys) : le seuil
 *      d'auto-coupure « 408 Connection was lost » passe de 15 s à 35 s de
 *      silence reçu.
 * §7 : plus de « is online and connected! » à chaque reconnexion (les 515
 *      de routine en généraient plusieurs par jour côté owner).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { nextReconnectPlan, RECONNECT_SERIES, RECONNECT_LONG_PAUSE_MS } from "../src/bot/botEngine.js";

describe("9.18ggg — nextReconnectPlan (pur)", () => {
  it("série normale : 5 tentatives espacées de 5 s", () => {
    for (let n = 0; n < RECONNECT_SERIES; n++) {
      const plan = nextReconnectPlan(n);
      expect(plan.longPause).toBe(false);
      expect(plan.delayMs).toBe(5_000);
      expect(plan.count).toBe(n + 1);
    }
  });

  it("premier échec : 1/5, pas de pause", () => {
    expect(nextReconnectPlan(0)).toEqual({ delayMs: 5_000, count: 1, longPause: false });
  });

  it("série épuisée : pause longue de 5 min puis NOUVEAU budget", () => {
    const plan = nextReconnectPlan(RECONNECT_SERIES);
    expect(plan.longPause).toBe(true);
    expect(plan.delayMs).toBe(RECONNECT_LONG_PAUSE_MS);
    expect(RECONNECT_LONG_PAUSE_MS).toBe(5 * 60_000);
    expect(plan.count).toBe(0); // la série suivante repart à 1
  });

  it("au-delà de 5 échecs (compteur résiduel) : pause longue aussi", () => {
    expect(nextReconnectPlan(7).longPause).toBe(true);
    expect(nextReconnectPlan(99).longPause).toBe(true);
  });
});

describe("9.18ggg — moteur (source)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");

  it("§3 : l'arrêt définitif silencieux est supprimé, remplacé par la pause longue", () => {
    expect(src).not.toContain("Reconnection failure limit reached. Bot stopped.");
    expect(src).toContain("nextReconnectPlan(botState.reconnectCount)");
    expect(src).toContain("pause longue, indéfiniment");
  });

  it("§2 : keepAliveIntervalMs revient au défaut Baileys (30 s)", () => {
    expect(src).toContain("keepAliveIntervalMs: 30_000");
    expect(src).not.toContain("keepAliveIntervalMs: 10_000");
  });

  it("§7 : plus de « is online and connected! » inconditionnel à chaque reconnexion", () => {
    // Le seul reste autorisé est le commentaire explicatif de 9.18ggg.
    const hits = src.split("is online and connected").length - 1;
    expect(hits).toBe(1); // le commentaire, pas l'envoi
    expect(src).not.toContain("is online and connected!\\nPrefix");
  });
});
