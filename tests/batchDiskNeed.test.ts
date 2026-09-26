import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import { estimateBatchNeedMB } from "../src/bot/commands/novabox.js";
import { availableForNewClaims } from "../src/bot/diskClaims.js";

/**
 * 8.81 (retour terrain Cyberpunk) — réservation disque au besoin RÉEL.
 *
 * Contexte prod : `.a va cyberpunk` 10 épisodes × 108 Mo refusé parce que la
 * réservation portait le PLAFOND entier (2048 Mo) sur un disque à 996 Mo
 * libres. Décision owner : la réservation = taille estimée réelle du batch
 * (× 1,5 de marge transitoire/zip), plafonnée au ceiling ; réserve minimale
 * maintenue à 500 Mo. Le message de refus indique combien d'épisodes
 * passent avec l'espace actuel.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEBULA_NOVABOX_MAX_BATCH_MB;
  delete process.env.NEBULA_MIN_FREE_DISK_MB;
  delete process.env.NEBULA_CLAIMS_DIR;
  delete process.env.NEBULA_DISK_GUARD;
});

describe("estimateBatchNeedMB — besoin disque réel d'un batch", () => {
  it("cas terrain : 10 épisodes × 108 Mo → 1620 Mo (plus 2048)", () => {
    expect(estimateBatchNeedMB(108, 10)).toBe(1620);
  });

  it("petit batch : 3 épisodes × 108 Mo → 486 Mo (débloque les petits disques)", () => {
    expect(estimateBatchNeedMB(108, 3)).toBe(486);
  });

  it("un seul épisode → marge minimale × 1,5", () => {
    expect(estimateBatchNeedMB(108, 1)).toBe(162);
  });

  it("plafonne au ceiling NEBULA_NOVABOX_MAX_BATCH_MB (défaut 2048)", () => {
    // 10 × 500 Mo × 1,5 = 7500 → plafonné à 2048.
    expect(estimateBatchNeedMB(500, 10)).toBe(2048);
  });

  it("plancher 50 Mo (estimation inconnue, mini-batch)", () => {
    expect(estimateBatchNeedMB(1, 1)).toBe(50);
  });

  it("estimation manquante ou invalide → repli 75 Mo/épisode", () => {
    expect(estimateBatchNeedMB(0, 2)).toBe(225); // 75 × 2 × 1,5
    expect(estimateBatchNeedMB(Number.NaN, 2)).toBe(225);
  });
});

describe("câblage de la réservation réelle dans novabox", () => {
  it("sendFinalEpisode réclame estimateBatchNeedMB(…), plus le plafond entier", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("acquireDiskClaim(batchJob.id, batchNeedMB * 1024 * 1024)");
    expect(src).not.toContain("acquireDiskClaim(batchJob.id, MAX_BATCH_TOTAL_MB * 1024 * 1024)");
    expect(src).toContain("estimateBatchNeedMB(perEpisodeMB, indices.length)");
  });

  it("l'étape qualité mémorise la taille estimée dans la session", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("session.selectedVariantEstimatedMB = selectedVariant.estimatedSizeMB;");
    expect(src).toContain("selectedVariantEstimatedMB?: number;");
  });

  it("le refus conseille un nombre d'épisodes (au lieu d'attendre un autre batch)", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("availableForNewClaims()");
    expect(src).toContain("épisode(s) maximum d'un coup");
    // Fin de message propre — plus de queue « ., » signalée en prod.
    expect(src).not.toContain("réessaie une fois terminés._");
  });
});

describe("availableForNewClaims — budget indicatif du message de refus", () => {
  it("retourne un nombre positif ou null, jamais négatif", () => {
    const v = availableForNewClaims();
    if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("réserve énorme → budget indicatif à 0", () => {
    process.env.NEBULA_MIN_FREE_DISK_MB = String(1024 * 1024 * 1024); // 1 Po
    expect(availableForNewClaims()).toBe(0);
  });
});
