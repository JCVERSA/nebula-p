/**
 * 9.18oooo (quick wins du rapport R&D 24/10) — tests.
 *
 *  1. Watch → digest groupé : N animes d'un même chat → UN message.
 *  2. .menu <mot-clé> : filtre les sections (sans accents).
 *  3. .help <commande> : carte FR avec exemples concrets + badges d'accès.
 *  4. .dla : pins source (format audio seul, cap 60 Mo, couplage .lyrics).
 *  5. Page de garde OpenGraph sur /api/media/download (supertest) : OG pour
 *     les navigateurs/robots, fichier BRUT pour tout le reste (Range, HEAD,
 *     ?inline=true, ?dl=1, iframes, clients non-HTML).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { formatWatchDigest, runWatchCycle, type WatchSubscription } from "../src/bot/services/episodeWatchService.js";
import { initRegistry } from "../src/bot/commandRegistry.js";
import menuCommand from "../src/bot/commands/menu.js";
import helpCommand from "../src/bot/commands/help.js";
import { parseDlJson } from "../src/bot/commands/dl.js";
import { registerTempDownload } from "../src/bot/tempDownloadManager.js";

// ── 1. Watch digest ──────────────────────────────────────────────────────────

describe("9.18oooo — watch digest groupé", () => {
  const sub = (over: Partial<WatchSubscription> = {}): WatchSubscription => ({
    id: "1", chatJid: "c@g.us", title: "Sparks of Tomorrow", seasonUrl: "https://s/vf/",
    lang: "VF", lastSeenEp: 9, createdAt: 0, consecutiveErrors: 0, ...over
  });

  it("formatWatchDigest : un message qui liste tous les animes", () => {
    const text = formatWatchDigest([
      { sub: sub({ title: "Anime A", id: "1" }), fresh: [10] },
      { sub: sub({ title: "Anime B", id: "2", lang: "VOSTFR" }), fresh: [4, 5] },
    ]);
    expect(text).toContain("2 animes ont de nouveaux épisodes");
    expect(text).toContain("Anime A");
    expect(text).toContain("Anime B");
    expect(text).toContain("Ép. 10");
    expect(text).toContain("Ép. 4, 5");
    expect(text).toContain(".a Anime B s1 4-5 r1");
    expect(text).toContain("unwatch");
  });

  it("2 animes du MÊME chat → UN SEUL envoi (digest), lastSeenEp avancés", async () => {
    const a = sub({ id: "1", title: "Anime A" });
    const b = sub({ id: "2", title: "Anime B", lastSeenEp: 3, seasonUrl: "https://s/other/" });
    const sent: Array<[string, string]> = [];
    const summary = await runWatchCycle({
      send: async (jid, text) => { sent.push([jid, text]); },
      now: new Date(2026, 8, 1, 12, 0),
      tz: "UTC",
      subscriptions: [a, b],
      fetchEpisodes: async (url: string) => (url.includes("s/vf/") ? [{ n: 10 }] : [{ n: 4 }, { n: 5 }]),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe("c@g.us");
    expect(sent[0]![1]).toContain("2 animes");
    expect(summary.notified).toBe(2);
    expect(a.lastSeenEp).toBe(10);
    expect(b.lastSeenEp).toBe(5);
  });

  it("2 animes de chats DIFFÉRENTS → 2 envois (format simple chacun)", async () => {
    const a = sub({ id: "1", title: "Anime A", chatJid: "a@g.us" });
    const b = sub({ id: "2", title: "Anime B", chatJid: "b@g.us" });
    const sent: Array<[string, string]> = [];
    await runWatchCycle({
      send: async (jid, text) => { sent.push([jid, text]); },
      now: new Date(2026, 8, 1, 12, 0),
      tz: "UTC",
      subscriptions: [a, b],
      fetchEpisodes: async () => [{ n: 10 }],
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]![1]).toContain("Nouvel épisode disponible");
    expect(sent.map(s => s[0]).sort()).toEqual(["a@g.us", "b@g.us"]);
  });

  it("échec d'envoi du digest → lastSeenEp NON avancé (re-notifié au cycle suivant)", async () => {
    const a = sub({ id: "1" });
    await runWatchCycle({
      send: async () => { throw new Error("boom"); },
      now: new Date(2026, 8, 1, 12, 0),
      tz: "UTC",
      subscriptions: [a],
      fetchEpisodes: async () => [{ n: 10 }],
    });
    expect(a.lastSeenEp).toBe(9);
  });
});

// ── 2 + 3. Menu filtré & aide détaillée (contexte mocké) ─────────────────────

function fakeSock() {
  return {
    user: { id: "1112223333:5@s.whatsapp.net" },
    sendMessage: vi.fn(async (_jid: string, _content: any, _options?: any) => ({})),
  };
}

function makeContext(overrides: Record<string, any> = {}) {
  return {
    reply: vi.fn(async (_text: string, _mediaUrl?: string) => {}),
    react: vi.fn(async (_emoji: string) => {}),
    args: [] as string[],
    prefix: ".",
    isAdmin: false,
    isOwner: false,
    sender: "237600000000@s.whatsapp.net",
    senderName: "Testeur",
    commandName: "menu",
    fullMessage: ".menu",
    ...overrides,
  };
}

function msg(text = ".menu") {
  return { key: { remoteJid: "237600000000@s.whatsapp.net", fromMe: false }, message: { conversation: text } };
}

describe("9.18oooo — .menu <mot-clé> (filtre)", () => {
  beforeAll(async () => {
    await initRegistry();
  });

  it("filtre « groupe » → la section GROUPE seule, pas DOWNLOADER", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["groupe"] });
    await menuCommand.execute(sock, msg(".menu groupe"), context);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const text = sock.sendMessage.mock.calls[0][1].text;
    expect(text).toContain("GROUPE (ADMIN)");
    expect(text).toContain("kick");
    expect(text).not.toContain("DOWNLOADER");
    expect(text).toContain(".menu");
  });

  it("insensible aux accents : « definition » trouve la ligne « Définition d'un mot »", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["definition"] });
    await menuCommand.execute(sock, msg(".menu definition"), context);
    const text = sock.sendMessage.mock.calls[0][1].text;
    expect(text).toContain("AI");
    expect(text).toContain("define");
  });

  it("mot-clé inconnu → réponse honnête, aucun envoi", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["zzzzzz"] });
    await menuCommand.execute(sock, msg(".menu zzzzzz"), context);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(context.reply.mock.calls[0][0]).toContain("Aucune commande");
  });
});

describe("9.18oooo — .help <commande> (carte détaillée FR)", () => {
  beforeAll(async () => {
    await initRegistry();
  });

  it("sans argument : guide court qui mentionne le menu filtré", async () => {
    const sock = fakeSock();
    const context = makeContext({ commandName: "help" });
    await helpCommand.execute(sock, msg(".help"), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain(".help <commande>");
    expect(text).toContain(".menu <mot-clé>");
  });

  it(".help kick : description, usage réel, exemples et badge admin", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["kick"], commandName: "help" });
    await helpCommand.execute(sock, msg(".help kick"), context);
    const text = context.reply.mock.calls[0][0];
    expect(text).toContain("*kick*");
    expect(text).toContain("Utilisation");
    expect(text).toContain("Exemples");
    expect(text).toContain(".kick @membre");
    expect(text).toContain("admin du groupe");
  });

  it(".help expulse (alias) : trouve la commande kick", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["expulse"], commandName: "help" });
    await helpCommand.execute(sock, msg(".help expulse"), context);
    expect(context.reply.mock.calls[0][0]).toContain("*kick*");
  });

  it("commande inconnue → message clair qui oriente vers .menu", async () => {
    const sock = fakeSock();
    const context = makeContext({ args: ["zzzz"], commandName: "help" });
    await helpCommand.execute(sock, msg(".help zzzz"), context);
    expect(context.reply.mock.calls[0][0]).toContain("Commande inconnue");
    expect(context.reply.mock.calls[0][0]).toContain(".menu");
  });
});

// ── 4. .dla (pins source + parse pur) ───────────────────────────────────────

describe("9.18oooo — .dla (audio seul d'un lien)", () => {
  it("parseDlJson : piste audio reconnue (ext audio, pas une image)", () => {
    const info = parseDlJson(JSON.stringify({
      title: "Mon morceau", url: "https://cdn.exemple.com/a.m4a",
      ext: "m4a", extractor_key: "Soundcloud", acodec: "mp4.40.2", vcodec: "none",
    }));
    expect(info).not.toBeNull();
    expect(info!.ext).toBe("m4a");
    expect(info!.isImage).toBe(false);
    expect(info!.title).toBe("Mon morceau");
  });

  it("dl.ts : format audio seul, cap 60 Mo, livraison en musique, couplage .lyrics", () => {
    const src = fs.readFileSync("src/bot/commands/dl.ts", "utf-8");
    expect(src).toContain('AUDIO_FORMAT = "ba/bestaudio/best"');
    expect(src).toContain("MAX_AUDIO_DELIVERY_MB = 60");
    expect(src).toContain("audio: { url: localPath }");
    expect(src).toContain("rememberLastTrack");
    expect(src).toContain('name: "dla"');
  });

  it("registre : dla enregistrée et importée", async () => {
    await initRegistry();
    const reg = await import("../src/bot/commandRegistry.js");
    const cmd = reg.getCommand("dla");
    expect(cmd).toBeDefined();
    expect(cmd!.acceptsUrlArgs).toBe(true);
  });
});

// ── 5. Page de garde OpenGraph (supertest) ───────────────────────────────────

describe("9.18oooo — page OG /api/media/download (supertest)", () => {
  let app: Express;
  let token: string;
  let tmpFile: string;

  beforeAll(async () => {
    await initRegistry();
    const { createApp } = await import("../app.js");
    app = createApp();
    tmpFile = path.join(os.tmpdir(), `nebula-og-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, Buffer.alloc(5 * 1024 * 1024, 1)); // 5 Mo → taille lisible sur la carte
    const rec = registerTempDownload(tmpFile, "Episode_Test_918.mp4", { mimeType: "video/mp4" });
    token = rec.token;
  });

  afterAll(() => {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  });

  it("navigation navigateur (Accept text/html) → page OG avec titre + bouton + og:video", async () => {
    const res = await request(app).get(`/api/media/download/${token}`).set("Accept", "text/html,application/xhtml+xml");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    expect(res.text).toContain('<meta property="og:title" content="Episode_Test_918.mp4">');
    expect(res.text).toContain("og:video");
    expect(res.text).toContain('href="?dl=1"');
    expect(res.text).toContain("5,0 Mo"); // taille affichée sur la carte
  });

  it("?dl=1 (bouton) → fichier BRUT en pièce jointe, même avec Accept text/html", async () => {
    const res = await request(app).get(`/api/media/download/${token}?dl=1`).set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toBe("video/mp4");
    expect(String(res.headers["content-disposition"])).toContain("attachment");
  });

  it("Range (lecteurs) → 206 partiel, jamais la page", async () => {
    const res = await request(app).get(`/api/media/download/${token}`).set("Range", "bytes=0-3").set("Accept", "text/html");
    expect(res.status).toBe(206);
    expect(String(res.headers["content-type"])).toBe("video/mp4");
  });

  it("iframe (Sec-Fetch-Dest: iframe, page épisodes ffff) → fichier brut", async () => {
    const res = await request(app).get(`/api/media/download/${token}`)
      .set("Accept", "text/html")
      .set("Sec-Fetch-Dest", "iframe");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toBe("video/mp4");
  });

  it("?inline=true (page hébergée ffff) → inline, pas la page OG", async () => {
    const res = await request(app).get(`/api/media/download/${token}?inline=true`).set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain("inline");
    expect(String(res.headers["content-type"])).toBe("video/mp4");
  });

  it("client non-HTML (curl/axios/Baileys) → fichier brut", async () => {
    const res = await request(app).get(`/api/media/download/${token}`).set("Accept", "*/*");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toBe("video/mp4");
  });

  it("HEAD → métadonnées du fichier, pas de page", async () => {
    const res = await request(app).head(`/api/media/download/${token}`).set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toBe("video/mp4");
  });
});
