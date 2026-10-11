/**
 * 9.6b — describeMessageMedia : l'indice de contexte média de l'agent.
 * Pur : aucun média téléchargé, aucune IO. Vérifie aussi que la nature
 * seule est exposée (pas de contenu, pas de nom de fichier).
 */
import { describe, expect, it } from "vitest";
import { describeMessageMedia, extractQuotedMediaContent, extractQuotedText } from "../src/bot/utils/quotedMedia.js";

describe("describeMessageMedia (pur, 9.6b)", () => {
  it("média joint (caption) → how=joint avec la bonne nature", () => {
    expect(describeMessageMedia({ imageMessage: { mimetype: "image/jpeg" } }))
      .toEqual({ what: "une image", how: "joint" });
    expect(describeMessageMedia({ documentMessage: { fileName: "x.pdf" } }))
      .toEqual({ what: "un document", how: "joint" });
  });

  it("média cité en reply → how=reply, même à travers une enveloppe", () => {
    const reply = {
      extendedTextMessage: {
        text: "un lien pour ça",
        contextInfo: { quotedMessage: { videoMessage: { mimetype: "video/mp4" } } },
      },
    };
    expect(describeMessageMedia(reply)).toEqual({ what: "une vidéo", how: "reply" });
    expect(describeMessageMedia({ ephemeralMessage: { message: reply } }))
      .toEqual({ what: "une vidéo", how: "reply" });
  });

  it("aucun média → null (texte seul, message vide)", () => {
    expect(describeMessageMedia({ conversation: "salut" })).toBeNull();
    expect(describeMessageMedia(null)).toBeNull();
  });

  it("extractQuotedMediaContent tolère les enveloppes du message appelant (régression 9.6b)", () => {
    const reply = {
      extendedTextMessage: {
        text: ".up",
        contextInfo: { quotedMessage: { audioMessage: { mimetype: "audio/ogg" } } },
      },
    };
    // AVANT le fix : appelé sur le message brut enveloppé → null (bug prod).
    expect(extractQuotedMediaContent(reply)).toBeTruthy();
    expect(extractQuotedMediaContent({ ephemeralMessage: { message: reply } })).toBeTruthy();
  });

  it("9.6c — enveloppes officielles rares, avec la VRAIE librairie Baileys", () => {
    const reply = {
      extendedTextMessage: {
        text: "un lien pour ça",
        contextInfo: { quotedMessage: { videoMessage: { mimetype: "video/mp4" } } },
      },
    };
    // message appelant enveloppé (editedMessage / viewOnceMessageV2Extension)
    expect(describeMessageMedia({ editedMessage: { message: reply } }))
      .toEqual({ what: "une vidéo", how: "reply" });
    expect(describeMessageMedia({ viewOnceMessageV2Extension: { message: reply } }))
      .toEqual({ what: "une vidéo", how: "reply" });
    // média CITÉ lui-même enveloppé (chat éphémère)
    const wrappedQuoted = {
      extendedTextMessage: {
        text: ".up",
        contextInfo: { quotedMessage: { ephemeralMessage: { message: { documentMessage: {} } } } },
      },
    };
    expect(describeMessageMedia(wrappedQuoted)).toEqual({ what: "un document", how: "reply" });
  });
});

describe("extractQuotedText (pur, 9.11 audit B4)", () => {
  it("texte cité : conversation, texte long, légende de média", () => {
    expect(extractQuotedText({ conversation: "https://youtu.be/x regarde ça" })).toContain("youtu.be/x");
    expect(extractQuotedText({ extendedTextMessage: { text: "un lien https://example.com" } })).toContain("example.com");
    expect(extractQuotedText({ imageMessage: { caption: "la vidéo dont je parle" } })).toContain("la vidéo");
  });

  it("extrait borné à 200 chars et déplie les enveloppes", () => {
    expect(extractQuotedText({ conversation: "x".repeat(500) })!.length).toBeLessThanOrEqual(200);
    expect(extractQuotedText({ ephemeralMessage: { message: { conversation: "enveloppé" } } })).toBe("enveloppé");
  });

  it("sans texte → null (media sans légende, vide, objets inconnus)", () => {
    expect(extractQuotedText({ imageMessage: { mimetype: "image/jpeg" } })).toBeNull();
    expect(extractQuotedText({})).toBeNull();
    expect(extractQuotedText(null)).toBeNull();
  });
});
