/**
 * 9.5/9.5b — .up/.upload : lien temporaire (2 h) pour un média envoyé ou cité.
 * Baileys + tempDownloadManager mockés (aucun réseau, aucune écriture réelle
 * dans le dépôt temp) — les pures (findMediaNode, mediaMeta, quota,
 * streamMediaToFile) testées à plat.
 *
 * 9.5b : le média est téléchargé EN STREAMING vers le disque (le downloader
 * du contexte tamponnait tout en RAM — heap 192 Mo contre 500 Mo de limite).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// 9.5b : Baileys 7.x exporte downloadContentFromMessage (ce n'est PAS une
// méthode du sock) — le mock fournit un flux asynchrone de chunks.
// 9.6c : normalizeMessageContent (déroulage officiel des enveloppes) est
// simulé fidèlement — les 9 sortes, par propriété (pas par première clé).
vi.mock("@whiskeysockets/baileys", () => ({
  downloadContentFromMessage: vi.fn(),
  normalizeMessageContent: (c: any) => {
    let cur = c;
    for (let i = 0; i < 5 && cur; i++) {
      const w = cur.ephemeralMessage || cur.viewOnceMessage || cur.documentWithCaptionMessage
        || cur.viewOnceMessageV2 || cur.viewOnceMessageV2Extension || cur.editedMessage
        || cur.associatedChildMessage || cur.groupStatusMessage || cur.groupStatusMessageV2;
      if (!w) break;
      cur = w.message;
    }
    return cur;
  },
}));

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
  streamMediaToFile,
  __resetUploadQuotaForTests,
} from "../src/bot/commands/upload.js";
import { registerTempDownload } from "../src/bot/tempDownloadManager.js";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { __resetRecentMessagesForTests, getRecentMessage, recordRecentMessage } from "../src/bot/services/recentMessages.js";

const mRegister = vi.mocked(registerTempDownload);
const mDownload = vi.mocked(downloadContentFromMessage);

/** Flux asynchrone de chunks, comme le vrai downloadContentFromMessage. */
async function* fakeStream(chunks: Buffer[]) {
  for (const c of chunks) yield c;
}

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
  __resetRecentMessagesForTests();
  mRegister.mockImplementation((() => ({
    token: "tok123", downloadUrl: "https://dash.example/d/tok123",
    expiresAt: 0, ttlMinutes: 120, sizeMB: 1, sizeBytes: 1,
    filename: "", filePath: "",
  })) as any);
  mDownload.mockImplementation((async () => fakeStream([Buffer.from("fichier")])) as any);
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

  it("9.6b — reply ENVELOPPÉ (ephemeral/viewOnce) : le média cité reste trouvé", () => {
    // bug prod 2026-10-11 : « Aucun fichier détecté » sur un reply valide,
    // car le média cité était cherché sur le message brut (enveloppé).
    const ephemeralReply = { ephemeralMessage: { message: REPLY_MSG.message } };
    expect(findMediaNode(ephemeralReply)?.kind).toBe("videoMessage");
    const viewOnceReply = { viewOnceMessage: { message: REPLY_MSG.message } };
    expect(findMediaNode(viewOnceReply)?.kind).toBe("videoMessage");
  });

  it("9.8 — citation ÉPURÉE (quotedMessage absent) : média retrouvé via le registre stanzaId", async () => {
    // constat prod 9.6c : reply dont contextInfo n'a PAS de quotedMessage
    // (chat éphémère) — clés : extendedTextMessage + messageContextInfo.
    // L'original (vidéo du bot) est dans le registre des messages récents.
    const CHAT = "237999000111@s.whatsapp.net";
    recordRecentMessage(CHAT, "ORIG1", DOC_MSG.message);
    const strippedReply = mkMsg({ extendedTextMessage: { text: ".up", contextInfo: { stanzaId: "ORIG1" } } });
    strippedReply.key.remoteJid = CHAT;
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, strippedReply, ctx);
    expect(mRegister).toHaveBeenCalledTimes(1); // le média a bien été trouvé
    expect(mRegister.mock.calls[0][1]).toBe("rapport 2026.pdf");
    // même résolution pour l'agent : le hint passe aussi par le registre
    expect(getRecentMessage(CHAT, "ORIG1")).toBeTruthy();
  });

  it("9.6c — enveloppes RARES (editedMessage, viewOnceMessageV2Extension) : trouvées aussi", () => {
    // constat prod : l'agent voyait la vidéo (indice 9.6b) mais la commande
    // non — le déroulage maison ne connaissait pas ces enveloppes officielles.
    expect(findMediaNode({ editedMessage: { message: REPLY_MSG.message } })?.kind).toBe("videoMessage");
    expect(findMediaNode({ viewOnceMessageV2Extension: { message: { imageMessage: { mimetype: "image/jpeg" } } } })?.kind).toBe("imageMessage");
    expect(findMediaNode({ associatedChildMessage: { message: REPLY_MSG.message } })?.kind).toBe("videoMessage");
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
  it("sans média → usage clair + journal des clés (diagnostic 9.6c, pas d'upload)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const ctx = mkContext();
      await uploadCommand.execute!({} as any, mkMsg({ conversation: ".up" }), ctx);
      expect(ctx._replies[0]).toContain("Aucun fichier détecté");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[UP] aucun média"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("conversation"));
      expect(mRegister).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("document joint → lien 2 h avec nom, taille et TTL (streaming disque)", async () => {
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(mDownload).toHaveBeenCalledTimes(1);
    // le nœud média ET le type Baileys ("document", pas "documentMessage")
    const [nodeArg, typeArg] = mDownload.mock.calls[0] as any[];
    expect(nodeArg.fileName).toBe("rapport 2026.pdf");
    expect(typeArg).toBe("document");
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

  it("flux vide → aucun lien, message honnête", async () => {
    mDownload.mockImplementation((async () => fakeStream([])) as any);
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(ctx._replies[0]).toContain("Impossible de récupérer le média");
    expect(mRegister).not.toHaveBeenCalled();
  });

  it("échec du téléchargement → erreur honnête (le catch global parle)", async () => {
    mDownload.mockImplementation(async () => {
      throw new Error("sock.downloadContentFromMessage is not a function");
    });
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, DOC_MSG, ctx);
    expect(ctx._replies[0]).toContain("Erreur pendant le traitement");
    expect(mRegister).not.toHaveBeenCalled();
  });

  it("reply sur une vidéo → le média cité est utilisé", async () => {
    const ctx = mkContext();
    await uploadCommand.execute!({} as any, REPLY_MSG, ctx);
    expect(mRegister.mock.calls[0][1]).toMatch(/^video-\d+\.mp4$/);
  });

  it("fichier trop lourd → refus en cours de streaming, fichier parti supprimé", async () => {
    process.env.NEBULA_UPLOAD_MAX_MB = "1";
    mDownload.mockImplementation((async () =>
      fakeStream([Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024)])) as any);
    const ctx = mkContext();
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

describe("streamMediaToFile (pur, 9.5b)", () => {
  it("écrit les chunks sur disque et rend le total d'octets", async () => {
    const dest = join(dir, "s.bin");
    const res = await streamMediaToFile({}, "documentMessage", dest, 1000, async () =>
      fakeStream([Buffer.from("abc"), Buffer.from("def")]));
    expect(res).toEqual({ ok: true, bytes: 6 });
    expect((await import("fs")).readFileSync(dest, "utf-8")).toBe("abcdef");
  });

  it("coupe net au-delà de maxBytes et supprime le fichier partiel", async () => {
    const dest = join(dir, "big.bin");
    const res = await streamMediaToFile({}, "videoMessage", dest, 3, async () =>
      fakeStream([Buffer.from("abc"), Buffer.from("def")]));
    expect(res).toEqual({ ok: false, reason: "tooBig", bytes: 6 });
    expect(readdirSync(dir).length).toBe(0); // rien de laissé sur le disque
  });

  it("flux vide → empty, aucun fichier", async () => {
    const dest = join(dir, "e.bin");
    const res = await streamMediaToFile({}, "imageMessage", dest, 100, async () => fakeStream([]));
    expect(res).toEqual({ ok: false, reason: "empty", bytes: 0 });
    expect(readdirSync(dir).length).toBe(0);
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

  it("9.5b — le downloader partagé utilise l'export Baileys, pas sock.*", async () => {
    const fs = await import("fs");
    const dispatch = fs.readFileSync(join(__dirname, "../src/bot/commandDispatch.ts"), "utf-8");
    expect(dispatch).toContain('import { downloadContentFromMessage } from "@whiskeysockets/baileys"');
    expect(dispatch).not.toContain("sock as any).downloadContentFromMessage");
    // .trace dépend de ce downloader : le correctif le répare aussi.
    const trace = fs.readFileSync(join(__dirname, "../src/bot/commands/trace.ts"), "utf-8");
    expect(trace).toContain("context.downloadMedia");
  });
});
