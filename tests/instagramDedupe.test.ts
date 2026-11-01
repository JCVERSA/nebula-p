import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import instagramCommand, { mediaFileFingerprint, shouldRescueWithExtractor } from "../src/bot/commands/instagram.js";
import { extractInstagramMedia } from "../src/bot/services/instagramExtractor.js";
import { fetchMediaToTempFile, registerMediaLink } from "../src/bot/services/mediaLinkDelivery.js";

/**
 * 9.19d — dédoublonnage par CONTENU du carrousel Instagram.
 *
 * Terrain 01/11 01:52 : un post de 7 photos → 7 fois la MÊME image. Le
 * scraper tiers (igdl2) renvoie N URLs « uniques » qui pointent toutes sur
 * la photo de couverture (7 fichiers enregistrés à 0,42 Mo PILE). Ici :
 * igdl mort (DNS, comme en prod), igdl2 renvoie 3 URLs dont 2 au contenu
 * identique → 2 images envoyées (pas 3), 1 doublon annoncé, puis sauvetage
 * par l'extracteur maison quand il connaît le carrousel.
 */

vi.mock("ruhend-scraper", () => ({
  igdl: vi.fn(async () => {
    throw new Error("getaddrinfo ENOTFOUND api.videodropper.app");
  }),
  igdl2: vi.fn(async () => ({
    data: [
      { url: "https://cdn.example/cover-a1.jpg", type: "image" },
      { url: "https://cdn.example/cover-a2.jpg", type: "image" }, // même CONTENU que a1
      { url: "https://cdn.example/photo-b1.jpg", type: "image" }
    ]
  }))
}));
vi.mock("../src/bot/services/instagramExtractor.js", () => ({
  instagramShortcode: () => "De3X6jVkvFE",
  extractInstagramMedia: vi.fn()
}));
vi.mock("../src/bot/services/mediaReuseStore.js", () => ({
  igReuseKey: () => "", // cache désactivé : le test ne dépend jamais d'un run précédent
  lookupMediaReuse: () => null,
  storeMediaReuse: () => {},
  SOCIAL_REUSE_TTL_MS: 1
}));
vi.mock("../src/bot/services/downloadPage.js", () => ({
  buildDownloadPage: vi.fn((opts: any) => `<html>page ${opts.entries.length} médias</html>`),
  registerDownloadPage: vi.fn(() => "https://d.example/d/page-abc123.html?inline=true")
}));
vi.mock("../src/bot/services/mediaLinkDelivery.js", () => ({
  fetchMediaToTempFile: vi.fn(),
  registerMediaLink: vi.fn()
}));
vi.mock("../src/bot/liveSocket.js", () => ({ resolveLiveSocket: (s: unknown) => s }));

const mExtract = vi.mocked(extractInstagramMedia);
const mFetch = vi.mocked(fetchMediaToTempFile);
const mRegister = vi.mocked(registerMediaLink);
const { buildDownloadPage, registerDownloadPage } = await import("../src/bot/services/downloadPage.js");
const mBuildPage = vi.mocked(buildDownloadPage);
const mRegisterPage = vi.mocked(registerDownloadPage);

const JID = "1555999111222@s.whatsapp.net";
let tmpDir = "";
let sent: any[] = [];
let replies: string[] = [];

function fileFor(url: string): string {
  const name = url.includes("a1") ? "a1.jpg" : url.includes("a2") ? "a2.jpg" : url.includes("b1") ? "b1.jpg" : "c1.jpg";
  return path.join(tmpDir, name);
}

async function run(msgId: string) {
  sent = [];
  replies = [];
  const sock = {
    sendMessage: vi.fn(async (_to: string, payload: any) => {
      sent.push(payload);
      return { key: { id: `m${sent.length}` } };
    })
  };
  const msg = { key: { remoteJid: JID, id: msgId, fromMe: false } };
  const context = {
    args: ["https://www.instagram.com/p/De3X6jVkvFE/"],
    reply: vi.fn(async (t: string) => {
      replies.push(t);
      return {};
    })
  };
  await instagramCommand.execute(sock as any, msg as any, context as any);
  return { sent, replies };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ig-dedupe-"));
  fs.writeFileSync(path.join(tmpDir, "a1.jpg"), "IMAGE-A");
  fs.writeFileSync(path.join(tmpDir, "a2.jpg"), "IMAGE-A"); // doublon de contenu
  fs.writeFileSync(path.join(tmpDir, "b1.jpg"), "IMAGE-B");
  fs.writeFileSync(path.join(tmpDir, "c1.jpg"), "IMAGE-C");
  mFetch.mockReset();
  mFetch.mockImplementation(async (url: string) => fileFor(url));
  mRegister.mockReset();
  mRegister.mockImplementation(((localPath: string, filename: string) => ({
    filePath: localPath,
    downloadUrl: `https://d.example/${filename}`,
    sizeMB: 0.42
  })) as any);
  mExtract.mockReset();
  mExtract.mockResolvedValue({ items: [], strategy: "embed" } as any);
  mBuildPage.mockClear();
  mRegisterPage.mockReset();
  mRegisterPage.mockReturnValue("https://d.example/d/page-abc123.html?inline=true");
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("9.19d — empreinte de contenu (pure)", () => {
  it("même contenu → même empreinte ; contenu différent → empreinte différente ; illisible → null", () => {
    const a1 = fileFor("https://cdn.example/cover-a1.jpg");
    const a2 = fileFor("https://cdn.example/cover-a2.jpg");
    const b1 = fileFor("https://cdn.example/photo-b1.jpg");
    expect(mediaFileFingerprint(a1)).toBe(mediaFileFingerprint(a2)); // le bug terrain, détecté
    expect(mediaFileFingerprint(a1)).not.toBe(mediaFileFingerprint(b1));
    expect(mediaFileFingerprint(path.join(tmpDir, "inexistant.jpg"))).toBeNull();
    expect(mediaFileFingerprint("https://distant.example/x.jpg")).toBeNull(); // URL jamais téléchargée
  });

  it("sauvetage : seulement si des doublons ont été écartés ET que le média vient d'un scraper tiers", () => {
    expect(shouldRescueWithExtractor({ duplicatesDropped: 1, mediaSource: "igdl2" })).toBe(true);
    expect(shouldRescueWithExtractor({ duplicatesDropped: 3, mediaSource: "igdl" })).toBe(true);
    expect(shouldRescueWithExtractor({ duplicatesDropped: 0, mediaSource: "igdl2" })).toBe(false);
    expect(shouldRescueWithExtractor({ duplicatesDropped: 2, mediaSource: "extractor:api" })).toBe(false);
  });
});

describe("9.19d — carrousel : la même image n'est plus envoyée N fois", () => {
  it("3 URLs dont 2 au contenu identique → 2 images envoyées, 1 doublon annoncé", async () => {
    const { sent, replies } = await run("ig-terrain-0152");
    const images = sent.filter((p) => p.image);
    expect(images.length).toBe(2); // pas 3 : le doublon de contenu est écarté
    expect(mFetch).toHaveBeenCalledTimes(3); // les 3 URLs ont bien été téléchargées puis comparées
    const pageMsg = replies.find((t) => t.includes("Page de téléchargement prête"));
    expect(pageMsg).toBeTruthy();
    expect(pageMsg).toContain("2 média(s)");
    expect(pageMsg).toContain("https://d.example/d/page-abc123.html?inline=true");
    expect(pageMsg).toContain("1 doublon(s) ignoré(s)");
    expect(replies.some((t) => t.includes("Liens de téléchargement"))).toBe(false); // plus de liste à rallonge
    const entries = mBuildPage.mock.calls[mBuildPage.mock.calls.length - 1][0].entries;
    expect(entries.map((e: any) => e.label)).toEqual(["Image 1", "Image 2"]); // le doublon n'a pas de bouton
  });

  it("sauvetage : l'extracteur maison récupère l'image manquante du carrousel", async () => {
    mExtract.mockResolvedValue({ items: [{ url: "https://cdn.example/photo-c1.jpg", type: "image" }], strategy: "api" } as any);
    const { sent, replies } = await run("ig-secours-0152");
    const images = sent.filter((p) => p.image);
    expect(images.length).toBe(3); // A (couverture) + B + C (secours extracteur)
    expect(mFetch).toHaveBeenCalledTimes(4); // 3 scraper + 1 extracteur
    const pageMsg = replies.find((t) => t.includes("Page de téléchargement prête"));
    expect(pageMsg).toContain("3 média(s)");
    expect(pageMsg).toContain("1 média(s) récupéré(s) via l'extracteur maison");
    const entries = mBuildPage.mock.calls[mBuildPage.mock.calls.length - 1][0].entries;
    expect(entries.map((e: any) => e.label)).toEqual(["Image 1", "Image 2", "Image 3"]); // secours inclus
  });

  it("repli honnête : page impossible (APP_URL absent) → la liste historique avec libellés", async () => {
    mRegisterPage.mockReturnValue(null);
    const { replies } = await run("ig-repli-page");
    const linksMsg = replies.find((t) => t.includes("Liens de téléchargement"));
    expect(linksMsg).toBeTruthy();
    expect(linksMsg).toContain("(2)");
    expect(linksMsg).toContain("Image 1 — https://d.example/post_De3X6jVkvFE_1.jpg");
    expect(linksMsg).toContain("1 doublon(s) ignoré(s)");
  });
});
