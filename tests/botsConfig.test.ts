import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  parseBotsConfig,
  loadBotsConfig,
  defaultSingleBot,
  hasRegisteredCreds,
  resolveAppDir,
  DEFAULT_BOT_ID,
} from "../src/bot/botsConfig.js";

/**
 * Multi-bots (8.75) — configuration des slots.
 *
 * Invariants critiques :
 *  - sans bots.json : UN bot par défaut sur les chemins historiques (compat
 *    totale avec le déploiement prod existant) ;
 *  - validation stricte : deux bots ne doivent JAMAIS partager un dossier
 *    d'auth ou de données (corruption de session / mélange de données) ;
 *  - erreur de validation = config d'erreur (aucun bot lancé), pas de fallback
 *    silencieux.
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp", "botsconfig-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("defaultSingleBot (compat prod)", () => {
  it("définit le bot « nebula » sur les chemins historiques", () => {
    const bot = defaultSingleBot();
    expect(bot.id).toBe(DEFAULT_BOT_ID);
    expect(bot.authDir).toBe("nebula_auth_info");
    expect(bot.dataDir).toBe("database");
    expect(bot.enabled).toBe(true);
    expect(bot.autoStart).toBe(true);
    expect(bot.enginePort).toBe(4001);
  });

  it("loadBotsConfig sans fichier retourne la config par défaut", () => {
    process.env.NEBULA_BOTS_FILE = path.join(tmpDir, "inexistant.json");
    const config = loadBotsConfig();
    expect(config.source).toBe("default");
    expect(config.error).toBeUndefined();
    expect(config.bots).toHaveLength(1);
    expect(config.bots[0].id).toBe(DEFAULT_BOT_ID);
    delete process.env.NEBULA_BOTS_FILE;
  });
});

describe("parseBotsConfig", () => {
  it("accepte une config multi-bots valide et applique les défauts", () => {
    const config = parseBotsConfig(
      JSON.stringify({
        bots: [{ id: "nebula" }, { id: "bot2", name: "Second bot", persona: "Tu es Bot 2." }],
      }),
    );
    expect(config.error).toBeUndefined();
    expect(config.bots).toHaveLength(2);

    const [nebula, bot2] = config.bots;
    // Bot par défaut : chemins historiques préservés.
    expect(nebula.authDir).toBe(resolveAppDir("nebula_auth_info"));
    expect(nebula.dataDir).toBe(resolveAppDir("database"));
    expect(nebula.enginePort).toBe(4001);
    // Bot additionnel : dossier dédié + port suivant.
    expect(bot2.authDir).toBe(resolveAppDir(path.join("bots", "bot2", "auth")));
    expect(bot2.dataDir).toBe(resolveAppDir(path.join("bots", "bot2", "data")));
    expect(bot2.enginePort).toBe(4002);
    expect(bot2.name).toBe("Second bot");
    expect(bot2.persona).toBe("Tu es Bot 2.");
    expect(bot2.enabled).toBe(true);
    expect(bot2.maxOldSpaceMb).toBe(192);
  });

  it("respecte les chemins explicites (absolus ou relatifs)", () => {
    const config = parseBotsConfig(
      JSON.stringify({ bots: [{ id: "bot2", authDir: "/srv/sessions/bot2", dataDir: "var/bot2-data" }] }),
    );
    expect(config.error).toBeUndefined();
    expect(config.bots[0].authDir).toBe("/srv/sessions/bot2");
    expect(config.bots[0].dataDir).toBe(resolveAppDir("var/bot2-data"));
  });

  it("refuse un JSON invalide", () => {
    const config = parseBotsConfig("{ pas du json");
    expect(config.error).toContain("illisible");
    expect(config.bots).toHaveLength(0);
  });

  it("refuse une racine sans liste bots", () => {
    expect(parseBotsConfig("{}").error).toContain("bots");
    expect(parseBotsConfig('{"bots": {}}').error).toContain("bots");
  });

  it("refuse une liste vide", () => {
    expect(parseBotsConfig('{"bots": []}').error).toContain("vide");
  });

  it("refuse plus de 8 bots", () => {
    const bots = Array.from({ length: 9 }, (_, i) => ({ id: `bot${i}` }));
    expect(parseBotsConfig(JSON.stringify({ bots })).error).toContain("maximum");
  });

  it("refuse un id qui n'est pas un slug", () => {
    for (const bad of ["", "Bot1", "bot 1", "böt", "x".repeat(25)]) {
      const config = parseBotsConfig(JSON.stringify({ bots: [{ id: bad }] }));
      expect(config.error, `id « ${bad} »`).toContain("id");
    }
  });

  it("refuse les ids dupliqués", () => {
    const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a" }, { id: "a" }] }));
    expect(config.error).toContain("dupliqué");
  });

  it("refuse les ports dupliqués", () => {
    const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a", enginePort: 4100 }, { id: "b", enginePort: 4100 }] }));
    expect(config.error).toContain("port moteur");
  });

  it("refuse un port hors bornes", () => {
    for (const bad of [80, 1023, 65536, -1, 1.5]) {
      const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a", enginePort: bad }] }));
      expect(config.error, `port ${bad}`).toContain("enginePort");
    }
  });

  it("refuse un plafond mémoire hors bornes", () => {
    for (const bad of [0, 32, 2048, 1.5]) {
      const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a", maxOldSpaceMb: bad }] }));
      expect(config.error, `mémoire ${bad}`).toContain("maxOldSpaceMb");
    }
  });

  it("refuse deux bots partageant le dossier d'auth (corruption de session)", () => {
    const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a", authDir: "shared" }, { id: "b", authDir: "shared" }] }));
    expect(config.error).toContain("dossier d'auth");
  });

  it("refuse deux bots partageant le dossier de données", () => {
    const config = parseBotsConfig(JSON.stringify({ bots: [{ id: "a", dataDir: "shared" }, { id: "b", dataDir: "shared" }] }));
    expect(config.error).toContain("dossier de données");
  });

  it("tronque le libellé et la persona aux bornes", () => {
    const config = parseBotsConfig(
      JSON.stringify({ bots: [{ id: "a", name: "x".repeat(80), persona: "p".repeat(5000) }] }),
    );
    expect(config.error).toBeUndefined();
    expect(config.bots[0].name).toHaveLength(40);
    expect(config.bots[0].persona).toHaveLength(4000);
  });
});

describe("bots.example.json", () => {
  it("est une config valide prête à copier", () => {
    const raw = fs.readFileSync(path.join(process.cwd(), "bots.example.json"), "utf-8");
    const config = parseBotsConfig(raw);
    expect(config.error).toBeUndefined();
    expect(config.bots.map((b) => b.id)).toEqual(["nebula", "bot2", "bot3"]);
    expect(config.bots[0].authDir).toBe(resolveAppDir("nebula_auth_info"));
    expect(config.bots.filter((b) => b.enabled)).toHaveLength(1);
    expect(new Set(config.bots.map((b) => b.enginePort)).size).toBe(3);
  });
});

describe("hasRegisteredCreds (auto-reconnexion)", () => {
  it("retourne faux sans dossier ni creds.json", () => {
    expect(hasRegisteredCreds(path.join(tmpDir, "rien"))).toBe(false);
  });

  it("retourne vrai quand la session est enregistrée", () => {
    const dir = path.join(tmpDir, "auth-ok");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ registered: true }));
    expect(hasRegisteredCreds(dir)).toBe(true);
  });

  it("retourne vrai quand l'identité me est connue", () => {
    const dir = path.join(tmpDir, "auth-me");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ me: { id: "2376:X@" } }));
    expect(hasRegisteredCreds(dir)).toBe(true);
  });

  it("retourne faux pour un creds.json vide ou corrompu", () => {
    const dir = path.join(tmpDir, "auth-vide");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ registered: false }));
    expect(hasRegisteredCreds(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "creds.json"), "{ corrompu");
    expect(hasRegisteredCreds(dir)).toBe(false);
  });
});
