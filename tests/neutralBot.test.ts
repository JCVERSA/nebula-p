/**
 * 9.18hhh — bot sans nationalité, repo sans info privée (décision owner 17/10).
 *
 *  - fuseau global via .env (NEBULA_TZ), défaut UTC : AUCUN pays codé dur ;
 *  - .gce (annales GCE Cameroun) supprimé : le registre ne contient plus
 *    aucune commande dédiée à un pays ;
 *  - le repo public ne porte plus aucun contact/nom privé (menu, persona).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { defaultConfig, effectiveTimezone } from "../src/bot/config.js";
import { reminderTimezone } from "../src/bot/services/reminderService.js";
import { getCommands, initRegistry } from "../src/bot/commandRegistry.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neutral-"));
  process.env.NEBULA_DATA_DIR = dir; // config.json absent → défauts déterministes
  delete process.env.NEBULA_TZ;
  delete process.env.NEBULA_WATCH_TZ;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
  delete process.env.NEBULA_TZ;
  delete process.env.NEBULA_WATCH_TZ;
});

describe("9.18hhh — fuseau global via .env (aucun pays codé dur)", () => {
  it("défaut : UTC", () => {
    expect(defaultConfig.timezone).toBe("UTC");
    expect(effectiveTimezone()).toBe("UTC");
    expect(reminderTimezone()).toBe("UTC");
  });

  it("NEBULA_TZ global : menu et rappels suivent", () => {
    process.env.NEBULA_TZ = "Europe/Paris";
    expect(effectiveTimezone()).toBe("Europe/Paris");
    expect(reminderTimezone()).toBe("Europe/Paris");
  });

  it("NEBULA_WATCH_TZ reste un repli dédié veilles/rappels (legacy)", () => {
    process.env.NEBULA_WATCH_TZ = "Asia/Tokyo";
    expect(reminderTimezone()).toBe("Asia/Tokyo");
    // Le menu ne suit PAS la veille : il reste sur la config/UTC.
    expect(effectiveTimezone()).toBe("UTC");
  });
});

describe("9.18hhh — .gce supprimé (aucune commande dédiée à un pays)", () => {
  it("le registre ne contient plus gce ni ses alias", async () => {
    await initRegistry();
    const names = new Set<string>();
    for (const cmd of getCommands()) {
      names.add(cmd.name.toLowerCase());
      for (const a of cmd.aliases || []) names.add(a.toLowerCase());
    }
    expect(names.has("gce")).toBe(false);
    expect(names.has("papier")).toBe(false);
  });
});

describe("9.18jjj — les planificateurs suivent la config dashboard (repli final)", () => {
  it("rappels : config dashboard timezone utilisée sans aucune variable d'env", async () => {
    const { updateConfig } = await import("../src/bot/config.js");
    updateConfig({ timezone: "Europe/Paris" });
    try {
      expect(reminderTimezone()).toBe("Europe/Paris");
      // l'env reste prioritaire
      process.env.NEBULA_TZ = "Asia/Tokyo";
      expect(reminderTimezone()).toBe("Asia/Tokyo");
    } finally {
      delete process.env.NEBULA_TZ;
      updateConfig({ timezone: "UTC" });
    }
  });
});
