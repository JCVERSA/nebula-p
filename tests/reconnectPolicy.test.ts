/**
 * 9.18ggg (audit 17/10 §3/§2/§7) — politique de reconnexion du moteur.
 *
 * §3 (ggg) : au 5e échec consécutif, le moteur s'arrêtait DÉFINITIVEMENT
 *      alors que le process vivait (health-check 200) : plus personne ne le
 *      relançait jamais. ggg l'avait remplacé par une pause de 5 min —
 *      9.18qqq (owner 18/10 « tout s'éteint ~5 min ») : les rafales 408/515
 *      de Baileys 7.x déclenchaient cette pause en ~30 s puis coupaient le
 *      bot TOTALEMENT 5 minutes. Backoff plafonné (5, 5, 10, 20, 40, 60 s),
 *      indéfiniment — jamais d'arrêt définitif, jamais de mur de 5 min ;
 *      et le catch de démarrage programme désormais une relance lui aussi
 *      (avant : moteur mort jusqu'à un redémarrage manuel).
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
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  formatOnlineNotice
} from "../src/bot/botEngine.js";

describe("9.18qqq — nextReconnectPlan (pur) : backoff plafonné, plus de pause de 5 min", () => {
  it("courbe : 5 s, 5 s, 10 s, 20 s, 40 s, puis 60 s pour toujours", () => {
    const expected = [5_000, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
    expected.forEach((delay, n) => {
      expect(nextReconnectPlan(n).delayMs).toBe(delay);
    });
    expect(nextReconnectPlan(99).delayMs).toBe(60_000); // plafond, jamais plus
  });

  it("le compteur s'incrémente toujours (jamais de remise à zéro par la politique)", () => {
    expect(nextReconnectPlan(0).count).toBe(1);
    expect(nextReconnectPlan(4).count).toBe(5);
    expect(nextReconnectPlan(30).count).toBe(31);
  });

  it("PLUS JAMAIS de mur de 5 minutes, quel que soit le nombre d'échecs", () => {
    for (let n = 0; n <= 30; n++) {
      expect(nextReconnectPlan(n).delayMs).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS);
      expect(nextReconnectPlan(n).delayMs).toBeLessThan(5 * 60_000);
    }
    expect(RECONNECT_MAX_DELAY_MS).toBe(60_000);
    expect(RECONNECT_BASE_DELAY_MS).toBe(5_000);
  });
});

describe("9.18ggg — moteur (source)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");

  it("§3/qqq : ni arrêt définitif ni pause de 5 min — backoff aux DEUX endroits qui peuvent tuer le moteur", () => {
    expect(src).not.toContain("Reconnection failure limit reached. Bot stopped.");
    expect(src).not.toContain("RECONNECT_LONG_PAUSE_MS"); // le mur de 5 min n'existe plus
    // La politique pilote la boucle de reconnexion ET le catch de démarrage
    // (avant : un échec au démarrage laissait le moteur mort sans relance).
    const uses = src.split("nextReconnectPlan(botState.reconnectCount)").length - 1;
    expect(uses).toBeGreaterThanOrEqual(2);
    // Un arrêt manuel pendant la fenêtre annule la relance programmée.
    expect(src).toContain("stopEpoch++");
    expect(src).toContain("epoch !== stopEpoch");
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
