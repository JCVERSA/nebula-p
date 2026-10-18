/**
 * 9.18ggg (audit 17/10 §4) — le filtre anti « Bad MAC » fonctionne enfin.
 *
 * libsignal 6 imprime l'erreur CONCATÉNÉE en un seul argument :
 *   console.error("Session error:" + e, e.stack)   [session_cipher.js:159]
 * L'égalité stricte args[0] === "Session error:" de 9.18b ne pouvait donc
 * JAMAIS matcher — le flot a inondé bot.log (preuve : log du 17/10, une
 * vingtaine de lignes + piles). Le préfixe matche désormais, Bad MAC étant
 * cherché dans args[0] (format réel) ou args[1] (ancien format supposé).
 */
import { describe, it, expect } from "vitest";
import { shouldSuppressSessionError, isSessionDump } from "../src/bot/suppressLibsignalNoise.js";

describe("9.18ggg — shouldSuppressSessionError (le bug du matcheur)", () => {
  it("format RÉEL libsignal 6 : argument unique concaténé, sans espace", () => {
    expect(shouldSuppressSessionError(["Session error:Error: Bad MAC Error: Bad MAC"])).toBe(true);
  });

  it("format réel + pile en 2e argument (comme dans le log du 17/10)", () => {
    expect(
      shouldSuppressSessionError([
        "Session error:Error: Bad MAC Error: Bad MAC",
        "at SessionCipher.doDecryptWhisperMessage (libsignal/src/session_cipher.js:250:16)",
      ]),
    ).toBe(true);
  });

  it("ancien format supposé : préfixe seul + erreur en 2e argument", () => {
    expect(shouldSuppressSessionError(["Session error:", new Error("Bad MAC Error: Bad MAC")])).toBe(true);
    expect(shouldSuppressSessionError(["Session error:", "Bad MAC"])).toBe(true);
  });

  it("chirurgical : les AUTRES erreurs de session passent toujours", () => {
    expect(shouldSuppressSessionError(["Session error:Error: No session found to decrypt"])).toBe(false);
    expect(shouldSuppressSessionError(["Session error:", new Error("Untrusted identity key")])).toBe(false);
    expect(shouldSuppressSessionError(["Session error:Error: Bad prefix only"])).toBe(false);
  });

  it("hors sujet : rien ne change", () => {
    expect(shouldSuppressSessionError(["Un message quelconque"])).toBe(false);
    expect(shouldSuppressSessionError([new Error("Bad MAC")])).toBe(false); // 1er argument non-string
    expect(shouldSuppressSessionError([])).toBe(false);
    expect(shouldSuppressSessionError(["Session errorsomewhere"])).toBe(false);
  });
});

describe("9.18ggg — isSessionDump (fuites de clés, 9.18e inchangé)", () => {
  it("les dumps de sessions supprimées restent détectés (préfixe)", () => {
    expect(isSessionDump(["Removing old closed session: SessionEntry { privKey… }"])).toBe(true);
    expect(isSessionDump(["Removing old closed session"])).toBe(true);
  });

  it("rien d'autre n'est filtré", () => {
    expect(isSessionDump(["Removing old shoes from the closet"])).toBe(false);
    expect(isSessionDump([{}])).toBe(false);
    expect(isSessionDump([])).toBe(false);
  });
});
