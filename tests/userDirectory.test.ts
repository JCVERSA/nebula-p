import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __resetDirectoryForTests,
  isBannedUser,
  listGroups,
  listUsers,
  recordCommandUse,
  setUserBanned,
  touchGroup,
  touchUser,
} from "../src/bot/userDirectory.js";

/**
 * 9.16 — répertoire utilisateurs/groupes.
 *
 * Le répertoire est la source du gestionnaire d'utilisateurs du dashboard :
 * création à la volée au premier message, rafraîchissement du nom, compteurs,
 * bannissement. Persistance par data dir (testée réellement sur disque).
 */

const DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nebula-users-test-")), "database");

beforeEach(() => {
  process.env.NEBULA_DATA_DIR = DATA_DIR;
  __resetDirectoryForTests();
});

afterEach(() => {
  __resetDirectoryForTests();
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.16 — userDirectory (répertoire)", () => {
  it("touchUser : crée au premier message, rafraîchit ensuite (nom frais, compteurs, lastSeen)", () => {
    const t0 = Date.now() - 60_000;
    touchUser("237600000001@s.whatsapp.net", { name: "Ancien Nom", now: t0 });
    const [first] = listUsers();
    expect(first.jid).toBe("237600000001@s.whatsapp.net");
    expect(first.name).toBe("Ancien Nom");
    expect(first.firstSeen).toBe(t0);
    expect(first.messageCount).toBe(1);
    expect(first.banned).toBe(false);

    touchUser("237600000001@s.whatsapp.net", { name: "Nouveau Nom", now: t0 + 5000 });
    const [updated] = listUsers();
    expect(updated.messageCount).toBe(2);
    expect(updated.name).toBe("Nouveau Nom"); // pushName le plus frais
    expect(updated.firstSeen).toBe(t0); // inchangé
    expect(updated.lastSeen).toBe(t0 + 5000);
    expect(listUsers()).toHaveLength(1);
  });

  it("touchGroup : n'enregistre que les jids @g.us, avec subject frais", () => {
    touchGroup("120363000000000000@g.us", { name: "Le Group" });
    touchGroup("237600000001@s.whatsapp.net", { name: "pas un groupe" }); // ignoré
    const groups = listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Le Group");
    expect(groups[0].messageCount).toBe(1);
  });

  it("recordCommandUse : compte les commandes d'un utilisateur existant, ignore les inconnus", () => {
    touchUser("237600000002@s.whatsapp.net", { name: "U2" });
    recordCommandUse("237600000002@s.whatsapp.net", "a");
    recordCommandUse("237600000002@s.whatsapp.net", "menu");
    recordCommandUse("inconnu@s.whatsapp.net", "menu"); // no-op silencieux
    const [u] = listUsers();
    expect(u.commandCount).toBe(2);
    expect(u.lastCommand).toBe("menu");
  });

  it("bannissement : bascule persistante, inconnu refusé honnêtement", () => {
    touchUser("237600000003@s.whatsapp.net", { name: "U3" });
    expect(isBannedUser("237600000003@s.whatsapp.net")).toBe(false);
    expect(setUserBanned("237600000003@s.whatsapp.net", true)).toBe(true);
    expect(isBannedUser("237600000003@s.whatsapp.net")).toBe(true);
    expect(setUserBanned("237600000003@s.whatsapp.net", false)).toBe(true);
    expect(isBannedUser("237600000003@s.whatsapp.net")).toBe(false);
    expect(setUserBanned("jamais-vu@s.whatsapp.net", true)).toBe(false); // 404 honnête
  });

  it("persistance : le répertoire survit à un rechargement (atomicité du data dir)", async () => {
    touchUser("237600000004@s.whatsapp.net", { name: "Persistant" });
    setUserBanned("237600000004@s.whatsapp.net", true);
    // L'écriture est débouncée (1 s) — on attend, puis on SIMULE un redémarrage
    // en important un module frais via le cache réinitialisé.
    await new Promise((r) => setTimeout(r, 1400));
    const file = path.join(DATA_DIR, "user_directory.json");
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(raw.users["237600000004@s.whatsapp.net"].name).toBe("Persistant");
    expect(raw.users["237600000004@s.whatsapp.net"].banned).toBe(true);

    // Rechargement réel : module frais => relecture du disque
    vi.resetModules();
    const mod = await import("../src/bot/userDirectory.js");
    const reloaded = mod.listUsers();
    expect(reloaded.find((u: { jid: string }) => u.jid === "237600000004@s.whatsapp.net")?.banned).toBe(true);
    expect(mod.isBannedUser("237600000004@s.whatsapp.net")).toBe(true);
  });

  it("wiring botEngine : touch au message, ban gate owner-safe, sender annonces", async () => {
    const fs2 = await import("fs");
    const engine = fs2.readFileSync(path.resolve(process.cwd(), "src/bot/botEngine.ts"), "utf-8");
    expect(engine).toContain("touchUser(actualSenderJid");
    expect(engine).toContain("touchGroup(senderJid");
    expect(engine).toContain("!isOwner && isBannedUser(actualSenderJid)");
    expect(engine).toContain("setAnnounceSender");
  });

  it("wiring commandDispatch : les commandes exécutées nourrissent le répertoire (après RoleGuard)", async () => {
    const fs2 = await import("fs");
    const dispatch = fs2.readFileSync(path.resolve(process.cwd(), "src/bot/commandDispatch.ts"), "utf-8");
    expect(dispatch).toContain("recordCommandUse(info.actorJid, commandName)");
  });
});
