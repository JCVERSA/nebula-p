/**
 * 9.18ggg (audit 17/10 §1/§5) — socket VIVANT pour les envois tardifs.
 *
 * Avant : chaque réponse partait sur le socket capturé à l'arrivée du
 * message. Après une reconnexion (408/515), un flux long — téléchargement
 * de 30 min — livrait dans un socket mort : « Connection Closed » avalé,
 * réponse perdue. Les rappels, eux, lisaient getBotState().socket, un
 * champ qui n'EXISTAIT PAS → jamais livrés.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { setLiveSocket, getLiveSocket, resolveLiveSocket } from "../src/bot/liveSocket.js";

beforeEach(() => {
  setLiveSocket(null);
});

describe("9.18ggg — liveSocket (unité)", () => {
  it("publie et relit le socket courant, null-safe", () => {
    const sock = { sendMessage: async () => "ok" };
    setLiveSocket(sock);
    expect(getLiveSocket()).toBe(sock);
    setLiveSocket(null);
    expect(getLiveSocket()).toBeNull();
    setLiveSocket(undefined as any);
    expect(getLiveSocket()).toBeNull();
  });

  it("resolveLiveSocket préfère le socket VIVANT au socket capturé (le bug du film de 90 min)", () => {
    const dead = {
      sendMessage: async () => {
        throw new Error("Connection Closed");
      },
    };
    const live = { sendMessage: async () => "delivered" };
    setLiveSocket(live);
    expect(resolveLiveSocket(dead)).toBe(live);
  });

  it("sans socket vivant : repli sur le capturé (jamais pire qu'avant)", () => {
    const captured = { sendMessage: async () => "ok" };
    expect(resolveLiveSocket(captured)).toBe(captured);
  });

  it("socket vivant incohérent (sans sendMessage) → capturé", () => {
    const captured = { sendMessage: async () => "ok" };
    setLiveSocket({} as any);
    expect(resolveLiveSocket(captured)).toBe(captured);
  });
});

describe("9.18ggg — câblage du socket vivant (source)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

  it("botEngine publie le socket à chaque (re)connexion et l'efface à chaque fermeture", () => {
    const src = read("src/bot/botEngine.ts");
    expect(src).toContain("setLiveSocket(sock)");
    // cleanup startLiveBot + close handler + stopLiveBot
    expect(src.split("setLiveSocket(null)").length - 1).toBeGreaterThanOrEqual(3);
    expect(src).toContain('import { setLiveSocket } from "./liveSocket.js"');
  });

  it("les réponses de commandes (reply/react) envoient via le socket vivant", () => {
    const src = read("src/bot/commandDispatch.ts");
    expect(src).toContain('import { resolveLiveSocket } from "./liveSocket.js"');
    expect(src).toContain("const target = resolveLiveSocket(sock)");
    expect(src).toContain("resolveLiveSocket(sock).sendMessage");
  });

  it("l'agent (texte + voix) envoie via le socket vivant", () => {
    expect(read("src/bot/services/agentRunner.ts")).toContain("resolveLiveSocket(sock)");
    expect(read("src/bot/services/agentVoice.ts")).toContain("resolveLiveSocket(sock)");
  });

  it("les rappels lisent le socket vivant — l'ancien cast lisait un champ inexistant", () => {
    const engine = read("engine.ts");
    expect(engine).toContain("startReminderScheduler(getLiveSocket)");
    expect(engine).not.toContain("getBotState() as { socket?: any }");
    const server = read("server.ts");
    expect(server).toContain("startReminderScheduler(getLiveSocket)");
    expect(server).not.toContain("getBotState() as { socket?: any }");
  });

  it("le seam de tests publie AUSSI le socket vivant (cohérence runAsOwnerCommand)", () => {
    expect(read("src/bot/botEngine.ts")).toContain("setLiveSocket(socket);");
  });
});
