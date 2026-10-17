import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  assessDowntime,
  formatDowntimeDuration,
  formatReturnMessage,
  readLivenessMarker,
  writeLivenessMarker
} from "../src/bot/services/downtimeService.js";

// 9.18zz — notification de chute sans FCM : heartbeat sur disque, verdict au
// retour, message WhatsApp chiffrant la coupure. Pures testées à plat ;
// marqueurs testés en round-trip sur dossier temporaire.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("9.18zz — formatDowntimeDuration (pur)", () => {
  it("échantillon de durées lisibles", () => {
    expect(formatDowntimeDuration(30 * 1000)).toBe("moins d'une minute");
    expect(formatDowntimeDuration(5 * MIN)).toBe("~5 min");
    expect(formatDowntimeDuration(83 * MIN)).toBe("~1 h 23 min");
    expect(formatDowntimeDuration(2 * HOUR)).toBe("~2 h");
    expect(formatDowntimeDuration(28 * HOUR)).toBe("~1 j 4 h");
    expect(formatDowntimeDuration(72 * HOUR)).toBe("~3 j");
  });
});

describe("9.18zz — assessDowntime (verdict, pur)", () => {
  const now = 1_800_000_000_000;

  beforeEach(() => {
    delete process.env.NEBULA_DOWNTIME_NOTIFY;
    delete process.env.NEBULA_DOWNTIME_NOTIFY_MIN;
  });
  afterEach(() => {
    delete process.env.NEBULA_DOWNTIME_NOTIFY;
    delete process.env.NEBULA_DOWNTIME_NOTIFY_MIN;
  });

  it("premier démarrage (aucun marqueur) → silence", () => {
    expect(assessDowntime(null, now)).toEqual({ notify: false, downtimeMs: 0, lastAliveAt: null });
  });

  it("process vivant (marqueur frais) → silence, pas de faux positif", () => {
    expect(assessDowntime(now - 45 * 1000, now).notify).toBe(false);
    expect(assessDowntime(now - 9 * MIN, now).notify).toBe(false); // sous le seuil 10 min
  });

  it("marqueur périmé au-delà du seuil → notification + durée", () => {
    const v = assessDowntime(now - 83 * MIN, now);
    expect(v.notify).toBe(true);
    expect(v.downtimeMs).toBe(83 * MIN);
    expect(v.lastAliveAt).toBe(now - 83 * MIN);
  });

  it("NEBULA_DOWNTIME_NOTIFY=0 coupe tout", () => {
    process.env.NEBULA_DOWNTIME_NOTIFY = "0";
    expect(assessDowntime(now - 3 * 24 * HOUR, now).notify).toBe(false);
  });

  it("NEBULA_DOWNTIME_NOTIFY_MIN resserre le seuil", () => {
    process.env.NEBULA_DOWNTIME_NOTIFY_MIN = "2";
    expect(assessDowntime(now - 3 * MIN, now).notify).toBe(true);
    expect(assessDowntime(now - 1 * MIN, now).notify).toBe(false);
  });

  it("marqueur aberrant (<= 0) → silence honnête", () => {
    expect(assessDowntime(0, now).notify).toBe(false);
    expect(assessDowntime(-5, now).notify).toBe(false);
  });
});

describe("9.18zz — formatReturnMessage (pur)", () => {
  it("annonce le retour, la durée et la dernière trace vivante", () => {
    const now = new Date(2026, 9, 17, 8, 0, 0);
    const v = assessDowntime(now.getTime() - 83 * MIN, now.getTime());
    const msg = formatReturnMessage("Nebula", v, now);
    expect(msg).toContain("Nebula");
    expect(msg).toContain("retour en ligne");
    expect(msg).toContain("~1 h 23 min");
    expect(msg).toContain("Dernière trace vivante");
    expect(msg).toContain("panneau");
  });
});

describe("9.18zz — marqueur de vie (IO, dossier temporaire)", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nebula-liveness-"));

  it("round-trip write → read", () => {
    const dir = tmp();
    try {
      expect(readLivenessMarker(dir)).toBeNull(); // absent au départ
      const at = Date.now();
      writeLivenessMarker(at, dir);
      expect(readLivenessMarker(dir)).toEqual({ at });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fichier corrompu → null, jamais de crash", () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, "liveness.json"), "{pas du json");
      expect(readLivenessMarker(dir)).toBeNull();
      fs.writeFileSync(path.join(dir, "liveness.json"), JSON.stringify({ at: "pas un nombre" }));
      expect(readLivenessMarker(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("9.18zz — wiring botEngine (style audit)", () => {
  it("le moteur capture le marqueur au démarrage et notifie au retour", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf8");
    // capture AVANT le heartbeat (sinon la détection est morte-née)
    const capture = src.indexOf("const bootAliveAt = readLivenessMarker()");
    const beat = src.indexOf("startLivenessHeartbeat()");
    expect(capture).toBeGreaterThan(-1);
    expect(beat).toBeGreaterThan(capture);
    // verdict au moment du message de connexion
    expect(src).toContain("assessDowntime(bootAliveAt");
    expect(src).toContain("formatReturnMessage(config.botName, downtime)");
    expect(src).toContain("[CHUTE]");
  });

  it("l'opérationneur peut couper/régler la notification (env)", () => {
    const env = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("NEBULA_DOWNTIME_NOTIFY");
    expect(env).toContain("NEBULA_DOWNTIME_NOTIFY_MIN");
  });
});
