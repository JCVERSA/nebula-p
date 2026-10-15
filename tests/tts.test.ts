/**
 * 9.18dd (P6) — .tts : nettoyage et validation du texte à lire (purs).
 * La synthèse Edge et le transcodage ffmpeg sont des IO — validés sur le
 * terrain (la sandbox n'a pas accès au service vocal Microsoft).
 */
import { describe, it, expect } from "vitest";
import { sanitizeTtsText, validateTtsText, TTS_MAX_TEXT_CHARS } from "../src/bot/services/ttsService.js";

describe("9.18dd (P6) — sanitizeTtsText (pur)", () => {
  it("retire le formatage WhatsApp (* _ ~ `)", () => {
    expect(sanitizeTtsText("*bonjour* _tout_ ~le~ `monde`")).toBe("bonjour tout le monde");
  });

  it("retire les URLs (la voix ne lit pas https://…)", () => {
    expect(sanitizeTtsText("regarde https://exemple.com/page ça vaut le coup")).toBe("regarde ça vaut le coup");
  });

  it("normalise les espaces et lignes, garde la ponctuation", () => {
    expect(sanitizeTtsText("ligne une\n\n   ligne   deux…  vraiment ?")).toBe("ligne une ligne deux… vraiment ?");
  });

  it("texte vide ou formatage seul → vide", () => {
    expect(sanitizeTtsText("")).toBe("");
    expect(sanitizeTtsText("*_*~`")).toBe("");
    expect(sanitizeTtsText("https://only-a-link.fr/x")).toBe("");
  });
});

describe("9.18dd (P6) — validateTtsText (pur)", () => {
  it("texte valide → ok, nettoyé", () => {
    const v = validateTtsText("*Bonjour* le monde");
    expect(v).toEqual({ ok: true, text: "Bonjour le monde" });
  });

  it("trop court / liens seuls → empty", () => {
    expect(validateTtsText("a")).toEqual({ ok: false, reason: "empty" });
    expect(validateTtsText("https://x.fr/a")).toEqual({ ok: false, reason: "empty" });
  });

  it("trop long → too_long (cap exporté)", () => {
    expect(validateTtsText("x".repeat(TTS_MAX_TEXT_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
    const atCap = validateTtsText("x".repeat(TTS_MAX_TEXT_CHARS));
    expect(atCap.ok).toBe(true);
  });
});
