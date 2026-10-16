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
  // 9.18pp (audit 16/10, F1) : les 3 var TTS n'étaient que dans manage.sh —
  // invisibles du panneau (envRoutes) et de la doc (.env.example). Le rituel
  // env du dépôt exige les TROIS sources pour toute clé actionnable : ce
  // garde-fou compare automatiquement les clés curatées.
  it("tri-sources : chaque clé actionnable curatée est dans manage.sh ET envRoutes.ts ET .env.example", () => {
    const envRoutes = readFileSync(join(__dirname, "../src/panel/envRoutes.ts"), "utf-8");
    const envExample = readFileSync(join(__dirname, "../.env.example"), "utf-8");
    const TRI_SOURCE_KEYS = [
      "NEBULA_AI_DAILY_LIMIT",
      "NEBULA_WEB_DAILY_LIMIT",
      "NEBULA_UPLOAD_MAX_MB",
      "NEBULA_SLIM_MAX_MB",
      "NEBULA_AI_PRIMARY",
      "NEBULA_ASR_MODEL",
      "NEBULA_TTS_MODEL",
      "NEBULA_TTS_VOICE",
      "NEBULA_TTS_DAILY_LIMIT",
    ];
    const missing: string[] = [];
    for (const k of TRI_SOURCE_KEYS) {
      if (!manage.includes(`"${k}|`)) missing.push(`${k} -> manage.sh ENV_KEYS`);
      if (!envRoutes.includes(`key: "${k}"`)) missing.push(`${k} -> panneau envRoutes`);
      if (!envExample.includes(k)) missing.push(`${k} -> .env.example`);
    }
    expect(missing, `Clés absentes : ${missing.join(" ; ")}`).toEqual([]);
  });
});
