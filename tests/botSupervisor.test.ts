import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { BotSupervisor, buildChildEnv, computeBackoffMs, ensurePanelToken } from "../src/bot/botSupervisor.js";
import { defaultSingleBot, parseBotsConfig } from "../src/bot/botsConfig.js";

/**
 * Multi-bots (8.75) — superviseur : parties pures (env enfant, backoff,
 * jeton panneau) + logique de liste/état SANS spawn réel de moteurs.
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp", "supervisor-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("computeBackoffMs", () => {
  it("suit un backoff exponentiel plafonné à 60 s", () => {
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(10_000);
    expect(computeBackoffMs(3)).toBe(20_000);
    expect(computeBackoffMs(4)).toBe(40_000);
    expect(computeBackoffMs(5)).toBe(60_000);
    expect(computeBackoffMs(50)).toBe(60_000);
    expect(computeBackoffMs(0)).toBe(5_000);
  });
});

describe("buildChildEnv", () => {
  it("isole session, données, persona, port et auto-start du bot", () => {
    const slot = { ...defaultSingleBot(), id: "bot2", persona: "Tu es Bot 2." };
    const env = buildChildEnv(slot, { GEMINI_API_KEY: "k", PANEL_TOKEN: "t", HOME: "/home/x" });
    expect(env.NEBULA_BOT_ID).toBe("bot2");
    expect(env.NEBULA_ENGINE_PORT).toBe("4001");
    expect(env.NEBULA_AUTH_DIR).toBe(slot.authDir);
    expect(env.NEBULA_DATA_DIR).toBe(slot.dataDir);
    expect(env.NEBULA_AI_PERSONALITY).toBe("Tu es Bot 2.");
    expect(env.NEBULA_AUTO_START).toBe("1");
    // Le reste de l'environnement (clés partagées) est propagé.
    expect(env.GEMINI_API_KEY).toBe("k");
    expect(env.PANEL_TOKEN).toBe("t");
    // Le PORT du panneau parent ne doit PAS fuiter vers l'enfant.
    expect(env.PORT).toBeUndefined();
  });

  it("persona vide et autoStart désactivé", () => {
    const slot = { ...defaultSingleBot(), persona: "", autoStart: false };
    const env = buildChildEnv(slot, {});
    expect(env.NEBULA_AI_PERSONALITY).toBe("");
    expect(env.NEBULA_AUTO_START).toBe("0");
  });

  it("n'écrase pas l'objet env d'origine", () => {
    const base = { GEMINI_API_KEY: "k" };
    buildChildEnv(defaultSingleBot(), base);
    expect(base).toEqual({ GEMINI_API_KEY: "k" });
  });
});

describe("BotSupervisor (sans spawn)", () => {
  function makeSupervisor(botsJson: string, opts: { enginePath?: string } = {}) {
    const config = parseBotsConfig(botsJson);
    if (config.error) throw new Error(config.error);
    return new BotSupervisor(config, {
      enginePath: opts.enginePath ?? path.join(tmpDir, "engine-fantome.cjs"),
      token: "test-token",
    });
  }

  it("liste les bots à l'état arrêté avant démarrage", () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"nebula"},{"id":"bot2"}]}');
    const overview = supervisor.getOverview();
    expect(overview.map((b) => b.id)).toEqual(["nebula", "bot2"]);
    expect(overview.every((b) => b.process === "stopped" && b.pid === null && b.restarts === 0)).toBe(true);
  });

  it("le premier bot activé est le bot par défaut", () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a","enabled":false},{"id":"b"},{"id":"c"}]}');
    expect(supervisor.getDefaultBotId()).toBe("b");
    expect(supervisor.hasBot("c")).toBe(true);
    expect(supervisor.hasBot("zzz")).toBe(false);
  });

  it("aucun bot activé = pas de bot par défaut", () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a","enabled":false}]}');
    expect(supervisor.getDefaultBotId()).toBeNull();
  });

  it("startBot sur un bot inconnu ou désactivé est refusé", async () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a"},{"id":"b","enabled":false}]}');
    expect((await supervisor.startBot("zzz")).ok).toBe(false);
    expect((await supervisor.startBot("b")).ok).toBe(false);
  });

  it("startBot échoue explicitement si le binaire moteur est absent", async () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a"}]}', { enginePath: path.join(tmpDir, "nexiste-pas.cjs") });
    const result = await supervisor.startBot("a");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Moteur introuvable");
    expect(supervisor.getOverview()[0].process).toBe("stopped");
  });

  it("stopBot sur un bot inconnu est refusé", async () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a"}]}');
    expect((await supervisor.stopBot("zzz")).ok).toBe(false);
  });

  it("describeConfig résume source et erreur de configuration", () => {
    const config = parseBotsConfig('{"bots":[{"id":"a"},{"id":"b","enabled":false}]}');
    const supervisor = new BotSupervisor(config, { enginePath: "/x" });
    const described = supervisor.describeConfig();
    expect(described.source).toBe("file");
    expect(described.total).toBe(2);
    expect(described.enabled).toBe(1);
    expect(described.error).toBeUndefined();

    const broken = new BotSupervisor({ bots: [], source: "file", error: "boom" }, { enginePath: "/x" });
    expect(broken.describeConfig().error).toBe("boom");
    expect(broken.getOverview()).toHaveLength(0);
  });

  it("fetchWhatsAppStatus retourne null sans enfant lancé", async () => {
    const supervisor = makeSupervisor('{"bots":[{"id":"a"}]}');
    expect(await supervisor.fetchWhatsAppStatus("a")).toBeNull();
    const statuses = await supervisor.fetchWhatsAppStatuses();
    expect(statuses.a).toBeNull();
  });
});

describe("ensurePanelToken (jeton partagé panneau/enfants)", () => {
  const savedToken = process.env.PANEL_TOKEN;

  afterAll(() => {
    if (savedToken === undefined) delete process.env.PANEL_TOKEN;
    else process.env.PANEL_TOKEN = savedToken;
  });

  it("retourne le PANEL_TOKEN déjà présent dans l'environnement", () => {
    process.env.PANEL_TOKEN = "deja-la";
    const envFile = path.join(tmpDir, "env-existant.env");
    expect(ensurePanelToken(envFile)).toBe("deja-la");
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it("lit et adopte le PANEL_TOKEN du .env", () => {
    delete process.env.PANEL_TOKEN;
    const envFile = path.join(tmpDir, "env-lu.env");
    fs.writeFileSync(envFile, "GEMINI_API_KEY=x\nPANEL_TOKEN=venv\n");
    expect(ensurePanelToken(envFile)).toBe("venv");
    expect(process.env.PANEL_TOKEN).toBe("venv");
  });

  it("génère et persiste un jeton quand rien n'existe", () => {
    delete process.env.PANEL_TOKEN;
    const envFile = path.join(tmpDir, "env-genere.env");
    const token = ensurePanelToken(envFile);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(process.env.PANEL_TOKEN).toBe(token);
    const content = fs.readFileSync(envFile, "utf-8");
    expect(content).toContain(`PANEL_TOKEN=${token}`);
    // Le fichier réutilise le jeton persisté à l'appel suivant.
    delete process.env.PANEL_TOKEN;
    expect(ensurePanelToken(envFile)).toBe(token);
  });

  it("génère quand le .env est illisible sans lever", () => {
    delete process.env.PANEL_TOKEN;
    const token = ensurePanelToken(path.join(tmpDir, "sous-dossier-inexistant", "x.env"));
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });
});
