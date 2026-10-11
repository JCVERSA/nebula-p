/**
 * 9.3 — éditeur .env du panneau : liste blanche, validation, masquage des
 * secrets, écriture atomique au format manage.sh, suppression par vide.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  registerEnvRoutes,
  createEnvEditor,
  parseEnvFile,
  upsertEnvKey,
  maskSecret,
  validateEnvValue,
  ENV_EDITABLE_SPECS,
} from "../src/panel/envRoutes.js";
import { readFileSync as readSrc } from "fs";

let dir: string;
let envFile: string;

function buildApp() {
  const app = express();
  app.use(express.json());
  registerEnvRoutes(app, { editor: createEnvEditor({ envFile }) });
  return app;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "env-editor-"));
  envFile = join(dir, ".env");
  writeFileSync(envFile, `OWNER_NUMBER=237640143760\nNEBULA_AI_DAILY_LIMIT="40"\n`, "utf-8");
  chmodSync(envFile, 0o600);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseEnvFile / upsertEnvKey (purs)", () => {
  it("parse les deux formats (avec/sans quotes) et ignore commentaires", () => {
    const parsed = parseEnvFile('A="x y"\nB=z\n# C=ignore\n\nD="1"');
    expect(parsed).toEqual({ A: "x y", B: "z", D: "1" });
  });

  it("upsert remplace une clé, supprime avec null, conserve le reste", () => {
    let content = 'A="1"\nB="2"\n';
    content = upsertEnvKey(content, "A", "9");
    expect(parseEnvFile(content)).toEqual({ A: "9", B: "2" });
    content = upsertEnvKey(content, "A", null);
    expect(parseEnvFile(content)).toEqual({ B: "2" });
  });

  it("maskSecret ne révèle jamais le cœur de la clé", () => {
    expect(maskSecret("tvly-abc123def456ghi789")).toBe("tvly…i789");
    expect(maskSecret("court")).toBe("••••");
    expect(maskSecret("")).toBe("");
  });
});

describe("validateEnvValue (par type)", () => {
  const spec = (key: string) => ENV_EDITABLE_SPECS.find((s) => s.key === key)!;

  it("nombres bornés (digest hour 0-23)", () => {
    expect(validateEnvValue(spec("NEBULA_DIGEST_HOUR"), "8")).toBeNull();
    expect(validateEnvValue(spec("NEBULA_DIGEST_HOUR"), "24")).toContain("Maximum");
    expect(validateEnvValue(spec("NEBULA_AI_DAILY_LIMIT"), "abc")).toContain("Nombre");
  });

  it("énuméré (moteur IA) et booléen", () => {
    expect(validateEnvValue(spec("NEBULA_AI_PRIMARY"), "nim")).toBeNull();
    expect(validateEnvValue(spec("NEBULA_AI_PRIMARY"), "gpt")).toContain("Valeurs");
    expect(validateEnvValue(spec("NEBULA_DIGEST"), "1")).toBeNull();
    expect(validateEnvValue(spec("NEBULA_DIGEST"), "oui")).toContain("0 ou 1");
  });

  it("aucune injection possible : retours ligne, quotes, longueur", () => {
    expect(validateEnvValue(spec("NEBULA_WATCH_TZ"), 'Africa/Douala\nKEY="evil"')).toContain("retours ligne");
    expect(validateEnvValue(spec("TAVILY_API_KEY"), 'tvly-"x"')).toContain("guillemets");
    expect(validateEnvValue(spec("NEBULA_WATCH_TZ"), "x".repeat(501))).toContain("longue");
  });
});

describe("GET /api/system/env", () => {
  it("liste les variables de la liste blanche avec valeurs et masque les secrets", async () => {
    writeFileSync(envFile, `TAVILY_API_KEY="tvly-abc123def456ghi789"\nNEBULA_DIGEST_HOUR="9"\n`, "utf-8");
    const res = await request(buildApp()).get("/api/system/env").expect(200);
    const byKey = Object.fromEntries(res.body.vars.map((v: any) => [v.key, v]));
    expect(res.body.vars.length).toBe(ENV_EDITABLE_SPECS.length);
    expect(byKey.TAVILY_API_KEY.value).toBe("tvly…i789"); // jamais en clair
    expect(byKey.TAVILY_API_KEY.restartRequired).toBe(true); // 9.5 : le moteur charge .env au boot
    expect(byKey.NEBULA_DIGEST_HOUR.value).toBe("9");
    expect(byKey.NEBULA_AI_DAILY_LIMIT.set).toBe(false); // absent du fichier
    expect(byKey.GEMINI_API_KEY.restartRequired).toBe(true);
  });
});

describe("POST /api/system/env", () => {
  it("écrit au format manage.sh (KEY=\"value\") et préserve les autres lignes", async () => {
    await request(buildApp())
      .post("/api/system/env")
      .send({ key: "NEBULA_DIGEST_HOUR", value: "7" })
      .expect(200, { ok: true, restartRequired: true });
    const content = readFileSync(envFile, "utf-8");
    expect(content).toContain('NEBULA_DIGEST_HOUR="7"');
    expect(content).toContain("OWNER_NUMBER=237640143760"); // intact
  });

  it("clé hors liste blanche → 400 (aucune variable arbitraire)", async () => {
    const res = await request(buildApp())
      .post("/api/system/env")
      .send({ key: "NODE_OPTIONS", value: "--require /tmp/evil" })
      .expect(400);
    expect(res.body.error).toContain("non éditable");
  });

  it("valeur invalide → 400, fichier INCHANGÉ", async () => {
    const before = readFileSync(envFile, "utf-8");
    await request(buildApp())
      .post("/api/system/env")
      .send({ key: "NEBULA_DIGEST_HOUR", value: "99" })
      .expect(400);
    expect(readFileSync(envFile, "utf-8")).toBe(before);
  });

  it("valeur vide = suppression (retour au défaut)", async () => {
    await request(buildApp())
      .post("/api/system/env")
      .send({ key: "NEBULA_AI_DAILY_LIMIT", value: "" })
      .expect(200);
    const content = readFileSync(envFile, "utf-8");
    expect(content).not.toContain("NEBULA_AI_DAILY_LIMIT");
  });

  it("toute variable moteur = redémarrage requis (9.5 : .env chargé au boot, plus de faux « à chaud »)", async () => {
    const res = await request(buildApp())
      .post("/api/system/env")
      .send({ key: "NEBULA_WEB_DAILY_LIMIT", value: "30" })
      .expect(200);
    expect(res.body.restartRequired).toBe(true);
  });
});

describe("garde de cohérence (9.3)", () => {
  it("chaque variable éditable est AUSSI dans le menu nebula env (une seule source de vérité produit)", () => {
    const manage = readSrc(join(__dirname, "../manage.sh"), "utf-8");
    const missing = ENV_EDITABLE_SPECS.filter((s) => !new RegExp(`"${s.key}\\|`).test(manage));
    expect(missing.map((m) => m.key)).toEqual([]);
  });
});
