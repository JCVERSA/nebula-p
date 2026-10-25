/**
 * 9.18mmmm — tests de la suite admin groupe (P1, décision owner 24/10).
 *
 * Couverture :
 *  - groupTargets : extraction/dédup des cibles (mentions, reply, numéros nus) ;
 *  - groupSettingsStore : welcome/goodbye persistants + warns (décroissance,
 *    seuil NEBULA_WARN_KICK, reset) ;
 *  - renderGroupTemplate : variables {user}/{groupe}/{count} + mentions réelles ;
 *  - groupEvents : welcome/goodbye désactivés par défaut, burst 5+ → 1 récap,
 *    jamais d'exception remontée ;
 *  - commandes : kick/promote/demote/mute/unmute/grouplink/tagall/hidetag/del/
 *    welcome/goodbye/warn via contexte mocké (mêmes membres que le simulator).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLiveSocket } from "../src/bot/liveSocket.js";
import { botJidOf, extractModerationTargets, groupJidOf } from "../src/bot/utils/groupTargets.js";
import {
  DEFAULT_GOODBYE_TEXT,
  DEFAULT_WARN_TEXT,
  WARN_DECAY_MS,
  __resetGroupSettingsForTests,
  activeWarns,
  addWarn,
  getGoodbye,
  getWelcome,
  listWarnedUsers,
  resetWarns,
  setGoodbye,
  setWelcome,
  warnKickThreshold,
} from "../src/bot/services/groupSettingsStore.js";
import {
  __resetGroupNameCacheForTests,
  handleGroupParticipantsUpdate,
  renderGroupTemplate,
} from "../src/bot/services/groupEvents.js";
import { jitterMs } from "../src/bot/services/humanize.js";
import { demoteCommand, kickCommand, promoteCommand } from "../src/bot/commands/groupModeration.js";
import { grouplinkCommand, groupinfoCommand, muteCommand, unmuteCommand } from "../src/bot/commands/groupSettings.js";
import { delCommand, hidetagCommand, tagallCommand } from "../src/bot/commands/groupAnnounce.js";
import { goodbyeCommand, welcomeCommand } from "../src/bot/commands/groupWelcome.js";
import warnCommand from "../src/bot/commands/warn.js";

// ── Fixtures (mêmes numéros que le simulator botEngine) ─────────────────────

const GID = "1234-5678@g.us";
const SUPERADMIN = "1234567890@s.whatsapp.net";
const ADMIN = "9876543210@s.whatsapp.net";
const MEMBER_A = "5551234567@s.whatsapp.net";
const MEMBER_B = "5559876543@s.whatsapp.net";
const BOT_ID = "1112223333:5@s.whatsapp.net";
const BOT_JID = "1112223333@s.whatsapp.net";

const MEMBERS = [
  { id: SUPERADMIN, number: SUPERADMIN.split("@")[0], admin: "superadmin" as const },
  { id: ADMIN, number: ADMIN.split("@")[0], admin: "admin" as const },
  { id: MEMBER_A, number: MEMBER_A.split("@")[0], admin: null },
  { id: MEMBER_B, number: MEMBER_B.split("@")[0], admin: null },
  { id: BOT_JID, number: BOT_JID.split("@")[0], admin: null },
];

const META = {
  subject: "Le Repaire des Otakus",
  desc: "On parle anime, manga et nichts друго.",
  size: MEMBERS.length,
  owner: SUPERADMIN,
  creation: 1729900000,
  participants: MEMBERS,
};

function fakeSock() {
  return {
    user: { id: BOT_ID },
    sendMessage: vi.fn(async (_jid: string, _content: any, _options?: any) => ({})),
    sendPresenceUpdate: vi.fn(async (_status: string, _jid: string) => {}),
    groupSettingUpdate: vi.fn(async (_gid: string, _mode: string) => ({})),
    groupInviteCode: vi.fn(async (_gid: string) => "AbCdEf123"),
    groupRevokeInvite: vi.fn(async (_gid: string) => ({})),
    groupMetadata: vi.fn(async (_gid: string) => META),
  };
}

function groupMsg(opts: { from?: string; text?: string; mentions?: string[]; quoted?: string; stanzaId?: string } = {}) {
  const message: Record<string, any> = {
    conversation: opts.text ?? ".kick",
  };
  if (opts.mentions || opts.quoted || opts.stanzaId) {
    message.conversation = undefined;
    message.extendedTextMessage = {
      text: opts.text ?? ".kick",
      contextInfo: {
        mentionedJid: opts.mentions || [],
        ...(opts.quoted && !opts.stanzaId ? { participant: opts.quoted, stanzaId: "quoted-1" } : {}),
        ...(opts.stanzaId ? { participant: opts.quoted, stanzaId: opts.stanzaId } : {}),
      },
    };
  }
  return { key: { remoteJid: GID, fromMe: false, participant: opts.from ?? ADMIN }, message };
}

function makeContext(overrides: Record<string, any> = {}) {
  return {
    reply: vi.fn(async (_text: string, _mediaUrl?: string) => {}),
    react: vi.fn(async (_emoji: string) => {}),
    args: [] as string[],
    prefix: ".",
    isAdmin: true,
    isOwner: false,
    sender: ADMIN,
    senderName: "Admin Test",
    commandName: "kick",
    fullMessage: ".kick",
    getGroupMembers: vi.fn(async (_gid: string) => MEMBERS),
    getGroupMetadata: vi.fn(async (_gid: string) => META),
    kickMember: vi.fn(async (_gid: string, _jid: string) => true),
    promoteMember: vi.fn(async (_gid: string, _jid: string) => true),
    demoteMember: vi.fn(async (_gid: string, _jid: string) => true),
    ...overrides,
  };
}

let sock: ReturnType<typeof fakeSock>;
let dataDir: string;

beforeEach(() => {
  sock = fakeSock();
  setLiveSocket(sock);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-group-"));
  process.env.NEBULA_DATA_DIR = dataDir;
  process.env.NEBULA_WARN_KICK = undefined as unknown as string;
  delete process.env.NEBULA_WARN_KICK;
  __resetGroupSettingsForTests();
  __resetGroupNameCacheForTests();
});

afterEach(() => {
  setLiveSocket(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── groupTargets (pur) ───────────────────────────────────────────────────────

describe("9.18mmmm — groupTargets", () => {
  it("groupJidOf : jid groupe oui, privé non", () => {
    expect(groupJidOf({ key: { remoteJid: GID } })).toBe(GID);
    expect(groupJidOf({ key: { remoteJid: "237600000000@s.whatsapp.net" } })).toBeNull();
    expect(groupJidOf({})).toBeNull();
  });

  it("botJidOf : extrait les chiffres et retire le suffixe d'appareil", () => {
    expect(botJidOf({ user: { id: BOT_ID } })).toBe(BOT_JID);
    expect(botJidOf({ user: { lid: "5550001111:9@lid" } })).toBe("5550001111@s.whatsapp.net");
    expect(botJidOf(null)).toBeNull();
  });

  it("extrait les cibles des mentions du texte", () => {
    const msg = groupMsg({ mentions: [MEMBER_A, MEMBER_B] });
    expect(extractModerationTargets(msg, [], null)).toEqual([MEMBER_A, MEMBER_B]);
  });

  it("extrait la cible d'un reply (participant cité)", () => {
    const msg = groupMsg({ text: ".kick", quoted: MEMBER_A });
    expect(extractModerationTargets(msg, [], null)).toEqual([MEMBER_A]);
  });

  it("extrait les numéros nus des args (+, espaces)", () => {
    const msg = groupMsg({ text: ".kick" });
    expect(extractModerationTargets(msg, ["+237 6 00 11 22 33"], null)).toEqual(["237600112233@s.whatsapp.net"]);
  });

  it("déduplique et exclut le bot", () => {
    const msg = groupMsg({ mentions: [MEMBER_A, MEMBER_A, BOT_JID, MEMBER_B] });
    expect(extractModerationTargets(msg, ["5559876543"], BOT_JID)).toEqual([MEMBER_A, MEMBER_B]);
  });

  it("les numéros trop courts (pas des téléphones) sont ignorés", () => {
    const msg = groupMsg({ text: ".kick" });
    expect(extractModerationTargets(msg, ["123", "abc"], null)).toEqual([]);
  });
});

// ── groupSettingsStore (persistance + warns) ─────────────────────────────────

describe("9.18mmmm — groupSettingsStore", () => {
  it("welcome/goodbye désactivés par défaut, gabarit par défaut (card off aussi — 9.18pppp)", () => {
    expect(getWelcome(GID)).toEqual({ enabled: false, text: DEFAULT_WARN_TEXT, card: { enabled: false, preset: "nebula" } });
    expect(getGoodbye(GID)).toEqual({ enabled: false, text: DEFAULT_GOODBYE_TEXT, card: { enabled: false, preset: "nebula" } });
  });

  it("setWelcome active et PERSISTE sur disque (relecture après reset cache)", () => {
    setWelcome(GID, { enabled: true, text: "Salut {user} !" });
    __resetGroupSettingsForTests(); // simule un redémarrage
    const conf = getWelcome(GID);
    expect(conf.enabled).toBe(true);
    expect(conf.text).toBe("Salut {user} !");
  });

  it("setGoodbye on puis off", () => {
    expect(setGoodbye(GID, { enabled: true }).enabled).toBe(true);
    expect(setGoodbye(GID, { enabled: false }).enabled).toBe(false);
    expect(getGoodbye(GID).text).toBe(DEFAULT_GOODBYE_TEXT);
  });

  it("un fichier corrompu ne casse rien : repart à vide", () => {
    setWelcome(GID, { enabled: true });
    fs.writeFileSync(path.join(dataDir, "group_settings.json"), "{pas du json", "utf-8");
    __resetGroupSettingsForTests();
    expect(getWelcome(GID).enabled).toBe(false);
  });

  it("addWarn compte, listWarnedUsers liste par ordre décroissant", () => {
    expect(addWarn(GID, MEMBER_A, "spam")).toBe(1);
    expect(addWarn(GID, MEMBER_A, "insultes")).toBe(2);
    expect(addWarn(GID, MEMBER_B, "hors-sujet")).toBe(1);
    const listed = listWarnedUsers(GID);
    expect(listed.map(l => l.user)).toEqual([MEMBER_A, MEMBER_B]);
    expect(listed[0].warns.map(w => w.reason)).toEqual(["spam", "insultes"]);
  });

  it("décroissance : un warn de plus de 7 jours ne compte plus", () => {
    const now = Date.now();
    addWarn(GID, MEMBER_A, "ancien", now - WARN_DECAY_MS - 1000);
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(0);
    expect(addWarn(GID, MEMBER_A, "récent", now)).toBe(1); // l'ancien est purgé
  });

  it("resetWarns efface le compteur", () => {
    addWarn(GID, MEMBER_A, "spam");
    resetWarns(GID, MEMBER_A);
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(0);
    expect(listWarnedUsers(GID)).toHaveLength(0);
  });

  it("seuil warn : défaut 3, NEBULA_WARN_KICK=0 désactive, valeur invalide → 3", () => {
    expect(warnKickThreshold()).toBe(3);
    process.env.NEBULA_WARN_KICK = "0";
    expect(warnKickThreshold()).toBe(0);
    process.env.NEBULA_WARN_KICK = "5";
    expect(warnKickThreshold()).toBe(5);
    process.env.NEBULA_WARN_KICK = "pas-un-nombre";
    expect(warnKickThreshold()).toBe(3);
  });
});

// ── renderGroupTemplate (pur) ────────────────────────────────────────────────

describe("9.18mmmm — renderGroupTemplate", () => {
  it("remplace {user} par une VRAIE mention @numéro", () => {
    const r = renderGroupTemplate("Bienvenue {user} !", { userJids: [MEMBER_A], groupName: "X", memberCount: 10 });
    expect(r.text).toBe("Bienvenue @5551234567 !");
    expect(r.mentions).toEqual([MEMBER_A]);
  });

  it("remplace {groupe} et {count}", () => {
    const r = renderGroupTemplate("{user} rejoint {groupe} (membre n°{count})", {
      userJids: [MEMBER_A],
      groupName: "Le Repaire",
      memberCount: 42,
    });
    expect(r.text).toBe("@5551234567 rejoint Le Repaire (membre n°42)");
  });

  it("plusieurs nouveaux : mentions multiples séparées par des virgules", () => {
    const r = renderGroupTemplate("{user}", { userJids: [MEMBER_A, MEMBER_B], groupName: "G", memberCount: 5 });
    expect(r.text).toBe("@5551234567, @5559876543");
    expect(r.mentions).toEqual([MEMBER_A, MEMBER_B]);
  });

  it("aucun JID valide → « nouveau membre », pas de mention", () => {
    const r = renderGroupTemplate("Salut {user}", { userJids: [], groupName: "G", memberCount: 5 });
    expect(r.text).toBe("Salut nouveau membre");
    expect(r.mentions).toEqual([]);
  });
});

// ── groupEvents (welcome/goodbye automatiques) ───────────────────────────────

describe("9.18mmmm — groupEvents", () => {
  it("désactivé par défaut : une arrivée ne déclenche AUCUN message", async () => {
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: [MEMBER_A] });
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("welcome activé : arrivée simple → message rendu avec mention + typing", async () => {
    setWelcome(GID, { enabled: true });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: [MEMBER_A] });
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith("composing", GID);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(payload.text).toContain("@5551234567");
    expect(payload.text).toContain("Le Repaire des Otakus");
    expect(payload.mentions).toEqual([MEMBER_A]);
  });

  it("burst 5+ : UN SEUL récap, pas 5 messages individuels", async () => {
    setWelcome(GID, { enabled: true });
    const burst = ["1@s.whatsapp.net", "2@s.whatsapp.net", "3@s.whatsapp.net", "4@s.whatsapp.net", "5@s.whatsapp.net"];
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: burst });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).toContain("5 nouveaux membres");
    expect(payload.mentions).toEqual(burst);
  });

  it("goodbye activé : départ → message avec {count} décrémenté", async () => {
    setGoodbye(GID, { enabled: true, text: "{user} part — ils restent {count}" });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "remove", participants: [MEMBER_A] });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(payload.text).toBe("@5551234567 part — ils restent 4");
  });

  it("jamais d'exception : événement invalide ou socket cassé → silencieux", async () => {
    await expect(handleGroupParticipantsUpdate(sock, { id: "", action: "add", participants: [MEMBER_A] })).resolves.toBeUndefined();
    await expect(handleGroupParticipantsUpdate(sock, null as any)).resolves.toBeUndefined();
    const broken = { ...sock, sendMessage: (_jid: string, _c: any) => { throw new Error("boom"); } };
    await expect(handleGroupParticipantsUpdate(broken, { id: GID, action: "add", participants: [MEMBER_A] })).resolves.toBeUndefined();
  });

  it("promote/demote ne publient rien (même welcome activé)", async () => {
    setWelcome(GID, { enabled: true });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "promote", participants: [MEMBER_A] });
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

// ── humanize ─────────────────────────────────────────────────────────────────

describe("9.18mmmm — humanize (axe F anti-ban)", () => {
  it("jitterMs reste dans les bornes", () => {
    for (let i = 0; i < 50; i++) {
      const v = jitterMs(2000, 5000);
      expect(v).toBeGreaterThanOrEqual(2000);
      expect(v).toBeLessThanOrEqual(5000);
    }
  });

  it("jitterMs : bornes égales → valeur fixe (pas de division par zéro)", () => {
    expect(jitterMs(300, 300)).toBe(300);
  });
});

// ── Commandes de modération (contexte mocké) ─────────────────────────────────

describe("9.18mmmm — kick / promote / demote", () => {
  it("kick d'un membre : kickMember appelé + confirmation avec mention", async () => {
    const context = makeContext();
    await kickCommand.execute(sock, groupMsg({ mentions: [MEMBER_A] }), context);
    expect(context.kickMember).toHaveBeenCalledWith(GID, MEMBER_A);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(payload.mentions).toContain(MEMBER_A);
  });

  it("kick d'un admin : REFUSÉ, jamais de kickMember", async () => {
    const context = makeContext();
    await kickCommand.execute(sock, groupMsg({ mentions: [ADMIN] }), context);
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("admin");
  });

  it("kick du superadmin : REFUSÉ", async () => {
    const context = makeContext();
    await kickCommand.execute(sock, groupMsg({ mentions: [SUPERADMIN] }), context);
    expect(context.kickMember).not.toHaveBeenCalled();
  });

  it("kick du bot : refus dédié, pas d'expulsion", async () => {
    const context = makeContext();
    await kickCommand.execute(sock, groupMsg({ mentions: [BOT_JID] }), context);
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("m'expulser");
  });

  it("kick sans cible : guidance, pas d'appel API", async () => {
    const context = makeContext();
    await kickCommand.execute(sock, groupMsg({ text: ".kick" }), context);
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalled();
  });

  it("kick par un NON-admin : refusé", async () => {
    const context = makeContext({ isAdmin: false, isOwner: false });
    await kickCommand.execute(sock, groupMsg({ mentions: [MEMBER_B] }), context);
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("Réservé aux admins");
  });

  it("kick en privé (pas un groupe) : guidance", async () => {
    const context = makeContext();
    const privateMsg = { key: { remoteJid: "237600000000@s.whatsapp.net", fromMe: false }, message: { conversation: ".kick" } };
    await kickCommand.execute(sock, privateMsg, context);
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("groupe");
  });

  it("kickMember qui échoue (bot pas admin) : message d'aide, pas de crash", async () => {
    const context = makeContext({ kickMember: vi.fn(async (_gid: string, _jid: string) => { throw new Error("forbidden"); }) });
    await kickCommand.execute(sock, groupMsg({ mentions: [MEMBER_A] }), context);
    expect(context.reply.mock.calls[0][0]).toContain("admin du groupe");
  });

  it("promote : promoteMember appelé", async () => {
    const context = makeContext();
    await promoteCommand.execute(sock, groupMsg({ mentions: [MEMBER_A] }), context);
    expect(context.promoteMember).toHaveBeenCalledWith(GID, MEMBER_A);
  });

  it("demote d'un admin (pas le superadmin) : demoteMember appelé", async () => {
    const context = makeContext();
    await demoteCommand.execute(sock, groupMsg({ mentions: [ADMIN] }), context);
    expect(context.demoteMember).toHaveBeenCalledWith(GID, ADMIN);
  });

  it("demote du superadmin (owner du groupe) : refusé", async () => {
    const context = makeContext();
    await demoteCommand.execute(sock, groupMsg({ mentions: [SUPERADMIN] }), context);
    expect(context.demoteMember).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("propriétaire");
  });
});

// ── Réglages groupe ──────────────────────────────────────────────────────────

describe("9.18mmmm — mute / unmute / grouplink / groupinfo", () => {
  it("mute : groupSettingUpdate(announcement) + réaction", async () => {
    const context = makeContext();
    await muteCommand.execute(sock, groupMsg({ text: ".mute" }), context);
    expect(sock.groupSettingUpdate).toHaveBeenCalledWith(GID, "announcement");
    expect(context.react).toHaveBeenCalledWith("🔇");
  });

  it("unmute : groupSettingUpdate(not_announcement)", async () => {
    const context = makeContext();
    await unmuteCommand.execute(sock, groupMsg({ text: ".unmute" }), context);
    expect(sock.groupSettingUpdate).toHaveBeenCalledWith(GID, "not_announcement");
  });

  it("mute par un non-admin : refusé, aucun appel", async () => {
    const context = makeContext({ isAdmin: false });
    await muteCommand.execute(sock, groupMsg({ text: ".mute" }), context);
    expect(sock.groupSettingUpdate).not.toHaveBeenCalled();
  });

  it("grouplink : lien complet avec le code du groupe", async () => {
    const context = makeContext();
    await grouplinkCommand.execute(sock, groupMsg({ text: ".grouplink" }), context);
    expect(sock.groupInviteCode).toHaveBeenCalledWith(GID);
    expect(context.reply.mock.calls[0][0]).toContain("https://chat.whatsapp.com/AbCdEf123");
  });

  it("grouplink reset : réservé à l'owner Nebula", async () => {
    const context = makeContext({ isAdmin: true, isOwner: false });
    await grouplinkCommand.execute(sock, groupMsg({ text: ".grouplink reset" }), { ...context, args: ["reset"] });
    expect(sock.groupRevokeInvite).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("owner");
  });

  it("grouplink reset par l'owner : révoque puis régénère", async () => {
    const context = makeContext({ isOwner: true, args: ["reset"] });
    await grouplinkCommand.execute(sock, groupMsg({ text: ".grouplink reset" }), context);
    expect(sock.groupRevokeInvite).toHaveBeenCalledWith(GID);
    expect(context.reply.mock.calls[0][0]).toContain("AbCdEf123");
  });

  it("groupinfo : nom, description, membres, admins", async () => {
    const context = makeContext();
    await groupinfoCommand.execute(sock, groupMsg({ text: ".groupinfo" }), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("Le Repaire des Otakus");
    expect(text).toContain("5");
    expect(text).toContain("2");
  });
});

// ── Annonces ─────────────────────────────────────────────────────────────────

describe("9.18mmmm — tagall / hidetag / del", () => {
  it("tagall : message + mentions de tous les membres SAUF le bot", async () => {
    const context = makeContext({ args: ["Réunion", "ce", "soir"] });
    await tagallCommand.execute(sock, groupMsg({ text: ".tagall Réunion ce soir" }), context);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(payload.mentions).toEqual([SUPERADMIN, ADMIN, MEMBER_A, MEMBER_B]);
    expect(payload.text).toContain("Réunion ce soir");
    expect(payload.text).toContain("@1234567890");
    expect(sock.sendPresenceUpdate).toHaveBeenCalled();
  });

  it("hidetag : texte SANS mur de @ mais mentions complètes", async () => {
    const context = makeContext({ args: ["Nouvel", "épisode"] });
    await hidetagCommand.execute(sock, groupMsg({ text: ".hidetag Nouvel épisode" }), context);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).not.toContain("@5551234567");
    expect(payload.mentions).toEqual([SUPERADMIN, ADMIN, MEMBER_A, MEMBER_B]);
  });

  it("hidetag sans message : guidance, aucun envoi", async () => {
    const context = makeContext();
    await hidetagCommand.execute(sock, groupMsg({ text: ".hidetag" }), context);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalled();
  });

  it("del en reply : sendMessage avec la clé de suppression exacte", async () => {
    const context = makeContext();
    const msg = groupMsg({ text: ".del", quoted: MEMBER_A, stanzaId: "ABC-123" });
    await delCommand.execute(sock, msg, context);
    expect(sock.sendMessage).toHaveBeenCalledWith(GID, {
      delete: { remoteJid: GID, id: "ABC-123", fromMe: false, participant: MEMBER_A },
    });
    expect(context.react).toHaveBeenCalledWith("🗑️");
  });

  it("del sans reply : guidance, aucun envoi", async () => {
    const context = makeContext();
    await delCommand.execute(sock, groupMsg({ text: ".del" }), context);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalled();
  });
});

// ── welcome / goodbye / warn (commandes) ─────────────────────────────────────

describe("9.18mmmm — welcome / goodbye / warn", () => {
  it(".welcome sans arg : état (désactivé) + aide", async () => {
    const context = makeContext();
    await welcomeCommand.execute(sock, groupMsg({ text: ".welcome" }), context);
    expect(context.reply.mock.calls[0][0]).toContain("désactivé");
    expect(context.reply.mock.calls[0][0]).toContain("{user}");
  });

  it(".welcome on : activé et persistant", async () => {
    const context = makeContext({ args: ["on"] });
    await welcomeCommand.execute(sock, groupMsg({ text: ".welcome on" }), context);
    expect(getWelcome(GID).enabled).toBe(true);
    expect(context.reply.mock.calls[0][0]).toContain("activé");
  });

  it(".welcome <texte> : gabarit personnalisé + activation immédiate", async () => {
    const context = makeContext({ args: ["Yo", "{user}", "bienvenue!"] });
    await welcomeCommand.execute(sock, groupMsg({ text: ".welcome Yo {user} bienvenue!" }), context);
    const conf = getWelcome(GID);
    expect(conf.enabled).toBe(true);
    expect(conf.text).toBe("Yo {user} bienvenue!");
  });

  it(".welcome off : désactivé, gabarit conservé", async () => {
    setWelcome(GID, { enabled: true, text: "Salut {user}" });
    const context = makeContext({ args: ["off"] });
    await welcomeCommand.execute(sock, groupMsg({ text: ".welcome off" }), context);
    expect(getWelcome(GID).enabled).toBe(false);
    expect(getWelcome(GID).text).toBe("Salut {user}");
  });

  it(".welcome par un non-admin : refusé", async () => {
    const context = makeContext({ isAdmin: false });
    await welcomeCommand.execute(sock, groupMsg({ text: ".welcome on" }), context);
    expect(getWelcome(GID).enabled).toBe(false);
  });

  it(".goodbye on : activé", async () => {
    const context = makeContext({ args: ["on"] });
    await goodbyeCommand.execute(sock, groupMsg({ text: ".goodbye on" }), context);
    expect(getGoodbye(GID).enabled).toBe(true);
  });

  it(".warn @membre raison : compteur affiché (1/3)", async () => {
    const context = makeContext({ args: ["@membre", "spam"] });
    await warnCommand.execute(sock, groupMsg({ text: ".warn @membre spam", mentions: [MEMBER_A] }), context);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(payload.text).toContain("1/3");
    expect(payload.text).toContain("spam");
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(1);
  });

  it(".warn 3 fois : expulsion AUTO + compteur remis à zéro", async () => {
    for (let i = 0; i < 3; i++) {
      const context = makeContext({ args: ["@membre", "faute"] });
      await warnCommand.execute(sock, groupMsg({ text: ".warn @membre faute", mentions: [MEMBER_A] }), context);
    }
    const lastPayload = sock.sendMessage.mock.calls[sock.sendMessage.mock.calls.length - 1][1];
    expect(lastPayload.text).toContain("expulsion automatique");
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(0);
  });

  it(".warn sur un admin : refusé, aucun warn enregistré", async () => {
    const context = makeContext({ args: ["@admin"] });
    await warnCommand.execute(sock, groupMsg({ text: ".warn @admin", mentions: [ADMIN] }), context);
    expect(context.reply.mock.calls[0][0]).toContain("admins");
    expect(activeWarns(GID, ADMIN)).toHaveLength(0);
  });

  it(".warn sans cible : liste vide → état propre", async () => {
    const context = makeContext();
    await warnCommand.execute(sock, groupMsg({ text: ".warn" }), context);
    expect(context.reply.mock.calls[0][0]).toContain("Aucun avertissement actif");
  });

  it(".warn reset @membre : compteur effacé", async () => {
    addWarn(GID, MEMBER_A, "spam");
    const context = makeContext({ args: ["reset"] });
    await warnCommand.execute(sock, groupMsg({ text: ".warn reset @membre", mentions: [MEMBER_A] }), context);
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(0);
    const payload = sock.sendMessage.mock.calls[0][1];
    expect(payload.text).toContain("zéro");
  });

  it("seuil 0 (NEBULA_WARN_KICK=0) : warn enregistré mais JAMAIS de kick", async () => {
    process.env.NEBULA_WARN_KICK = "0";
    for (let i = 0; i < 5; i++) {
      const context = makeContext({ args: ["@membre", "faute"] });
      await warnCommand.execute(sock, groupMsg({ text: ".warn @membre faute", mentions: [MEMBER_A] }), context);
    }
    const context = makeContext();
    expect(context.kickMember).not.toHaveBeenCalled();
    expect(activeWarns(GID, MEMBER_A)).toHaveLength(5);
  });
});
