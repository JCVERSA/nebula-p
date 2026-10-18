import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSlimOffersForTests,
  consumeSlimOffer,
  getSlimOffer,
  registerSlimOffer,
  slimOfferLine,
  sweepExpiredSlimOffers
} from "../src/bot/services/slimOffer.js";

// 9.18ddd — offres d'allègement : la conversion n'est jamais imposée,
// elle se propose à la livraison et se consomme par .slim (TTL 10 min).

const CHAT = "15551234567@s.whatsapp.net";
const NOW = 1_800_000_000_000;

const mkOffer = () => ({
  tempFilePath: "/tmp/nebula_temp_downloads/token_Mushoku_E13.mp4",
  sourceUrl: "https://dash2.jcversaco.qzz.io/api/media/download/token123",
  filename: "Mushoku_Tensei_3_VF_1080P_S03_E13.mp4",
  bytes: 465_600_000,
  targetMB: 190,
  meta: { title: "Mushoku Tensei 3", episode: "Episode 13", resolution: "1080P" }
});

beforeEach(() => {
  __resetSlimOffersForTests();
});

describe("9.18ddd — registre des offres", () => {
  it("enregistre puis lit l'offre d'un chat", () => {
    registerSlimOffer(CHAT, mkOffer(), NOW);
    const o = getSlimOffer(CHAT, NOW + 1000);
    expect(o).not.toBeNull();
    expect(o!.filename).toBe("Mushoku_Tensei_3_VF_1080P_S03_E13.mp4");
    expect(o!.targetMB).toBe(190);
  });

  it("consommer retire l'offre (une seule tentative par .slim)", () => {
    registerSlimOffer(CHAT, mkOffer(), NOW);
    expect(consumeSlimOffer(CHAT, NOW + 1000)).not.toBeNull();
    expect(consumeSlimOffer(CHAT, NOW + 2000)).toBeNull(); // déjà consommée
  });

  it("expire après 10 min (le fichier vit 30 min — l'offre bien moins)", () => {
    registerSlimOffer(CHAT, mkOffer(), NOW);
    expect(getSlimOffer(CHAT, NOW + 9 * 60 * 1000)).not.toBeNull();
    expect(getSlimOffer(CHAT, NOW + 11 * 60 * 1000)).toBeNull();
  });

  it("la nouvelle offre d'un chat remplace l'ancienne", () => {
    const a = mkOffer();
    const b = { ...mkOffer(), filename: "Rezero_E05.mp4" };
    registerSlimOffer(CHAT, a, NOW);
    registerSlimOffer(CHAT, b, NOW + 1000);
    const o = getSlimOffer(CHAT, NOW + 2000);
    expect(o!.filename).toBe("Rezero_E05.mp4");
  });

  it("sweepExpiredSlimOffers purge les offres périmées", () => {
    registerSlimOffer(CHAT, mkOffer(), NOW);
    registerSlimOffer("other@s.whatsapp.net", mkOffer(), NOW + 60_000);
    expect(sweepExpiredSlimOffers(NOW + 20 * 60 * 1000)).toBe(2);
    expect(getSlimOffer(CHAT, NOW + 21 * 60 * 1000)).toBeNull();
  });
});

describe("9.18ddd — slimOfferLine (la question, honnête)", () => {
  it("annonce la taille, la cible, l'ETA et le silence par défaut", () => {
    const line = slimOfferLine(465_600_000, 190, 7);
    expect(line).toContain("444 Mo");
    expect(line).toContain("~190 Mo");
    expect(line).toContain("~7 min");
    expect(line).toContain(".slim");
    expect(line).toContain("ne fais rien");
  });
});
