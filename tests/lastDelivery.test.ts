import { describe, expect, it, beforeEach } from "vitest";
import { recordLastDelivery, getLastDelivery, __resetLastDeliveryForTests } from "../src/bot/services/lastDelivery.js";

/** 9.18eeee (A3) — mémoire de la dernière livraison à lien d'un chat. */
describe("9.18eeee — lastDelivery (TTL 2 h, par chat)", () => {
  beforeEach(() => __resetLastDeliveryForTests());

  it("enregistre puis rejoue la dernière livraison du chat", () => {
    recordLastDelivery("c1@s.whatsapp.net", "📥 Film…\nhttps://x/api/media/download/abc");
    const last = getLastDelivery("c1@s.whatsapp.net");
    expect(last?.text).toContain("/api/media/download/abc");
    expect(last?.chatJid).toBe("c1@s.whatsapp.net");
  });

  it("un chat n'en voit pas un autre ; TTL dépassé → null (et purge)", () => {
    recordLastDelivery("c1@s.whatsapp.net", "lien A");
    expect(getLastDelivery("c2@s.whatsapp.net")).toBeNull();
    const t0 = Date.now();
    recordLastDelivery("c1@s.whatsapp.net", "lien B", t0);
    expect(getLastDelivery("c1@s.whatsapp.net", t0 + 90 * 60 * 1000)?.text).toBe("lien B"); // 90 min < 2 h
    expect(getLastDelivery("c1@s.whatsapp.net", t0 + 2 * 60 * 60 * 1000 + 1000)).toBeNull(); // > 2 h
    expect(getLastDelivery("c1@s.whatsapp.net", t0)).toBeNull(); // purgé
  });

  it("entrées vides ignorées (jamais de livraison fantôme)", () => {
    recordLastDelivery("", "texte");
    recordLastDelivery("c@s.whatsapp.net", "");
    expect(getLastDelivery("c@s.whatsapp.net")).toBeNull();
  });
});
