/**
 * 9.1b — garde du menu `nebula env` (principe 9.0b, retour owner :
 * « normalement en tapant nebula env ça devait être dans la liste des
 * variables à remplir »). Toute variable que l'owner peut avoir à
 * configurer DOIT être proposée par le menu interactif — il ne doit
 * jamais deviner ni éditer le fichier à la main.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const manage = readFileSync(join(__dirname, "../manage.sh"), "utf-8");

/** Variables avec une action owner documentée (pas les vars internes/debug). */
const REQUIRED_MENU_KEYS = [
  "APP_URL",
  "PANEL_TOKEN",
  "GEMINI_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "TAVILY_API_KEY",
  "NEBULA_YTDLP_COOKIES",
  "OWNER_NUMBER",
  "NEBULA_AI_DAILY_LIMIT",
  "NEBULA_WEB_DAILY_LIMIT",
  "NEBULA_DIGEST",
  "NEBULA_DIGEST_HOUR",
];

describe("nebula env — menu complet (garde 9.0b/9.1b)", () => {
  it("chaque variable actionnable est proposée dans ENV_KEYS", () => {
    const missing = REQUIRED_MENU_KEYS.filter((k) => !manage.includes(`"${k}|`));
    expect(missing, `Absentes du menu nebula env : ${missing.join(", ")}`).toEqual([]);
  });

  it("les clés récentes (9.0/9.1) ne régressent pas : entrées + descriptions", () => {
    // Forme « CLE|description » — une clé sans description casserait l'affichage.
    for (const k of ["TAVILY_API_KEY", "NEBULA_YTDLP_COOKIES", "NEBULA_WEB_DAILY_LIMIT", "NEBULA_DIGEST_HOUR"]) {
      expect(manage.match(new RegExp(`"${k}\\|[^"]+"`)), `entrée ${k} incomplète`).not.toBeNull();
    }
  });
});
