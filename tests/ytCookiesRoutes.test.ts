/**
 * 9.4 — cookies YouTube collés depuis le panneau : validation Netscape,
 * écriture 0600 + .env auto, contenu jamais renvoyé, suppression propre.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  registerYtCookiesRoutes,
  createYtCookiesHandler,
  validateYtCookiesContent,
} from "../src/panel/ytCookiesRoutes.js";
import { parseEnvFile } from "../src/panel/envRoutes.js";

let dir: string;

const FUTURE = Math.floor(Date.now() / 1000) + 90 * 24 * 3600; // +90 jours
const VALID_CONTENT = [
  "# Netscape HTTP Cookie File",
  `.youtube.com\tTRUE\t/\tTRUE\t${FUTURE}\tVISITOR_INFO1_LIVE\tabc123`,
  `.youtube.com\tTRUE\t/\tTRUE\t${FUTURE + 100}\tYSC\tdef456`,
  `.google.com\tTRUE\t/\tTRUE\t${FUTURE}\tSID\txyz`,
].join("\n");

function buildApp() {
  const app = express();
  app.use(express.json());
  registerYtCookiesRoutes(app, { handler: createYtCookiesHandler({ appDir: dir }) });
  return app;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yt-cookies-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validateYtCookiesContent (pur)", () => {
  it("accepte un fichier Netscape valide et diagnostique", () => {
    const v = validateYtCookiesContent(VALID_CONTENT);
    expect(v.ok).toBe(true);
    expect(v.diagnostic!.cookieCount).toBe(3);
    expect(v.diagnostic!.domains).toContain("youtube.com");
    expect(v.diagnostic!.domains).toContain("google.com");
    expect(v.diagnostic!.maxExpiry).not.toBeNull();
  });

  it("rejette : mauvais format (6 champs), domaine non-YouTube, expiré, vide", () => {
    expect(validateYtCookiesContent("a\tb\tc\td\te\tf").ok).toBe(false); // 6 champs
    expect(validateYtCookiesContent(`.netflix.com\tTRUE\t/\tTRUE\t${FUTURE}\tNID\tx`).ok).toBe(false); // pas youtube
    const past = Math.floor(Date.now() / 1000) - 86400;
    expect(validateYtCookiesContent(`.youtube.com\tTRUE\t/\tTRUE\t${past}\tK\tx`).ok).toBe(false); // expiré
    expect(validateYtCookiesContent("   \n# que des commentaires").ok).toBe(false);
  });

  it("cookies de session (expiry 0) acceptés même sans date", () => {
    const v = validateYtCookiesContent(`.youtube.com\tTRUE\t/\tFALSE\t0\tSESSION\tx`);
    expect(v.ok).toBe(true);
    expect(v.diagnostic!.maxExpiry).toBeNull();
  });
});

describe("POST /api/system/yt-cookies", () => {
  it("écrit le fichier (0600, atome) + configure .env + diagnostic complet", async () => {
    const res = await request(buildApp())
      .post("/api/system/yt-cookies")
      .send({ content: VALID_CONTENT })
      .expect(200);
    expect(res.body.cookieCount).toBe(3);
    expect(res.body.domains).toContain("youtube.com");
    expect(res.body.maxExpiry).toBeTruthy();
    expect(res.body.restartRequired).toBe(true); // première config

    const file = join(dir, ".yt-cookies.txt");
    expect(existsSync(file)).toBe(true);
    expect((statSync(file).mode & 0o777)).toBe(0o600);
    expect(readFileSync(file, "utf-8")).toContain("VISITOR_INFO1_LIVE");
    const env = parseEnvFile(readFileSync(join(dir, ".env"), "utf-8"));
    expect(env.NEBULA_YTDLP_COOKIES).toBe(file);
  });

  it("remplacement À CHAUD quand le chemin est déjà configuré (restartRequired false)", async () => {
    const app = buildApp();
    await request(app).post("/api/system/yt-cookies").send({ content: VALID_CONTENT }).expect(200);
    const res = await request(app)
      .post("/api/system/yt-cookies")
      .send({ content: VALID_CONTENT + "\n.youtube.com\tTRUE\t/\tTRUE\t" + (FUTURE + 1) + "\tEXTRA\tv" })
      .expect(200);
    expect(res.body.cookieCount).toBe(4);
    expect(res.body.restartRequired).toBe(false);
  });

  it("contenu invalide → 400, AUCUN fichier écrit", async () => {
    await request(buildApp())
      .post("/api/system/yt-cookies")
      .send({ content: "pas\tun\tcookies\tvalide" })
      .expect(400);
    expect(existsSync(join(dir, ".yt-cookies.txt"))).toBe(false);
  });
});

describe("GET /api/system/yt-cookies (jamais le contenu)", () => {
  it("status avec métadonnées uniquement — aucune valeur de cookie dans la réponse", async () => {
    const app = buildApp();
    await request(app).post("/api/system/yt-cookies").send({ content: VALID_CONTENT }).expect(200);
    const res = await request(app).get("/api/system/yt-cookies").expect(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.cookieCount).toBe(3);
    expect(res.body.domains).toContain("youtube.com");
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("abc123"); // valeurs jamais exposées
    expect(raw).not.toContain("VISITOR_INFO1_LIVE"); // noms non plus
  });

  it("sans cookies : configured false, aucune erreur", async () => {
    const res = await request(buildApp()).get("/api/system/yt-cookies").expect(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.cookieCount).toBe(0);
  });
});

describe("DELETE /api/system/yt-cookies", () => {
  it("retire le fichier ET la variable d'env (retour mode anonyme)", async () => {
    const app = buildApp();
    await request(app).post("/api/system/yt-cookies").send({ content: VALID_CONTENT }).expect(200);
    await request(app).delete("/api/system/yt-cookies").expect(200);
    expect(existsSync(join(dir, ".yt-cookies.txt"))).toBe(false);
    expect(parseEnvFile(readFileSync(join(dir, ".env"), "utf-8")).NEBULA_YTDLP_COOKIES).toBeUndefined();
    const status = await request(app).get("/api/system/yt-cookies").expect(200);
    expect(status.body.configured).toBe(false);
  });
});
