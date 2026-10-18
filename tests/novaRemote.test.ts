/**
 * 9.18xx — télécommande Nova : POST /api/bot/run exécute un texte
 * EXACTEMENT comme si l'owner l'avait tapé sur WhatsApp (commande préfixée
 * → dispatch ; langage naturel → agent). Les réponses partent dans le chat
 * owner. Garde-fous : auth panel, ≤500 chars, commandes système exclues,
 * refus honnête si OWNER_NUMBER absent ou moteur déconnecté.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";

let app: Express;
let runAsOwner: typeof import("../src/bot/botEngine.js").runAsOwnerCommand;
let setRemoteState: typeof import("../src/bot/botEngine.js").__setRemoteStateForTests;

const auth = { Authorization: "Bearer test-panel-token" };
const OWNER = "15551234567";

/** Faux sock : capture tout sendMessage (les réponses vont au chat owner). */
function fakeSock() {
  const sent: Array<{ jid: string; content: any }> = [];
  return {
    sent,
    sendMessage: async (jid: string, content: any) => {
      sent.push({ jid, content });
      return {};
    },
    ev: { on: () => {}, emit: () => {} },
  };
}

beforeAll(async () => {
  const { createApp } = await import("../app.js");
  const engine = await import("../src/bot/botEngine.js");
  runAsOwner = engine.runAsOwnerCommand;
  setRemoteState = engine.__setRemoteStateForTests;
  const { initRegistry } = await import("../src/bot/commandRegistry.js");
  await initRegistry();
  app = createApp();
});

beforeEach(() => {
  process.env.OWNER_NUMBER = OWNER;
  setRemoteState(null, "disconnected");
});

afterEach(() => {
  setRemoteState(null, "disconnected");
  delete process.env.OWNER_NUMBER;
});

describe("9.18xx — télécommande Nova : garde-fous du endpoint", () => {
  it("authentification panel exigée", async () => {
    const res = await request(app).post("/api/bot/run").send({ text: ".ping" });
    expect(res.status).toBe(401);
  });

  it("texte vide ou > 500 chars → 400", async () => {
    const empty = await request(app).post("/api/bot/run").set(auth).send({ text: "   " });
    expect(empty.status).toBe(400);
    const tooLong = await request(app).post("/api/bot/run").set(auth).send({ text: "a".repeat(501) });
    expect(tooLong.status).toBe(400);
  });

  it("commandes SYSTÈME bloquées à distance → 422 + orientation Réglages", async () => {
    for (const cmd of [".stop", ".update", ".restart", ".purge"]) {
      const res = await request(app).post("/api/bot/run").set(auth).send({ text: cmd });
      expect(res.status).toBe(422);
      expect(res.body.message).toContain("Réglages");
    }
  });

  it("OWNER_NUMBER absent → refus honnête", async () => {
    delete process.env.OWNER_NUMBER;
    const res = await request(app).post("/api/bot/run").set(auth).send({ text: ".ping" });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("OWNER_NUMBER");
  });

  it("moteur déconnecté → refus honnête", async () => {
    const res = await request(app).post("/api/bot/run").set(auth).send({ text: ".ping" });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("pas connecté");
  });
});

describe("9.18xx — télécommande Nova : exécution réelle (faux sock injecté)", () => {
  it(".ping → exécuté, réponse ENVOYÉE au chat owner (jid OWNER_NUMBER)", async () => {
    const sock = fakeSock();
    setRemoteState(sock as any, "connected");
    const res = await request(app).post("/api/bot/run").set(auth).send({ text: ".ping" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sock.sent.length).toBeGreaterThan(0);
    expect(sock.sent[0].jid).toBe(`${OWNER}@s.whatsapp.net`);
    // une réaction peut partir avant le texte → chercher un vrai texte
    expect(sock.sent.some((m) => String(m.content?.text || "").includes("Nebula"))).toBe(true);
  });

  it("commande inconnue → 422 honnête, réponse d'erreur au chat owner", async () => {
    const sock = fakeSock();
    setRemoteState(sock as any, "connected");
    const res = await request(app).post("/api/bot/run").set(auth).send({ text: ".commandequinexistepas" });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("inconnue");
  });

  it("runAsOwnerCommand (unitaire) : texte > 500 refusé AVANT tout dispatch", async () => {
    const r = await runAsOwner("x".repeat(501));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("500");
  });
});
