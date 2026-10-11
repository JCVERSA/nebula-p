/**
 * 9.5 — .up/.upload : lien temporaire (2 h) pour un média envoyé ou cité.
 * tempDownloadManager mocké (aucune écriture réelle) — les pures
 * (findMediaNode, mediaMeta, quota) testées à plat.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../src/bot/tempDownloadManager.js", () => ({
  registerTempDownload: vi.fn(() => ({
    token: "tok123", downloadUrl: "https://dash.example/d/tok123",
    expiresAt: 0, ttlMinutes: 120, sizeMB: 1, sizeBytes: 1,
    filename: "", filePath: "",
  })),
  getTempDownloadDir: () => tmpdir(),
}));

import uploadCommand, {
  findMediaNode,
  mediaMeta,
  getMaxUploadBytes,
  checkUploadQuota,
  recordUpload,
  __resetUploadQuotaForTests,
} from "../src/bot/commands/upload.js";
import { registerTempDownload } from "../src/bot/tempDownloadManager.js";

const mRegister = vi.mocked(registerTempDownload);

const SENDER = "237999000111@s.whatsapp.net";
let dir: string;

function mkContext(over: Record<string, unknown> = {}) {
  const replies: string[] = [];
  return {
    sender: SENDER,
    isOwner: false,
    prefix: ".",
    args: [],
    fullMessage: "",
    reply: async (t: string) => { replies.push(t); return {}; },
    react: async () => ({}),
    downloadMedia: async () => Buffer.from("fichier"),
    ...over,
    _replies: replies,
  } as any;
}

function mkMsg(message: any) {
  return { key: { remoteJid: "x@s.whatsapp.net" }, message };
}

const DOC_MSG = mkMsg({
  documentMessage: { fileName: "rapport 2026.pdf", mimetype: "application/pdf" },
});
const REPLY_MSG = mkMsg({
  extendedTextMessage: { text: ".up", contextInfo: { quotedMessage: { videoMessage: { mimetype: "video/mp4" } } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetUploadQuotaForTests();
  mRegister.mockImplementation((() => ({
    token: "tok123", downloadUrl: "https://dash.example/d/tok123",
    expiresAt: 0, ttlMinutes: 120, sizeMB: 1, sizeBytes: 1,
    filename: "", filePath: "",
  })) as any);
  dir = mkdtempSync(join(tmpdir(), "upcmd-"));
  delete process.env.NEBULA_UPLOAD_MAX_MB;
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("findMediaNode (pur)", () => {
  it("détecte le média direct, le média cité (reply), et rejette le reste", () => {
    expect(findMediaNode(DOC_MSG.message)?.kind).toBe("documentMessage");
    expect(findMediaNode(REPLY_MSG.message)?.kind).toBe("videoMessage"); // reply
    expect(findMediaNode({ conversation: "salut" })).toBeNull();
    expect(findMediaNode(null)).toBeNull();
  });

  it("déballe les couches (viewOnce, éphémère)", () => {
    const wrapped = { viewOnceMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } };
    expect(findMediaNode(wrapped)?.kind).toBe("imageMessage");
  });
});

describe("mediaMeta (pur)", () => {
  it("nom de fichier document assaini, extensions par type", () => {
    expect(mediaMeta({ fileName: "a/b:c*d?.pdf" }, "documentMessage").filename).toBe("a_b_c_d_.pdf");
    expect(mediaMeta({}, "imageMessage").filename).toMatch(/^image-\d+\.jpg$/);
    expect(mediaMeta({}, "videoMessage").filename).toMatch(/\.mp4$/);
    expect(mediaMeta({ mimetype: "audio/ogg" }, "audioMessage").filename).toMatch(/\.ogg$/);
    expect(mediaMeta({ fileName: "" }, "documentMessage").filename).toMatch(/^fichier-\d+$/);
  });
});

describe(".up — exécution", () => {
  it("sans média → usage clair (pas d'upload)", async () => {
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, mkMsg({ conversation: ".up" }), ctx);
    expect(ctx._replies[0]).toContain("Aucun fichier détecté");
    expect(mRegister).not.toHaveBeenCalled();
  });

  it("document joint → lien 2 h avec nom, taille et TTL", async () => {
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(mRegister).toHaveBeenCalledTimes(1);
    const [pathArg, nameArg, optsArg] = mRegister.mock.calls[0];
    expect(nameArg).toBe("rapport 2026.pdf");
    expect(optsArg!.ttlMinutes).toBe(120);
    expect(optsArg!.mimeType).toBe("application/pdf");
    expect(pathArg).toContain("up-");
    expect(ctx._replies[0]).toContain("https://dash.example/d/tok123");
    expect(ctx._replies[0]).toContain("Valide 2 h");
    expect(ctx._replies[0]).toContain("rapport 2026.pdf");
  });

  it("reply sur une vidéo → le média cité est utilisé", async () => {
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, REPLY_MSG, ctx);
    expect(mRegister.mock.calls[0][1]).toMatch(/^video-\d+\.mp4$/);
  });

  it("fichier trop lourd → refus selon NEBULA_UPLOAD_MAX_MB (aucun enregistrement)", async () => {
    process.env.NEBULA_UPLOAD_MAX_MB = "1";
    const ctx = mkContext({ downloadMedia: async () => Buffer.alloc(2 * 1024 * 1024) });
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(ctx._replies[0]).toContain("trop lourd");
    expect(mRegister).not.toHaveBeenCalled();
    expect(getMaxUploadBytes()).toBe(1024 * 1024); // 1 Mo
  });

  it("quota 50/heure : le 51e est refusé", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_200_000);
    for (let i = 0; i < 50; i++) {
      recordUpload(SENDER, 1_000_000 + i * 1000);
    }
    expect(checkUploadQuota(SENDER, 1_200_000)).toBe(false);
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(ctx._replies[0]).toContain("Limite d'uploads atteinte");
    expect(mRegister).not.toHaveBeenCalled();
    // Une autre fenêtre horaire remet les compteurs à zéro
    expect(checkUploadQuota(SENDER, 1_000_000 + 3_700_000)).toBe(true);
  });
});

describe("wiring 9.5", () => {
  it("alias du owner enregistrés, commande légère pour l'agent", async () => {
    const fs = await import("fs");
    const reg = fs.readFileSync(join(__dirname, "../src/bot/commandRegistry.ts"), "utf-8");
    expect(reg).toContain("uploadCommand");
    const brain = fs.readFileSync(join(__dirname, "../src/bot/services/agentBrain.ts"), "utf-8");
    const heavy = brain.match(/HEAVY_NAMES[^;]*;/)?.[0] ?? "";
    expect(heavy).not.toContain('"upload"');
  });
});
