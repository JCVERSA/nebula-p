/**
 * 9.18aa (P2) — préférences déclarées par chat : parsing déterministe des
 * déclarations, store atomique, application aux args anime. Pur + IO tmpdir.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parsePreferenceDeclaration,
  applyDefaultQuality,
  setChatPreference,
  getChatPreference,
  clearChatPreference,
  preferenceContextBlock
} from "../src/bot/services/userPreferences.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "user-prefs-"));
  process.env.NEBULA_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.18aa (P2) — parsePreferenceDeclaration (pur)", () => {
  it("déclarations de set : marqueurs + qualité explicite ou flag r", () => {
    expect(parsePreferenceDeclaration("à partir de maintenant toujours en 720p")).toEqual({ kind: "set", quality: "720p" });
    expect(parsePreferenceDeclaration("mets 1080p par défaut")).toEqual({ kind: "set", quality: "1080p" });
    expect(parsePreferenceDeclaration("désormais 480p stp")).toEqual({ kind: "set", quality: "480p" });
    expect(parsePreferenceDeclaration("toujours r3 pour mes animes")).toEqual({ kind: "set", quality: "720p" });
    expect(parsePreferenceDeclaration("1080P par défaut")).toEqual({ kind: "set", quality: "1080p" });
    expect(parsePreferenceDeclaration("retiens 360p")).toEqual({ kind: "set", quality: "360p" });
  });

  it("annulations", () => {
    expect(parsePreferenceDeclaration("annule ma préférence")).toEqual({ kind: "clear" });
    expect(parsePreferenceDeclaration("oublie mes préférences")).toEqual({ kind: "clear" });
    expect(parsePreferenceDeclaration("plus de préférence")).toEqual({ kind: "clear" });
  });

  it("tout le reste → null (fail-open vers le chemin IA normal)", () => {
    expect(parsePreferenceDeclaration("télécharge mushoku en 720p")).toBeNull(); // pas un marqueur de persistance
    expect(parsePreferenceDeclaration("720p")).toBeNull();
    expect(parsePreferenceDeclaration("toujours en 720p et télécharge mushoku")).toBeNull(); // demande mixte → IA
    expect(parsePreferenceDeclaration("l'épisode suivant")).toBeNull();
    expect(parsePreferenceDeclaration("la suite")).toBeNull();
    expect(parsePreferenceDeclaration("")).toBeNull();
    expect(parsePreferenceDeclaration("annule le téléchargement")).toBeNull(); // pas le mot préférence
  });
});

describe("9.18aa (P2) — applyDefaultQuality (pur)", () => {
  it("anime sans qualité → qualité ajoutée", () => {
    const r = applyDefaultQuality("anime", ["va", "mushoku", "tensei", "s1", "e6"], "720p");
    expect(r).toEqual({ args: ["va", "mushoku", "tensei", "s1", "e6", "720p"], applied: true });
  });

  it("qualité déjà présente (explicite ou flag r) → inchangé", () => {
    expect(applyDefaultQuality("anime", ["a", "b", "1080p"], "720p").applied).toBe(false);
    expect(applyDefaultQuality("anime", ["a", "r4"], "720p").applied).toBe(false);
  });

  it("autre commande, pas de préférence, args vides → inchangé", () => {
    expect(applyDefaultQuality("song", ["x"], "720p").applied).toBe(false);
    expect(applyDefaultQuality("anime", ["a"], null).applied).toBe(false);
    expect(applyDefaultQuality("anime", [], "720p").applied).toBe(false);
    expect(applyDefaultQuality("anime", ["a"], "999p").applied).toBe(false);
  });
});

describe("9.18aa (P2) — store (JSON atomique, zéro contenu)", () => {
  it("set → get → clear, qualité normalisée et revalidée", () => {
    expect(setChatPreference("chat1", "720P")).toBe(true);
    expect(getChatPreference("chat1")).toEqual({ quality: "720p", ts: expect.any(Number) });
    expect(setChatPreference("chat1", "bogus")).toBe(false);
    expect(clearChatPreference("chat1")).toBe(true);
    expect(getChatPreference("chat1")).toBeNull();
    expect(clearChatPreference("chat1")).toBe(false);
  });

  it("chats isolés, bloc contexte null sans préférence", () => {
    setChatPreference("chat1", "720p");
    expect(getChatPreference("chat2")).toBeNull();
    expect(preferenceContextBlock("chat2")).toBeNull();
    expect(preferenceContextBlock("chat1")).toContain("720p");
    expect(preferenceContextBlock("chat1")).toContain("Ne demande JAMAIS la qualité");
  });
});
