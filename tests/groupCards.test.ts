/**
 * 9.18pppp — tests welcome/goodbye cards par groupe.
 *
 * Couverture :
 *  - cardRenderer : presets (5, dont classernelle image), rendus canvas
 *    réels (signature PNG), avatar/silhouette, repli preset inconnu ;
 *  - groupSettingsStore : bloc card (round-trip, merge partiel,
 *    rétrocompatibilité anciennes configs sans card) ;
 *  - commandes .welcome/.goodbye card (admin, presets, off, erreurs) ;
 *  - groupEvents : envoi image+caption, preset image, repli texte
 *    (preset invalide), burst → récap texte (jamais de rafale de cards) ;
 *  - API dashboard : liste, PUT validé, aperçus PNG (supertest).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { setLiveSocket } from "../src/bot/liveSocket.js";
import {
  CARD_PRESETS,
  DEFAULT_CARD_PRESET,
  cardAssetPath,
  isCardPreset,
  renderCard,
} from "../src/bot/services/cardRenderer.js";
import {
  __resetGroupSettingsForTests,
  getGoodbye,
  getWelcome,
  listConfiguredGroups,
  setGoodbye,
  setWelcome,
} from "../src/bot/services/groupSettingsStore.js";
import {
  __resetAvatarCacheForTests,
  __resetGroupNameCacheForTests,
  formatPhoneJid,
  handleGroupParticipantsUpdate,
} from "../src/bot/services/groupEvents.js";
import { goodbyeCommand, welcomeCommand } from "../src/bot/commands/groupWelcome.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GID = "1234-5678@g.us";
const MEMBER_A = "5551234567@s.whatsapp.net";

function fakeSock() {
  return {
    user: { id: "1112223333:5@s.whatsapp.net" },
    sendMessage: vi.fn(async (_jid: string, _content: any, _options?: any) => ({})),
    sendPresenceUpdate: vi.fn(async (_status: string, _jid: string) => {}),
    groupMetadata: vi.fn(async () => ({ subject: "Le Repaire des Otakus", size: 5, participants: [] })),
  };
}

function makeContext(overrides: Record<string, any> = {}) {
  return {
    reply: vi.fn(async (_text: string, _mediaUrl?: string) => {}),
    react: vi.fn(async (_emoji: string) => {}),
    args: [] as string[],
    prefix: ".",
    isAdmin: true,
    isOwner: false,
    sender: "9876543210@s.whatsapp.net",
    senderName: "Admin Test",
    commandName: "welcome",
    fullMessage: ".welcome",
    ...overrides,
  };
}

function msg(text = ".welcome") {
  return { key: { remoteJid: GID, fromMe: false }, message: { conversation: text } };
}

let sock: ReturnType<typeof fakeSock>;
let dataDir: string;

beforeEach(() => {
  sock = fakeSock();
  setLiveSocket(sock);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-cards-"));
  process.env.NEBULA_DATA_DIR = dataDir;
  __resetGroupSettingsForTests();
  __resetGroupNameCacheForTests();
  __resetAvatarCacheForTests();
});

afterEach(() => {
  setLiveSocket(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── cardRenderer ─────────────────────────────────────────────────────────────

describe("9.18pppp — cardRenderer", () => {
  it("5 presets : 4 génératifs + classernelle (image owner)", () => {
    expect(CARD_PRESETS).toHaveLength(5);
    expect(CARD_PRESETS.map(p => p.id)).toEqual(["nebula", "sunset", "minimal", "neon", "classernelle"]);
    expect(CARD_PRESETS.find(p => p.id === "classernelle")!.kind).toBe("image");
    expect(isCardPreset("nebula")).toBe(true);
    expect(isCardPreset("classernelle")).toBe(true);
    expect(isCardPreset("inexistant")).toBe(false);
    expect(DEFAULT_CARD_PRESET).toBe("nebula");
  });

  it("cardAssetPath : les bannières classernelle existent sur disque (welcome + goodbye)", () => {
    const w = cardAssetPath("classernelle", "welcome");
    const g = cardAssetPath("classernelle", "goodbye");
    expect(w).toBeTruthy();
    expect(g).toBeTruthy();
    expect(fs.existsSync(w!)).toBe(true);
    expect(fs.existsSync(g!)).toBe(true);
  });

  it("cardAssetPath : null pour un preset génératif ou inconnu", () => {
    expect(cardAssetPath("nebula", "welcome")).toBeNull();
    expect(cardAssetPath("inexistant", "welcome")).toBeNull();
  });

  it("renderCard : chaque preset génératif rend un vrai PNG (welcome + goodbye)", async () => {
    for (const preset of ["nebula", "sunset", "minimal", "neon"]) {
      for (const kind of ["welcome", "goodbye"] as const) {
        const buf = await renderCard({
          kind,
          preset,
          userName: "Membre Test",
          userNumber: "237600000000",
          groupName: "Le Repaire des Otakus",
          memberCount: 42,
        });
        expect(buf, `${preset}/${kind}`).toBeTruthy();
        expect(buf!.slice(1, 4).toString()).toBe("PNG");
        expect(buf!.length).toBeGreaterThan(10_000);
      }
    }
  });

  it("renderCard : avec un avatar (photo de profil) → PNG", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const c = createCanvas(64, 64);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#76bc7f";
    ctx.fillRect(0, 0, 64, 64);
    const avatar = c.toBuffer("image/png") as Buffer;
    const buf = await renderCard({
      kind: "welcome",
      preset: "nebula",
      userName: "Membre Test",
      userNumber: "237600000000",
      avatar,
      groupName: "G",
      memberCount: 5,
    });
    expect(buf).toBeTruthy();
    expect(buf!.slice(1, 4).toString()).toBe("PNG");
  });

  it("renderCard : preset inconnu → null (repli texte de l'appelant)", async () => {
    const buf = await renderCard({
      kind: "welcome",
      preset: "inexistant",
      userName: "X",
      userNumber: "1",
      groupName: "G",
    });
    expect(buf).toBeNull();
  });

  it("formatPhoneJid : numéro lisible, jamais de JID brut", () => {
    expect(formatPhoneJid("237699887766@s.whatsapp.net")).toBe("+2376 99 88 77 66");
    expect(formatPhoneJid("5551234567@s.whatsapp.net")).toBe("+55 51 23 45 67");
    expect(formatPhoneJid("1234@s.whatsapp.net")).toBe("+1234");
    expect(formatPhoneJid("")).toBe("Membre");
  });
});

// ── Store : bloc card ────────────────────────────────────────────────────────

describe("9.18pppp — groupSettingsStore : card", () => {
  it("card désactivée par défaut, preset nebula", () => {
    expect(getWelcome(GID).card).toEqual({ enabled: false, preset: "nebula" });
  });

  it("setWelcome({card}) : round-trip persistant", () => {
    setWelcome(GID, { enabled: true, card: { enabled: true, preset: "classernelle" } });
    __resetGroupSettingsForTests(); // redémarrage simulé
    expect(getWelcome(GID).card).toEqual({ enabled: true, preset: "classernelle" });
    expect(getWelcome(GID).enabled).toBe(true);
  });

  it("merge partiel : card off conserve le preset choisi", () => {
    setWelcome(GID, { card: { enabled: true, preset: "sunset" } });
    setWelcome(GID, { card: { enabled: false } });
    expect(getWelcome(GID).card).toEqual({ enabled: false, preset: "sunset" });
  });

  it("rétrocompatibilité : une ancienne config (sans card) démarre card off", () => {
    const dir = process.env.NEBULA_DATA_DIR!;
    fs.writeFileSync(
      path.join(dir, "group_settings.json"),
      JSON.stringify({ groups: { [GID]: { welcome: { enabled: true, text: "Salut {user} !" } } } }),
      "utf-8",
    );
    __resetGroupSettingsForTests();
    const conf = getWelcome(GID);
    expect(conf.enabled).toBe(true);
    expect(conf.text).toBe("Salut {user} !");
    expect(conf.card).toEqual({ enabled: false, preset: "nebula" });
  });

  it("listConfiguredGroups : les groupes configurés sont listés", () => {
    setWelcome(GID, { enabled: true });
    setGoodbye("autre@g.us", { enabled: true });
    expect(listConfiguredGroups().sort()).toEqual([GID, "autre@g.us"].sort());
  });
});

// ── Commandes .welcome card / .goodbye card ──────────────────────────────────

describe("9.18pppp — commandes .welcome/.goodbye card", () => {
  it(".welcome card nebula → card activée avec le preset", async () => {
    const context = makeContext({ args: ["card", "nebula"] });
    await welcomeCommand.execute(sock, msg(), context);
    expect(getWelcome(GID).card).toEqual({ enabled: true, preset: "nebula" });
    expect(context.reply.mock.calls[0][0]).toContain("Nebula");
  });

  it(".welcome card nebula ne touche PAS au gabarit texte (parsing dédié)", async () => {
    setWelcome(GID, { enabled: true, text: "Salut {user} !" });
    const context = makeContext({ args: ["card", "nebula"] });
    await welcomeCommand.execute(sock, msg(), context);
    expect(getWelcome(GID).text).toBe("Salut {user} !");
  });

  it(".welcome card classernelle → preset image accepté", async () => {
    const context = makeContext({ args: ["card", "classernelle"] });
    await welcomeCommand.execute(sock, msg(), context);
    expect(getWelcome(GID).card).toEqual({ enabled: true, preset: "classernelle" });
    expect(context.reply.mock.calls[0][0]).toContain("bannière");
  });

  it(".welcome card off → désactivée, preset conservé", async () => {
    setWelcome(GID, { card: { enabled: true, preset: "sunset" } });
    const context = makeContext({ args: ["card", "off"] });
    await welcomeCommand.execute(sock, msg(), context);
    expect(getWelcome(GID).card).toEqual({ enabled: false, preset: "sunset" });
  });

  it(".welcome card seul → état + liste des 5 presets", async () => {
    const context = makeContext({ args: ["card"] });
    await welcomeCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("désactivée");
    for (const p of CARD_PRESETS) expect(text).toContain(p.id);
  });

  it(".welcome card zzz → erreur honnête + liste", async () => {
    const context = makeContext({ args: ["card", "zzz"] });
    await welcomeCommand.execute(sock, msg(), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("Preset inconnu");
    expect(text).toContain("classernelle");
    expect(getWelcome(GID).card.enabled).toBe(false);
  });

  it(".goodbye card neon → goodbye configuré, welcome intact", async () => {
    const context = makeContext({ args: ["card", "neon"], commandName: "goodbye" });
    await goodbyeCommand.execute(sock, msg(), context);
    expect(getGoodbye(GID).card).toEqual({ enabled: true, preset: "neon" });
    expect(getWelcome(GID).card.enabled).toBe(false);
  });

  it("non-admin → refusé, aucune config changée", async () => {
    const context = makeContext({ isAdmin: false, isOwner: false, args: ["card", "nebula"] });
    await welcomeCommand.execute(sock, msg(), context);
    expect(context.reply.mock.calls[0][0]).toContain("Réservé aux admins");
    expect(getWelcome(GID).card.enabled).toBe(false);
  });
});

// ── groupEvents : envoi des cards ────────────────────────────────────────────

describe("9.18pppp — groupEvents : livraison des cards", () => {
  it("welcome card générative → image + caption avec la vraie mention", async () => {
    setWelcome(GID, { enabled: true, card: { enabled: true, preset: "nebula" } });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: [MEMBER_A] });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = sock.sendMessage.mock.calls[0];
    expect(to).toBe(GID);
    expect(Buffer.isBuffer(payload.image)).toBe(true);
    expect(payload.image.slice(1, 4).toString()).toBe("PNG");
    expect(payload.caption).toContain("@5551234567");
    expect(payload.mentions).toEqual([MEMBER_A]);
    expect(sock.sendPresenceUpdate).toHaveBeenCalled();
  });

  it("goodbye card classernelle → la bannière owner part telle quelle (image URL)", async () => {
    setGoodbye(GID, { enabled: true, card: { enabled: true, preset: "classernelle" } });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "remove", participants: [MEMBER_A] });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.image).toEqual({ url: expect.stringContaining("preset-classernelle-goodbye.png") });
    expect(payload.caption).toContain("@5551234567");
  });

  it("card activée mais preset invalide (config corrompue) → repli texte seul", async () => {
    setWelcome(GID, { enabled: true, card: { enabled: true, preset: "zzz" } });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: [MEMBER_A] });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).toBeTruthy();
    expect(payload.image).toBeUndefined();
  });

  it("burst 5+ arrivées avec card activée → récap TEXTE unique, pas de rafale de cards", async () => {
    setWelcome(GID, { enabled: true, card: { enabled: true, preset: "nebula" } });
    const burst = ["1@s.whatsapp.net", "2@s.whatsapp.net", "3@s.whatsapp.net", "4@s.whatsapp.net", "5@s.whatsapp.net"];
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: burst });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).toContain("5 nouveaux membres");
    expect(payload.image).toBeUndefined();
  });

  it("2 départs d'un coup avec card → texte groupé, pas de card", async () => {
    setGoodbye(GID, { enabled: true, card: { enabled: true, preset: "nebula" } });
    await handleGroupParticipantsUpdate(sock, {
      id: GID,
      action: "remove",
      participants: [MEMBER_A, "5559876543@s.whatsapp.net"],
    });
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).toBeTruthy();
    expect(payload.image).toBeUndefined();
  });

  it("card désactivée → comportement historique (texte seul)", async () => {
    setWelcome(GID, { enabled: true, card: { enabled: false, preset: "nebula" } });
    await handleGroupParticipantsUpdate(sock, { id: GID, action: "add", participants: [MEMBER_A] });
    const [, payload] = sock.sendMessage.mock.calls[0];
    expect(payload.text).toBeTruthy();
    expect(payload.image).toBeUndefined();
  });
});

// ── API dashboard (supertest) ────────────────────────────────────────────────

describe("9.18pppp — API dashboard group-cards", () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    const { initRegistry } = await import("../src/bot/commandRegistry.js");
    await initRegistry();
    app = createApp();
  });

  const auth = { Authorization: "Bearer test-panel-token" };

  it("GET /api/bot/group-cards → presets + configs (sans auth → 401)", async () => {
    const noAuth = await request(app).get("/api/bot/group-cards");
    expect(noAuth.status).toBe(401);

    setWelcome(GID, { enabled: true, card: { enabled: true, preset: "sunset" } });
    const res = await request(app).get("/api/bot/group-cards").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(5);
    expect(res.body.configs[GID].welcome.card).toEqual({ enabled: true, preset: "sunset" });
  });

  it("PUT /api/bot/group-cards/:gid → config écrite et relue", async () => {
    const res = await request(app)
      .put(`/api/bot/group-cards/${encodeURIComponent(GID)}`)
      .set(auth)
      .send({ welcome: { enabled: true, text: "Yo {user} !", card: { enabled: true, preset: "neon" } }, goodbye: { enabled: false } });
    expect(res.status).toBe(200);
    expect(getWelcome(GID)).toMatchObject({ enabled: true, text: "Yo {user} !", card: { enabled: true, preset: "neon" } });
    expect(getGoodbye(GID).enabled).toBe(false);
  });

  it("PUT avec preset inconnu → 400, rien d'écrit", async () => {
    const res = await request(app)
      .put(`/api/bot/group-cards/${encodeURIComponent(GID)}`)
      .set(auth)
      .send({ welcome: { card: { enabled: true, preset: "zzz" } } });
    expect(res.status).toBe(400);
    expect(getWelcome(GID).card.enabled).toBe(false);
  });

  it("GET preview générative → PNG rendu à la volée", async () => {
    const res = await request(app).get("/api/bot/group-cards/preview/nebula/welcome").set(auth);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/png");
    expect(Buffer.from(res.body).slice(1, 4).toString()).toBe("PNG");
  });

  it("GET preview classernelle → la bannière owner est servie", async () => {
    const res = await request(app).get("/api/bot/group-cards/preview/classernelle/goodbye").set(auth);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/png");
    expect(Buffer.from(res.body).slice(1, 4).toString()).toBe("PNG");
  });

  it("GET preview preset inconnu → 404", async () => {
    const res = await request(app).get("/api/bot/group-cards/preview/zzz/welcome").set(auth);
    expect(res.status).toBe(404);
  });
});
