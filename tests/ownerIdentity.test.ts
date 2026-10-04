import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { resolveOwnerIdentity } from "../src/bot/ownerIdentity.js";

/**
 * 8.89 — résolution owner sous LID (WhatsApp « masquer mon numéro »).
 *
 * Contexte terrain 2026-10-03 : l'owner écrivait au bot depuis un jid @lid
 * (…5378) alors que OWNER_NUMBER est son numéro réel (…3760) → gate owner
 * toujours refusé. Le helper résout le LID via la table Baileys
 * (sock.signalRepository.lidMapping.getPNForLID) puis compare EXACTEMENT.
 *
 * Ici le « sock » est un faux structural : aucun Baileys, aucun réseau.
 */

const OWNER = "237640143760";
const OWNER_LID = "98765432105378";

const mkSock = (pn: string | null | Error) => ({
  signalRepository: {
    lidMapping: {
      getPNForLID: vi.fn(async () => {
        if (pn instanceof Error) throw pn;
        return pn;
      })
    }
  }
});

beforeEach(() => {
  delete process.env.NEBULA_OWNER_LID;
});

afterEach(() => {
  delete process.env.NEBULA_OWNER_LID;
});

describe("8.89 — jid téléphone : comportement inchangé (zéro régression)", () => {
  it("numéro = owner → owner, SANS appeler la table Baileys", async () => {
    const sock = mkSock("237999999999:0@s.whatsapp.net");
    const r = await resolveOwnerIdentity(sock as any, `${OWNER}@s.whatsapp.net`, OWNER);
    expect(r.isOwner).toBe(true);
    expect(r.senderNumber).toBe(OWNER);
    expect(r.resolvedNumber).toBeNull();
    expect(sock.signalRepository.lidMapping.getPNForLID).not.toHaveBeenCalled();
  });

  it("numéro ≠ owner → non-owner", async () => {
    const r = await resolveOwnerIdentity(mkSock(null) as any, "237999999999@s.whatsapp.net", OWNER);
    expect(r.isOwner).toBe(false);
  });

  it("comparaison EXACTE (C7) : numéro partiel ne passe pas", async () => {
    const r = await resolveOwnerIdentity(mkSock(null) as any, "23764014376@s.whatsapp.net", OWNER);
    expect(r.isOwner).toBe(false);
  });

  it("config multi-numéros : chacun des candidats est reconnu", async () => {
    const cfg = `${OWNER}, 237999888777`;
    expect((await resolveOwnerIdentity(mkSock(null) as any, "237999888777@s.whatsapp.net", cfg)).isOwner).toBe(true);
    expect((await resolveOwnerIdentity(mkSock(null) as any, "237111222333@s.whatsapp.net", cfg)).isOwner).toBe(false);
  });

  it("config owner vide → jamais owner (même numéro quelconque)", async () => {
    const r = await resolveOwnerIdentity(mkSock(null) as any, `${OWNER}@s.whatsapp.net`, "");
    expect(r.isOwner).toBe(false);
  });
});

describe("8.89 — jid @lid : résolution via la table Baileys", () => {
  it("LID résolu vers le numéro owner (suffixe de device éliminé) → owner", async () => {
    // Piège du suffixe : Baileys renvoie "237640143760:0@s.whatsapp.net" —
    // une extraction naïve des digits donnerait "2376401437600" (device
    // collé) et le gate refuserait à tort l'owner.
    const r = await resolveOwnerIdentity(mkSock(`${OWNER}:0@s.whatsapp.net`) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(true);
    expect(r.resolvedNumber).toBe(OWNER);
    expect(r.senderNumber).toBe(OWNER_LID);
  });

  it("LID résolu vers un AUTRE numéro → non-owner", async () => {
    const r = await resolveOwnerIdentity(mkSock("237999999999:0@s.whatsapp.net") as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(false);
    expect(r.resolvedNumber).toBe("237999999999");
  });

  it("table inconnue (null) + NEBULA_OWNER_LID configuré → fallback exact du LID", async () => {
    process.env.NEBULA_OWNER_LID = OWNER_LID;
    const r = await resolveOwnerIdentity(mkSock(null) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(true);
  });

  it("table inconnue + NEBULA_OWNER_LID DIFFÉRENT → non-owner (exactitude)", async () => {
    process.env.NEBULA_OWNER_LID = "1111222233334444";
    const r = await resolveOwnerIdentity(mkSock(null) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(false);
  });

  it("LID partiel ne passe pas le fallback (exactitude, esprit C7)", async () => {
    process.env.NEBULA_OWNER_LID = OWNER_LID.slice(0, -1);
    const r = await resolveOwnerIdentity(mkSock(null) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(false);
  });

  it("table inconnue + pas de NEBULA_OWNER_LID → non-owner, pas de crash", async () => {
    const r = await resolveOwnerIdentity(mkSock(null) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(false);
  });

  it("table qui JETTE une erreur → pas de crash, fallback env s'applique", async () => {
    process.env.NEBULA_OWNER_LID = OWNER_LID;
    const r = await resolveOwnerIdentity(mkSock(new Error("boom")) as any, `${OWNER_LID}@lid`, OWNER);
    expect(r.isOwner).toBe(true);
  });

  it("sock sans signalRepository (absent/null) → pas de crash, non-owner sans fallback", async () => {
    expect((await resolveOwnerIdentity(undefined, `${OWNER_LID}@lid`, OWNER)).isOwner).toBe(false);
    expect((await resolveOwnerIdentity({} as any, `${OWNER_LID}@lid`, OWNER)).isOwner).toBe(false);
  });
});

describe("8.89 — intégration structurelle (style audit 8.84)", () => {
  const readSrc = (f: string): string =>
    fs.readFileSync(path.resolve(process.cwd(), "src", f), "utf8");

  it("botEngine : le gate owner passe par resolveOwnerIdentity", () => {
    const src = readSrc("bot/botEngine.ts");
    expect(src).toContain("resolveOwnerIdentity");
    expect(src).toContain("await resolveOwnerIdentity(sock, actualSenderJid, configuredOwner)");
    expect(src).not.toContain("cleanedOwner"); // l'ancien calcul inline est retiré
  });

  it("whois : badge owner + affichage du numéro WhatsApp résolu", () => {
    const src = readSrc("bot/commands/whois.ts");
    expect(src).toContain("resolveOwnerIdentity(sock, finalTarget, ownerCfg)");
    expect(src).toContain("WhatsApp :");
  });
});
