import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getLogCapBytes, startLogGuard, truncateLogIfOversized } from "../src/bot/logGuard.js";

/**
 * 8.82 (retour terrain cyberpunk) — garde taille du log bot.
 *
 * La couche crypto WhatsApp (libsignal) crache de gros dumps par message
 * reçu, en conteneur Docker cron/logrotate ne tourne souvent pas → bot.log
 * a mangé ~2 Go en 3 jours et le disque est tombé à 996 Mo (batchs
 * refusés par le garde disque). Le LogGuard vit dans le process
 * superviseur : il tronque le log au plafond (150 Mo par défaut), sans
 * dépendre de cron.
 */

const ORIGINAL_ENV = { ...process.env };
let tmpDir: string;
let logFile: string;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEBULA_LOG_FILE;
  delete process.env.NEBULA_LOG_MAX_MB;
  delete process.env.NEBULA_LOG_CHECK_MS;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logguard-"));
  logFile = path.join(tmpDir, "bot.log");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("logGuard — truncateLogIfOversized", () => {
  it("tronque le log quand il dépasse le plafond", () => {
    fs.writeFileSync(logFile, "x".repeat(3 * 1024 * 1024), "utf-8"); // 3 Mo
    process.env.NEBULA_LOG_FILE = logFile;
    process.env.NEBULA_LOG_MAX_MB = "1"; // plafond 1 Mo

    const result = truncateLogIfOversized();
    expect(result.checked).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.sizeBytes).toBe(3 * 1024 * 1024);
    expect(fs.statSync(logFile).size).toBe(0);
  });

  it("ne touche pas le log sous le plafond", () => {
    fs.writeFileSync(logFile, "petit log", "utf-8");
    process.env.NEBULA_LOG_FILE = logFile;

    const result = truncateLogIfOversized();
    expect(result.truncated).toBe(false);
    expect(fs.readFileSync(logFile, "utf-8")).toBe("petit log");
  });

  it("fichier absent : aucun throw, aucune création", () => {
    process.env.NEBULA_LOG_FILE = path.join(tmpDir, "inexistant.log");
    const result = truncateLogIfOversized();
    expect(result.checked).toBe(true);
    expect(result.truncated).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "inexistant.log"))).toBe(false);
  });

  it("garde inactive sans NEBULA_LOG_FILE (dev au terminal)", () => {
    const result = truncateLogIfOversized();
    expect(result.checked).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("plafond : invalide ou vide → défaut 150 Mo ; valeur explicite respectée", () => {
    expect(getLogCapBytes()).toBe(150 * 1024 * 1024);
    process.env.NEBULA_LOG_MAX_MB = "abc";
    expect(getLogCapBytes()).toBe(150 * 1024 * 1024);
    process.env.NEBULA_LOG_MAX_MB = "1";
    expect(getLogCapBytes()).toBe(1 * 1024 * 1024);
  });
});

describe("logGuard — câblage", () => {
  it("server.ts démarre le garde au boot du panneau superviseur", () => {
    const src = fs.readFileSync("server.ts", "utf-8");
    expect(src).toContain('from "./src/bot/logGuard.js"');
    expect(src).toContain("startLogGuard();");
  });

  it("manage.sh : redirection APPEND (>>) + NEBULA_LOG_FILE transmis", () => {
    const src = fs.readFileSync("manage.sh", "utf-8");
    // append (pas de fichier sparse après truncate) + garde activé.
    // Attention : '>' est une sous-chaîne de '>>' — on vérifie donc
    // l'ABSENCE d'une redirection simple (un '>' non précédé d'un '>').
    expect(src).toContain('>>"${LOG_FILE}"');
    expect(src.match(/[^>]>"\$\{LOG_FILE\}"/g)).toBeNull();
    expect(src).toContain('NEBULA_LOG_FILE="${LOG_FILE}"');
  });

  it("logrotate durci : quotidien + maxsize (best-effort conteneur)", () => {
    const src = fs.readFileSync("manage.sh", "utf-8");
    expect(src).toContain("daily");
    expect(src).toContain("maxsize 100M");
  });

  it("startLogGuard sans fichier configuré : inactif sans throw, sans timer", () => {
    expect(() => startLogGuard()).not.toThrow();
  });
});
