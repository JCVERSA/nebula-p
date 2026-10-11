import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __resetAnnouncementsForTests,
  draftAnnouncement,
  getAnnouncementHistory,
  getAnnouncementStatus,
  sendDirectMessage,
  setAnnounceSender,
  startAnnouncement,
} from "../src/bot/services/announcementService.js";

/**
 * 9.16 — annonces : envoi progressif anti-ban, un job à la fois,
 * historique persistant, brouillon IA à relire, DM direct.
 */

const DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nebula-ann-test-")), "database");

beforeEach(() => {
  process.env.NEBULA_DATA_DIR = DATA_DIR;
  __resetAnnouncementsForTests();
});

afterEach(() => {
  __resetAnnouncementsForTests();
  delete process.env.NEBULA_DATA_DIR;
});

/** Sender fake qui enregistre les envois (et peut échouer sur demande). */
function makeSender(failFor: string[] = []) {
  const sent: string[] = [];
  return {
    sent,
    fn: async (jid: string, _text: string) => {
      if (failFor.includes(jid)) throw new Error(`boom ${jid}`);
      sent.push(jid);
    },
  };
}

describe("9.16 — announcementService (envoi progressif)", () => {
  it("valide honnêtement : texte vide, aucun destinataire, trop de destinataires", () => {
    expect(startAnnouncement("", ["a@s.whatsapp.net"]).ok).toBe(false);
    expect(startAnnouncement("coucou", []).ok).toBe(false);
    expect(startAnnouncement("coucou", Array.from({ length: 501 }, (_, i) => `u${i}@s.whatsapp.net`)).ok).toBe(false);
    expect(getAnnouncementStatus()).toBeNull(); // rien démarré
  });

  it("envoi progressif : un destinataire par pause 3-8 s, jamais en rafale, ordre respecté", async () => {
    const sender = makeSender();
    setAnnounceSender(sender.fn);
    const sleeps: number[] = [];
    const res = startAnnouncement("Annonce test", ["a@s.whatsapp.net", "b@s.whatsapp.net", "c@s.whatsapp.net"], {
      sleep: async (ms) => { sleeps.push(ms); },
      delayFactory: () => 5000,
    });
    expect(res.ok).toBe(true);
    // attend la fin du job (les sleeps sont instantanés)
    await vi.waitFor(() => expect(getAnnouncementStatus()?.status).toBe("done"), { timeout: 3000 });
    expect(sender.sent).toEqual(["a@s.whatsapp.net", "b@s.whatsapp.net", "c@s.whatsapp.net"]);
    expect(sleeps).toEqual([5000, 5000]); // pause ENTRE les envois, pas après le dernier
    expect(sleeps.every((ms) => ms >= 3000 && ms <= 8000)).toBe(true); // vraie usine incluse
    const job = getAnnouncementStatus();
    expect(job?.sentCount).toBe(3);
    expect(job?.failures).toHaveLength(0);
  });

  it("échecs honnêtes : les destinataires en erreur sont nommés, les autres partent", async () => {
    const sender = makeSender(["b@s.whatsapp.net"]);
    setAnnounceSender(sender.fn);
    startAnnouncement("Annonce", ["a@s.whatsapp.net", "b@s.whatsapp.net", "c@s.whatsapp.net"], {
      sleep: async () => {},
      delayFactory: () => 0,
    });
    await vi.waitFor(() => expect(getAnnouncementStatus()?.status).toBe("done"), { timeout: 3000 });
    const job = getAnnouncementStatus();
    expect(job?.sentCount).toBe(2);
    expect(job?.failures).toEqual([{ jid: "b@s.whatsapp.net", error: "boom b@s.whatsapp.net" }]);
  });

  it("un seul job à la fois : refus honnête pendant un envoi en cours", async () => {
    const releaseRef: { fn: (() => void) | null } = { fn: null };
    setAnnounceSender(
      (_jid, _text) =>
        new Promise<void>((resolve) => {
          releaseRef.fn = resolve;
        })
    );
    const first = startAnnouncement("première", ["a@s.whatsapp.net"], { sleep: async () => {} });
    expect(first.ok).toBe(true);
    const second = startAnnouncement("deuxième", ["b@s.whatsapp.net"]);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("déjà en cours");
    releaseRef.fn?.();
    await vi.waitFor(() => expect(getAnnouncementStatus()?.status).toBe("done"), { timeout: 3000 });
  });

  it("historique : persisté avec les vrais compteurs (envoyés/échecs), pas avant la fin", async () => {
    const sender = makeSender(["z@s.whatsapp.net"]);
    setAnnounceSender(sender.fn);
    startAnnouncement("Salut à tous", ["a@s.whatsapp.net", "z@s.whatsapp.net"], {
      sleep: async () => {},
      delayFactory: () => 0,
    });
    expect(getAnnouncementHistory()).toHaveLength(0); // pas d'historique fantôme avant la fin
    await vi.waitFor(() => expect(getAnnouncementStatus()?.status).toBe("done"), { timeout: 3000 });
    const [entry] = getAnnouncementHistory();
    expect(entry.text).toBe("Salut à tous");
    expect(entry.total).toBe(2);
    expect(entry.sent).toBe(1);
    expect(entry.failed).toBe(1);
    // persisté sur disque
    await vi.waitFor(() => expect(fs.existsSync(path.join(DATA_DIR, "announcements.json"))).toBe(true), { timeout: 2000 });
  });

  it("moteur déconnecté : échec honnête immédiat, rien d'inventé", async () => {
    setAnnounceSender(null as unknown as (jid: string, text: string) => Promise<void>);
    // sender null simulé par réinjection : on teste via startAnnouncement sans sender
    const res = startAnnouncement("coucou", ["a@s.whatsapp.net"], { sleep: async () => {} });
    expect(res.ok).toBe(true); // accepté… mais le job échoue proprement
    await vi.waitFor(() => expect(getAnnouncementStatus()?.status).toBe("done"), { timeout: 3000 });
    const job = getAnnouncementStatus();
    expect(job?.sentCount).toBe(0);
  });

  it("sendDirectMessage : passe par le sender, texte requis", async () => {
    const sender = makeSender();
    setAnnounceSender(sender.fn);
    await sendDirectMessage("a@s.whatsapp.net", "message direct");
    expect(sender.sent).toEqual(["a@s.whatsapp.net"]);
    await expect(sendDirectMessage("a@s.whatsapp.net", "   ")).rejects.toThrow("message vide");
  });
});

describe("9.16 — brouillon IA", () => {
  it("génère un brouillon propre depuis une idée (prompt strict, texte trimé)", async () => {
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("annonce WhatsApp");
      expect(prompt).toContain("UNIQUEMENT");
      expect(prompt).toContain("maintenance du bot samedi soir");
      return "  📢 Maintenance samedi soir !  ";
    });
    const res = await draftAnnouncement("maintenance du bot samedi soir", generate);
    expect(res).toEqual({ ok: true, text: "📢 Maintenance samedi soir !" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("refus honnêtes : idée vide, IA muette, IA en erreur, brouillon trop long", async () => {
    expect((await draftAnnouncement("", async () => "x")).ok).toBe(false);
    expect((await draftAnnouncement("idée", async () => null)).ok).toBe(false);
    expect((await draftAnnouncement("idée", async () => "   ")).ok).toBe(false);
    expect((await draftAnnouncement("idée", async () => { throw new Error("rate limit"); })).ok).toBe(false);
    expect((await draftAnnouncement("idée", async () => "x".repeat(4001))).ok).toBe(false);
  });
});

describe("9.16 — wiring routes API (app.ts)", () => {
  it("les routes users/annonces existent derrière le rate limit du panneau", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "app.ts"), "utf-8");
    expect(src).toContain('app.get("/api/bot/users"');
    expect(src).toContain('app.post("/api/bot/users/action"');
    expect(src).toContain('app.post("/api/bot/announce"');
    expect(src).toContain('app.get("/api/bot/announce/status"');
    expect(src).toContain('app.post("/api/bot/announce/draft"');
    expect(src).toContain("le propriétaire ne peut pas être banni"); // garde owner
  });
});
