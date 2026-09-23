import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createPanelApp, type PanelSupervisor } from "../src/panel/panelApp.js";
import type { BotOverview } from "../src/bot/botSupervisor.js";

/**
 * Multi-bots (8.75) — panneau superviseur : auth, vue bots, contrôle par bot
 * et routage du proxy (sélecteur ?bot= / header / défaut) avec un superviseur
 * STUB (aucun process réel).
 */

const OVERVIEW: BotOverview[] = [
  {
    id: "nebula",
    name: "Nebula",
    enabled: true,
    process: "running",
    pid: 111,
    enginePort: 4001,
    uptimeSeconds: 42,
    restarts: 0,
    ready: true,
  },
  {
    id: "bot2",
    name: "Bot 2",
    enabled: true,
    process: "stopped",
    pid: null,
    enginePort: 4002,
    uptimeSeconds: 0,
    restarts: 2,
    ready: false,
  },
];

interface ProxyCall {
  botId: string;
  method: string;
  path: string;
}

function makeStubSupervisor() {
  const proxyCalls: ProxyCall[] = [];
  const actions: string[] = [];
  const stub: PanelSupervisor = {
    getOverview: () => OVERVIEW,
    getDefaultBotId: () => "nebula",
    hasBot: (id) => OVERVIEW.some((b) => b.id === id),
    startBot: async (id) => {
      actions.push(`start:${id}`);
      return { ok: id === "nebula" };
    },
    stopBot: async (id) => {
      actions.push(`stop:${id}`);
      return OVERVIEW.some((b) => b.id === id) ? { ok: true } : { ok: false, error: `Bot inconnu : « ${id} »` };
    },
    restartBot: async (id) => {
      actions.push(`restart:${id}`);
      return OVERVIEW.some((b) => b.id === id) ? { ok: true } : { ok: false, error: `Bot inconnu : « ${id} »` };
    },
    proxyRequest: async (botId, req, res) => {
      proxyCalls.push({ botId, method: req.method, path: req.path });
      res.status(200).json({ proxied: true, botId, body: req.body ?? null });
    },
    proxyMediaProbe: async (req, res) => {
      proxyCalls.push({ botId: "(media)", method: req.method, path: req.path });
      res.status(200).json({ media: true });
    },
    fetchWhatsAppStatuses: async () => ({
      nebula: { status: "connected", qrCode: "" },
      bot2: null,
    }),
    describeConfig: () => ({ source: "file" as const, total: 2, enabled: 2 }),
  };
  return { stub, proxyCalls, actions };
}

let app: Express;
let stubs: ReturnType<typeof makeStubSupervisor>;

beforeAll(() => {
  stubs = makeStubSupervisor();
  app = createPanelApp(stubs.stub);
});

const auth = { Authorization: "Bearer test-panel-token" };

describe("Panel multi-bots : authentification", () => {
  it("exige le jeton sur les routes bots", async () => {
    const res = await request(app).get("/api/bots");
    expect(res.status).toBe(401);
  });

  it("exige le jeton sur le proxy par-bot", async () => {
    const res = await request(app).get("/api/bot/status");
    expect(res.status).toBe(401);
    expect(stubs.proxyCalls).toHaveLength(0);
  });

  it("login délivre un cookie de session fonctionnel", async () => {
    const login = await request(app).post("/api/auth/login").send({ token: "test-panel-token" });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toMatch(/^panel_session=/);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie as string);
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(true);
  });

  it("login avec un mauvais jeton est refusé", async () => {
    const res = await request(app).post("/api/auth/login").send({ token: "faux" });
    expect(res.status).toBe(401);
  });
});

describe("Panel multi-bots : santé et vue bots", () => {
  it("la sonde santé décrit le mode panneau", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("panel");
    expect(res.body.botsConfigured).toBe(2);
    expect(res.body.botsEnabled).toBe(2);
  });

  it("GET /api/bots fusionne état process + état WhatsApp", async () => {
    const res = await request(app).get("/api/bots").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.bots).toHaveLength(2);

    const nebula = res.body.bots.find((b: any) => b.id === "nebula");
    expect(nebula.process).toBe("running");
    expect(nebula.whatsapp.status).toBe("connected");
    expect(nebula.isDefault).toBe(true);

    const bot2 = res.body.bots.find((b: any) => b.id === "bot2");
    expect(bot2.process).toBe("stopped");
    expect(bot2.whatsapp).toBeNull();
    expect(bot2.isDefault).toBe(false);
  });

  it("le contrôle par bot appelle le superviseur", async () => {
    const stop = await request(app).post("/api/bots/bot2/stop").set(auth);
    expect(stop.status).toBe(200);
    const restart = await request(app).post("/api/bots/nebula/restart").set(auth);
    expect(restart.status).toBe(200);
    expect(stubs.actions).toEqual(["stop:bot2", "restart:nebula"]);
  });

  it("le contrôle d'un bot inconnu est refusé", async () => {
    const res = await request(app).post("/api/bots/ghost/stop").set(auth);
    expect(res.status).toBe(400);
  });
});

describe("Panel multi-bots : routage du proxy", () => {
  it("sans sélecteur, la requête va au bot par défaut", async () => {
    const res = await request(app).get("/api/bot/status").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.botId).toBe("nebula");
    expect(stubs.proxyCalls.at(-1)).toMatchObject({ botId: "nebula", method: "GET", path: "/api/bot/status" });
  });

  it("le sélecteur ?bot= cible le bot demandé", async () => {
    const res = await request(app).get("/api/bot/status?bot=bot2").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.botId).toBe("bot2");
  });

  it("le header x-nebula-bot cible le bot demandé", async () => {
    const res = await request(app).get("/api/bot/status").set(auth).set("x-nebula-bot", "bot2");
    expect(res.status).toBe(200);
    expect(res.body.botId).toBe("bot2");
  });

  it("un sélecteur inconnu renvoie 404 sans proxy", async () => {
    const res = await request(app).get("/api/bot/status?bot=ghost").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("ghost");
  });

  it("le corps JSON traverse le proxy (POST pair-code)", async () => {
    const res = await request(app)
      .post("/api/bot/pair-code?bot=bot2")
      .set(auth)
      .send({ phoneNumber: "237690000000" });
    expect(res.status).toBe(200);
    expect(res.body.botId).toBe("bot2");
    expect(res.body.body).toEqual({ phoneNumber: "237690000000" });
  });

  it("les routes batchs et gemini passent par le proxy", async () => {
    await request(app).get("/api/batch-downloads").set(auth);
    expect(stubs.proxyCalls.at(-1)?.path).toBe("/api/batch-downloads");
    await request(app).get("/api/batch-downloads-stats").set(auth);
    expect(stubs.proxyCalls.at(-1)?.path).toBe("/api/batch-downloads-stats");
    await request(app).post("/api/gemini/transcribe").set(auth).send({});
    expect(stubs.proxyCalls.at(-1)?.path).toBe("/api/gemini/transcribe");
  });

  it("les liens médias publics traversent sans authentification", async () => {
    const res = await request(app).get("/d/abc123");
    expect(res.status).toBe(200);
    expect(res.body.media).toBe(true);
    expect(stubs.proxyCalls.at(-1)).toMatchObject({ botId: "(media)", path: "/d/abc123" });

    const res2 = await request(app).get("/api/media/download/tok9");
    expect(res2.status).toBe(200);
    expect(res2.body.media).toBe(true);
  });
});
