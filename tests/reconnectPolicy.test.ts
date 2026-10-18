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
 * §7/9.18mmm (décision owner 18/10, inverse ggg P6) : le message « online »
 *      revient à CHAQUE (re)connexion — ce n'était pas du spam pour lui —
 *      amélioré : cause (515 routine vs 408 perdue) + temps de rétablissement.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  nextReconnectPlan,
  RECONNECT_SERIES,
  RECONNECT_LONG_PAUSE_MS,
  formatOnlineNotice
} from "../src/bot/botEngine.js";

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

  it("§7/9.18mmm : message à CHAQUE (re)connexion — classique au boot, cause+temps ensuite", () => {
    // Décision owner 18/10 : « ce n'était pas un spam pour moi » — ggg P6
    // inversé. L'envoi est inconditionnel (hors downtime prioritaire).
    expect(src).toContain("is online and connected!");
    expect(src).toContain("formatOnlineNotice(config.botName, config.prefix, !bootOpenNotified, lastDisconnectMemo)");
    expect(src).toContain("bootOpenNotified = true;");
    expect(src).toContain("lastDisconnectMemo = {"); // cause mémorisée à la fermeture
    // Priorité conservée : une vraie chute (assessDowntime) parle avant tout.
    const chute = src.indexOf("downtime.notify");
    const online = src.indexOf("formatOnlineNotice(config.botName");
    expect(chute).toBeGreaterThan(-1);
    expect(online).toBeGreaterThan(chute);
  });

  it("9.18mmm — formatOnlineNotice (pur) : boot classique, cause 515/408, temps, mémo périmé", () => {
    const now = Date.now();
    // Démarrage du process → le message classique.
    expect(formatOnlineNotice("Nebula Bot", ".", true, null, now))
      .toBe("🌌 *Nebula Bot* is online and connected!\nPrefix: `.`");
    // Reconnexion de routine (515) rétablie en 9 s.
    expect(formatOnlineNotice("Nebula Bot", ".", false, { statusCode: 515, routine: true, at: now - 9000 }, now))
      .toContain("reconnecté ⚡");
    expect(formatOnlineNotice("Nebula Bot", ".", false, { statusCode: 515, routine: true, at: now - 9000 }, now))
      .toContain("flux synchronisé");
    expect(formatOnlineNotice("Nebula Bot", ".", false, { statusCode: 515, routine: true, at: now - 9000 }, now))
      .toContain("rétabli en 9 s");
    // Connexion perdue (408) rétablie en 4 s — cause distincte.
    const lost = formatOnlineNotice("Nebula Bot", ".", false, { statusCode: 408, routine: false, at: now - 4000 }, now);
    expect(lost).toContain("connexion perdue puis rétablie");
    expect(lost).toContain("rétabli en 4 s");
    // Mémo périmé (> 10 min = facto un redémarrage) → classique.
    expect(formatOnlineNotice("Nebula Bot", ".", false, { statusCode: 515, routine: true, at: now - 15 * 60_000 }, now))
      .toContain("is online and connected!");
    // Pas de mémo → classique.
    expect(formatOnlineNotice("Nebula Bot", ".", false, null, now)).toContain("is online and connected!");
  });
});
