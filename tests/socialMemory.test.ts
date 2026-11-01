import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 9.19j — Mémoire sociale de NOVA (unitaire, pur — aucun réseau) :
 * présence, rôles vérifiés, bloc de prompt ÉTANCHE par chat (aucun nom de
 * groupe ne fuite en DM, aucun numéro de téléphone n'entre dans un bloc),
 * kill-switch owner, miroir vault Obsidian, et les pins de câblage.
 */

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "socmem-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;
delete process.env.NEBULA_SOCIAL_MEMORY;

import {
  notePresence,
  noteGroupRoles,
  buildSocialBlock,
  knownNameOf,
  describeKnownAdmins,
  exportVaultMirror,
  isSocialMemoryEnabled,
  __resetSocialMemoryForTests
} from "../src/bot/services/socialMemory.js";
import { touchUser, getKnownUserName, __resetDirectoryForTests } from "../src/bot/userDirectory.js";

const GID = "90000000000-1234567890@g.us";
const OWNER = "10000000001@s.whatsapp.net";
const FANDIO = "20000000002@s.whatsapp.net";
const ADMIN1 = "30000000003@s.whatsapp.net";
const ADMIN2_SILENT = "40000000004@s.whatsapp.net"; // admin qui ne parle jamais → jamais nommé

function groupMeta() {
  return {
    subject: "Anime Crew",
    owner: OWNER,
    participants: [
      { id: OWNER, admin: "superadmin" },
      { id: ADMIN1, admin: "admin" },
      { id: ADMIN2_SILENT, admin: "admin" },
      { id: FANDIO, admin: null }
    ]
  };
}

beforeEach(() => {
  __resetSocialMemoryForTests();
  __resetDirectoryForTests();
});

afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
  delete process.env.NEBULA_DATA_DIR;
});

describe("9.19j — présence et rôles", () => {
  it("noteGroupRoles accepte les deux variantes Baileys (owner ET creator)", () => {
    noteGroupRoles(GID, groupMeta());
    noteGroupRoles(GID, { ...groupMeta(), owner: undefined, creator: FANDIO, subject: "Anime Crew 2" });
    const block = buildSocialBlock({
      chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isOwner: false, isGroup: true,
      senderIsCreator: true // fanion vérifié par botEngine via groupMetadata
    }) || "";
    expect(block).toContain("Anime Crew 2"); // subject rafraîchi
    expect(block).toContain("le créateur du groupe"); // creator (variante Baileys récente)
  });

  it("notePresence apprend les noms et garde une trace des renommages (≤ 4 alias)", () => {
    notePresence({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio E", isGroup: true });
    notePresence({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isGroup: true });
    exportVaultMirror();
    const peopleDir = path.join(DATA_DIR, "nova-vault", "people");
    const files = fs.readdirSync(peopleDir).filter((f) => f.startsWith("fandio-"));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(peopleDir, files[0]), "utf-8");
    expect(content).toContain("# Fandio");
    expect(content).toContain("Autres noms vus : Fandio E");
  });
});

describe("9.19j — bloc social (prompt)", () => {
  it("DM : prénom + owner reconnu, et AUCUNE fuite du groupe (étanchéité)", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isGroup: true });
    notePresence({ chatJid: OWNER, actorJid: OWNER, actorName: "Dark Neon" });

    const block =
      buildSocialBlock({
        chatJid: OWNER, actorJid: OWNER, actorName: "Dark Neon", isOwner: true, isGroup: false
      }) || "";

    expect(block).toContain("en privé avec Dark Neon");
    expect(block).toContain("owner du bot");
    // Étanchéité : le DM ne raconte pas la vie du groupe
    expect(block).not.toContain("Anime Crew");
    expect(block).not.toContain("Fandio");
  });

  it("groupe : nom, rôle de l'auteur, admins CONNUS nommés, silencieux ignorés, zéro numéro", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isGroup: true });
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isGroup: true });
    notePresence({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isGroup: true });

    const block =
      buildSocialBlock({
        chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isOwner: false, isGroup: true
      }) || "";

    expect(block).toContain("Anime Crew");
    expect(block).toContain("(4 membres)");
    expect(block).toContain("Tu réponds à Fandio — un membre du groupe");
    expect(block).toContain("Admins du groupe (3 au total) : Kitsu — 1 dont tu ne connais pas encore le nom");
    expect(block).toContain("Créateur du groupe : Dark Neon");
    expect(block).not.toContain("40000000004"); // admin silencieux : JAMAIS son numéro
    expect(block).not.toMatch(/\d{7,}/); // aucun numéro de téléphone dans le bloc
    expect(block.length).toBeLessThanOrEqual(1200); // budget prompt tenu
  });

  it("rôles distincts : admin du groupe, créateur, owner du bot en groupe", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isGroup: true });
    notePresence({ chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isGroup: true });

    const adminBlock =
      buildSocialBlock({
        chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isOwner: false, isGroup: true,
        senderIsAdmin: true // fanion vérifié par botEngine (isSenderAdmin)
      }) || "";
    expect(adminBlock).toContain("un admin du groupe");

    const ownerBlock =
      buildSocialBlock({
        chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isOwner: true, isGroup: true,
        senderIsCreator: true // owner = créateur du groupe dans groupMetadata
      }) || "";
    expect(ownerBlock).toContain("le owner du bot, ton créateur");
  });

  it("actifs récents plafonnés à 6 noms", () => {
    noteGroupRoles(GID, groupMeta());
    for (let i = 0; i < 9; i++) {
      notePresence({
        chatJid: GID,
        actorJid: `5000000000${i}@s.whatsapp.net`,
        actorName: `Membre${i}`,
        isGroup: true
      });
    }
    const block =
      buildSocialBlock({
        chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isOwner: false, isGroup: true
      }) || "";
    const listed = ["Membre0", "Membre1", "Membre2", "Membre3", "Membre4", "Membre5", "Membre6", "Membre7", "Membre8"].filter(
      (n) => block.includes(n)
    );
    expect(listed.length).toBeLessThanOrEqual(6);
  });

  it("kill-switch owner : NEBULA_SOCIAL_MEMORY=0 coupe tout", () => {
    process.env.NEBULA_SOCIAL_MEMORY = "0";
    expect(isSocialMemoryEnabled()).toBe(false);
    notePresence({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isGroup: true });
    expect(
      buildSocialBlock({ chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isOwner: false, isGroup: true })
    ).toBeNull();
    delete process.env.NEBULA_SOCIAL_MEMORY;
  });
});

describe("9.19j — miroir vault Obsidian", () => {
  it("groups/*.md et people/*.md avec liens [[ ]]", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isGroup: true });
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isGroup: true });
    exportVaultMirror();

    const groupsDir = path.join(DATA_DIR, "nova-vault", "groups");
    const gfiles = fs.readdirSync(groupsDir).filter((f) => f.startsWith("anime-crew-"));
    expect(gfiles).toHaveLength(1);
    const gcontent = fs.readFileSync(path.join(groupsDir, gfiles[0]), "utf-8");
    expect(gcontent).toContain("# Anime Crew");
    expect(gcontent).toContain("[[Dark Neon]]"); // créateur lié
    expect(gcontent).toContain("[[Kitsu]]"); // admin lié
    expect(gcontent).toContain("- Membres : 4");

    const peopleDir = path.join(DATA_DIR, "nova-vault", "people");
    const pfiles = fs.readdirSync(peopleDir);
    expect(pfiles.some((f) => f.startsWith("dark-neon-"))).toBe(true);
    const pcontent = fs.readFileSync(
      path.join(peopleDir, pfiles.find((f) => f.startsWith("dark-neon-")) as string),
      "utf-8"
    );
    expect(pcontent).toContain(`[[${gfiles[0].replace(/\.md$/, "")}]]`); // lien vers le groupe
  });
});

describe("9.19j — pins de câblage (leçon 8.49b : pinner le câblage, pas seulement les unités)", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");

  it("agentRunner : bloc social dans dynamicBlocks + auteurs sur recordExchange", () => {
    const src = read("src/bot/services/agentRunner.ts");
    expect(src).toContain("const socialBlock = buildSocialBlock({");
    expect(src).toMatch(/dynamicBlocks = \[\s*\n\s*memoryBlock,\s*\n\s*socialBlock,/);
    expect(src).toContain("{ author: info.senderName }");
  });

  it("botEngine : présence + rôles + mémoire collective branchés", () => {
    const src = read("src/bot/botEngine.ts");
    expect(src).toContain("notePresence({");
    expect(src).toContain("noteGroupRoles(senderJid, groupMetadata)");
    expect(src).toContain("recordChatter(senderJid, senderName, text)");
    expect(src).toContain("chatName: groupSubject");
    expect(src).toContain("senderIsCreator: senderIsGroupCreator");
  });

  it("agent.ts : isGroup réel (plus de false en dur) + rôle admin transmis", () => {
    const src = read("src/bot/commands/agent.ts");
    expect(src).toContain('isGroup: context.sender.endsWith("@g.us")');
    expect(src).not.toContain("isGroup: false,");
    expect(src).toContain("senderIsAdmin: context.isAdmin");
  });

  it("aiMemory : renderings nominatifs + recordChatter", () => {
    const src = read("src/bot/services/aiMemory.ts");
    expect(src).toContain("turn.author || \"User\"");
    expect(src).toContain("export function recordChatter(");
    expect(src).toContain("opts: { author?: string; now?: number } = {}");
  });
});

describe("9.19k — terrain 07:55 : nommer les admins, comprendre les mentions, se connaître", () => {
  it("« tu connais qui à part moi ? » — le bloc DM décrit la mémoire CORRECTEMENT (plus de « je n'ai pas de mémoire »)", () => {
    const block = buildSocialBlock({
      chatJid: OWNER, actorJid: OWNER, actorName: "Dark Neon", isOwner: true, isGroup: false
    }) || "";
    expect(block).toContain("Ta mémoire est par conversation");
    expect(block).toContain("Ne dis jamais que tu n'as pas de mémoire");
  });

  it("« Qui es @Arol ? » — la mention est identifiée avec son rôle vérifié, la question recentrée", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isGroup: true });
    const block = buildSocialBlock({
      chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isOwner: true, isGroup: true,
      mentionedJids: [ADMIN1]
    }) || "";
    expect(block).toContain("Le message mentionne : Kitsu (un admin du groupe)");
    expect(block).toContain("plutôt que sur toi");
  });

  it("mention d'un inconnu → honnête : « quelqu'un que tu ne connais pas encore »", () => {
    noteGroupRoles(GID, groupMeta());
    const block = buildSocialBlock({
      chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isOwner: false, isGroup: true,
      mentionedJids: ["99999999999@s.whatsapp.net"]
    }) || "";
    expect(block).toContain("quelqu'un que tu ne connais pas encore");
  });

  it("un admin qui n'a JAMAIS parlé ici mais a déjà écrit au bot est nommé (repli répertoire — identité, pas conversation)", () => {
    noteGroupRoles(GID, groupMeta());
    touchUser(ADMIN1, { name: "Arol Kam's" }); // connu du répertoire bot-wide, muet dans CE groupe
    expect(knownNameOf(ADMIN1)).toBe("Arol Kam's");
    const block = buildSocialBlock({
      chatJid: GID, actorJid: FANDIO, actorName: "Fandio", isOwner: false, isGroup: true
    }) || "";
    expect(block).toContain("Admins du groupe (3 au total) : Arol Kam's");
  });

  it("getKnownUserName : nom connu / vide pour un inconnu (pas d'exception)", () => {
    touchUser(FANDIO, { name: "Fandio E" });
    expect(getKnownUserName(FANDIO)).toBe("Fandio E");
    expect(getKnownUserName("88888888888@s.whatsapp.net")).toBe("");
  });

  it("pins de câblage 9.19k (leçon 8.49b)", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");
    const engine = read("src/bot/botEngine.ts");
    expect(engine).toContain("let mentionedOthers: string[] = [];");
    expect(engine).toContain("mentionedJids: mentionedOthers,");
    const runner = read("src/bot/services/agentRunner.ts");
    expect(runner).toContain("mentionedJids: info.mentionedJids");
    const ginfo = read("src/bot/commands/groupSettings.ts");
    expect(ginfo).toContain("knownNameOf(String(owner))"); // créateur nommé
    expect(ginfo).toContain("pas encore connu");
  });
});

describe("9.19l — terrain 08:17-08:19 : total des admins, bot exclu, garde anti-@numéro", () => {
  it("describeKnownAdmins (pur) : total, noms connus, inconnus, bot exclu, créateur à part", () => {
    noteGroupRoles(GID, groupMeta());
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Kitsu", isGroup: true });
    const BOT = "70000000007@s.whatsapp.net";
    const info = describeKnownAdmins(
      [OWNER, ADMIN1, ADMIN2_SILENT, BOT],
      ["70000000007"], // digits du bot
      [OWNER] // créateur présenté à part
    );
    expect(info.total).toBe(4);
    expect(info.names).toEqual(["Kitsu"]);
    expect(info.unknownCount).toBe(1); // ADMIN2_SILENT
    expect(info.selfIsAdmin).toBe(true); // le bot est admin mais pas un humain
  });

  it("le bloc ne liste JAMAIS le bot parmi les admins humains et annonce le TOTAL", () => {
    noteGroupRoles(GID, {
      subject: "SBF4",
      owner: OWNER,
      participants: [
        { id: OWNER, admin: "superadmin" },
        { id: "70000000007@s.whatsapp.net", admin: "admin" }, // le bot
        { id: ADMIN1, admin: "admin" }
      ]
    });
    notePresence({ chatJid: GID, actorJid: OWNER, actorName: "Dark Neon", isGroup: true });
    notePresence({ chatJid: GID, actorJid: ADMIN1, actorName: "Arol Kam's", isGroup: true });

    const block =
      buildSocialBlock({
        chatJid: GID, actorJid: ADMIN1, actorName: "Arol Kam's", isOwner: false, isGroup: true,
        selfNums: ["70000000007"]
      }) || "";

    expect(block).toContain("Admins du groupe (3 au total)"); // TOTAL annoncé — pas « juste nous deux »
    expect(block).toContain("Tu es toi-même admin de ce groupe");
    expect(block).toContain("ne te compte pas comme un membre humain");
    expect(block).not.toContain("Admins du groupe (2 au total) : Dark Neon"); // créateur à part
  });

  it("garde anti-@numéro : jamais recopier un LID brut, jamais deviner, jamais « c'est tout » prématuré", () => {
    const block = buildSocialBlock({
      chatJid: OWNER, actorJid: OWNER, actorName: "Dark Neon", isOwner: true, isGroup: false
    }) || "";
    expect(block).toContain("ne les recopie JAMAIS dans une réponse");
    expect(block).toContain("ne devine pas à qui ils renvoient");
    expect(block).toContain("n'invente pas d'explication technique");
    expect(block).toContain("tant que le total annoncé n'est pas atteint");
  });

  it("pins de câblage 9.19l (leçon 8.49b)", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");
    const runner = read("src/bot/services/agentRunner.ts");
    expect(runner).toContain("selfNums: [String((sock as any)?.user?.id");
    const ginfo = read("src/bot/commands/groupSettings.ts");
    expect(ginfo).toContain("describeKnownAdmins(");
    expect(ginfo).toContain("(dont le bot)");
    expect(ginfo).toContain("resolveLiveSocket(_sock)");
  });
});
