import { describe, expect, it } from "vitest";
import { parseTranslateArgs, quotedTextOf } from "../src/bot/commands/trad.js";

/**
 * 9.18u — commande .trad (décision owner 14/10, issue de l'analyse de
 * google-gemma/gemma-translator : le concept, pas leur code — nos moteurs
 * NIM/Gemini traduisent déjà). L'alias .tr étant pris par .upload
 * (inventaire 8.59), le nom primaire est `trad`.
 */

describe("9.18u — parseTranslateArgs (pur)", () => {
  it("langue explicite + texte", () => {
    const r = parseTranslateArgs(["en", "Bonjour", "tout", "le", "monde"], false);
    expect(r).toEqual({ targetLang: "en", langName: "anglais", text: "Bonjour tout le monde", fromReply: false });
  });

  it("sans langue → cible FRANÇAIS par défaut (public francophone)", () => {
    const r = parseTranslateArgs(["The", "mitochondrion", "is", "the", "powerhouse"], false);
    expect(r?.targetLang).toBe("fr");
    expect(r?.langName).toBe("français");
    expect(r?.text).toBe("The mitochondrion is the powerhouse");
  });

  it("langue seule + message cité → traduction du message cité", () => {
    const r = parseTranslateArgs(["es"], true);
    expect(r).toEqual({ targetLang: "es", langName: "espagnol", text: "", fromReply: true });
  });

  it("rien + message cité → reply vers le français", () => {
    const r = parseTranslateArgs([], true);
    expect(r?.targetLang).toBe("fr");
    expect(r?.fromReply).toBe(true);
  });

  it("vide sans citation → null (usage) ; langue seule sans citation → null", () => {
    expect(parseTranslateArgs([], false)).toBeNull();
    expect(parseTranslateArgs(["en"], false)).toBeNull();
  });

  it("un mot inconnu n'est PAS une langue — tout le message est le texte", () => {
    const r = parseTranslateArgs(["bonjour", "le", "monde"], false);
    expect(r?.targetLang).toBe("fr");
    expect(r?.text).toBe("bonjour le monde");
  });
});

describe("9.18u — quotedTextOf (extraction du message cité)", () => {
  const mkMsg = (quoted: any) => ({
    key: { remoteJid: "x@s.whatsapp.net" },
    message: { extendedTextMessage: { text: ".trad en", contextInfo: { quotedMessage: quoted } } }
  });

  it("texte long (extendedTextMessage) et conversation courts", () => {
    expect(quotedTextOf(mkMsg({ extendedTextMessage: { text: "Hello world" } }))).toBe("Hello world");
    expect(quotedTextOf(mkMsg({ conversation: "Salut" }))).toBe("Salut");
  });

  it("pas de citation ou média cité → chaîne vide (jamais de crash)", () => {
    expect(quotedTextOf(mkMsg({ imageMessage: {} }))).toBe("");
    expect(quotedTextOf({ message: { conversation: "rien" } })).toBe("");
    expect(quotedTextOf(null)).toBe("");
  });
});
