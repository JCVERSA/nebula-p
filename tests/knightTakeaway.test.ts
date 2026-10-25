/**
 * 9.18llll — « que retenir du concurrent KnightBot-Mini » : sticker (.s),
 * take, viewonce (.vv), dl générique yt-dlp.
 *
 * Aucun réseau, aucun ffmpeg réel : runFfmpegKit mocké écrit un vrai webp
 * minimal (le module node-webpmux, lui, est RÉEL — la recette EXIF est la
 * partie fragile, elle doit être validée pour de vrai), Baileys mocké comme
 * dans uploadCommand.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// WebP minimal 1×1 (lossy) — charge/round-trip vérifiés avec node-webpmux.
const MINIMAL_WEBP = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4uAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=",
  "base64",
);

vi.mock("@whiskeysockets/baileys", () => ({
  downloadContentFromMessage: vi.fn(),
  normalizeMessageContent: (c: any) => {
    let cur = c;
    for (let i = 0; i < 5 && cur; i++) {
      const w =
        cur.ephemeralMessage || cur.viewOnceMessage || cur.documentWithCaptionMessage ||
        cur.viewOnceMessageV2 || cur.viewOnceMessageV2Extension || cur.editedMessage ||
        cur.associatedChildMessage || cur.groupStatusMessage || cur.groupStatusMessageV2;
      if (!w) break;
      cur = w.message;
    }
    return cur;
  },
}));

vi.mock("../src/bot/tempDownloadManager.js", () => ({
  registerTempDownload: vi.fn(() => ({
    token: "tok-dl",
    downloadUrl: "https://dash.example/d/tok-dl",
    expiresAt: 0,
    ttlMinutes: 30,
    sizeMB: 1,
    sizeBytes: 1,
    filename: "video.mp4",
    filePath: "/tmp/video.mp4",
  })),
  getTempDownloadDir: () => tmpdir(),
  getLinkTtlMinutes: () => 30,
}));

vi.mock("../src/bot/services/mediaToolkit.js", () => ({
  WHATSAPP_DOC_SAFE_MB: 90,
  runFfmpegKit: vi.fn(async (args: string[]) => {
    const output = args[args.length - 1];
    // Mode « gros fichier » : webp + 1 Mo de bourrage (passe 1 animée).
    if (ffmpegMode === "oversizedFirst") {
      ffmpegMode = "normal";
      writeFileSync(output, Buffer.concat([MINIMAL_WEBP, Buffer.alloc(1024 * 1024 + 10, 0)]));
      return { ok: true, code: 0, signal: null, stderr: "" };
    }
    if (ffmpegMode === "fail") return { ok: false, code: 1, signal: null, stderr: "boom" };
    writeFileSync(output, MINIMAL_WEBP);
    return { ok: true, code: 0, signal: null, stderr: "" };
  }),
}));
let ffmpegMode = "normal";

vi.mock("../src/bot/services/ytDlp.js", () => ({
  runYtDlp: vi.fn(async () => ({
    ok: true,
    stdout: JSON.stringify({
      title: "Vidéo Facebook de test",
      ext: "mp4",
      url: "https://video.example/direct.mp4",
      filesize: 5_000_000,
      extractor_key: "Facebook",
      vcodec: "avc1",
      acodec: "mp4a",
    }),
    stderr: "",
  })),
}));

vi.mock("../src/bot/services/mediaLinkDelivery.js", () => ({
  fetchMediaToTempFile: vi.fn(async (_url: string, onProgress?: (r: number, t: number) => void) => {
    const p = join(tmpdir(), `dltest_${Date.now()}.mp4`);
    writeFileSync(p, Buffer.alloc(5_000_000, 1));
    if (onProgress) onProgress(2_500_000, 5_000_000);
    return p;
  }),
}));

vi.mock("../src/bot/urlSafety.js", () => ({
  isSafeDownloadUrl: vi.fn(async () => true),
}));

import { runFfmpegKit } from "../src/bot/services/mediaToolkit.js";
import { runYtDlp } from "../src/bot/services/ytDlp.js";
import { fetchMediaToTempFile } from "../src/bot/services/mediaLinkDelivery.js";
import { registerTempDownload } from "../src/bot/tempDownloadManager.js";
import { isSafeDownloadUrl } from "../src/bot/urlSafety.js";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

import {
  buildStickerFilter,
  buildStickerFfmpegArgs,
  buildStickerExifBuffer,
  withStickerExif,
  convertMediaToSticker,
} from "../src/bot/services/stickerService.js";
import stickerCommand from "../src/bot/commands/sticker.js";
import takeCommand from "../src/bot/commands/take.js";
import viewonceCommand from "../src/bot/commands/viewonce.js";
import dlCommand, { parseDlJson } from "../src/bot/commands/dl.js";

const mFfmpeg = vi.mocked(runFfmpegKit);
const mYtDlp = vi.mocked(runYtDlp);
const mFetch = vi.mocked(fetchMediaToTempFile);
const mRegister = vi.mocked(registerTempDownload);
const mSafe = vi.mocked(isSafeDownloadUrl);
const mDownload = vi.mocked(downloadContentFromMessage);

/** Flux asynchrone de chunks, comme le vrai downloadContentFromMessage. */
async function* fakeStream(chunks: Buffer[]) {
  for (const c of chunks) yield c;
}

function makeContext(args: string[] = []) {
  return {
    sender: "9xx@s.whatsapp.net",
    senderName: "Tester",
    isOwner: true,
    isAdmin: true,
    prefix: ".",
    commandName: "test",
    args,
    fullMessage: args.join(" "),
    reply: vi.fn(async (t: string) => ({ key: { id: "anchor-1", remoteJid: "chat" } })),
    react: vi.fn(async () => true),
  } as any;
}

function makeSock() {
  return { sendMessage: vi.fn(async () => ({ key: { id: "out" } })) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  ffmpegMode = "normal";
  mDownload.mockImplementation(async () => fakeStream([Buffer.from("imagedata-123")]) as any);
});

// ── stickerService — pures + webpmux RÉEL ─────────────────────────────────

describe("stickerService — filtres et args ffmpeg", () => {
  it("filtre statique : scale + rgba + pad 512 transparent", () => {
    expect(buildStickerFilter(false, 15)).toBe(
      "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000",
    );
  });
  it("filtre animé : fps présent, pas de format rgba", () => {
    const f = buildStickerFilter(true, 12);
    expect(f).toContain("fps=12");
    expect(f).not.toContain("format=rgba");
  });
  it("args SANS shell : array, -y, libwebp, yuva420p, loop 0", () => {
    const a = buildStickerFfmpegArgs("/tmp/in.jpg", "/tmp/out.webp", { animated: false });
    expect(Array.isArray(a)).toBe(true);
    expect(a).toContain("-y");
    expect(a).toContain("libwebp");
    expect(a).toContain("yuva420p");
    expect(a.join(" ")).not.toContain(" && "); // jamais de chaîne shell
    expect(a[a.length - 1]).toBe("/tmp/out.webp");
  });
  it("passes dégradées : durée coupée et bitrate plafonné", () => {
    const a = buildStickerFfmpegArgs("i", "o", { animated: true, fps: 8, quality: 30, timeLimitSec: 2, bitrateKbps: 100 });
    const i = a.indexOf("-t");
    expect(a[i + 1]).toBe("2");
    expect(a).toContain("100k");
    expect(a.join(" ")).toContain("fps=8");
  });
});

describe("stickerService — EXIF WhatsApp (recette communautaire)", () => {
  it("le buffer EXIF porte le TIFF little-endian, le tag et le pack en JSON", () => {
    const b = buildStickerExifBuffer("Nebula", "Nebula Bot");
    expect(b[0]).toBe(0x49);
    expect(b[1]).toBe(0x49);
    expect(b[2]).toBe(0x2a);
    const json = JSON.parse(b.subarray(22).toString("utf8"));
    expect(json["sticker-pack-name"]).toBe("Nebula");
    expect(json["sticker-author-name"]).toBe("Nebula Bot");
    // Longueur du JSON écrite à l'offset 14 (little-endian 4 octets).
    expect(b.readUIntLE(14, 4)).toBe(b.length - 22);
  });

  it("withStickerExif : round-trip RÉEL node-webpmux — chunk EXIF + relisible", async () => {
    const out = await withStickerExif(MINIMAL_WEBP, "Nebula", "Nebula Bot");
    expect(out.includes(Buffer.from("EXIF"))).toBe(true);
    expect(out.includes(Buffer.from("Nebula"))).toBe(true);
    const { Image } = await import("node-webpmux");
    const re = new Image();
    await re.load(out);
    expect(re.exif).toBeTruthy();
    expect(re.exif!.includes(Buffer.from("sticker-pack-name"))).toBe(true);
  });
});

describe("stickerService — convertMediaToSticker (ffmpeg mocké)", () => {
  it("passe 1 réussie → sticker prêt, non dégradé", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stk-"));
    const input = join(dir, "in.mp4");
    writeFileSync(input, Buffer.from("video"));
    const res = await convertMediaToSticker(input, true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.degraded).toBe(false);
      expect(res.buffer.includes(Buffer.from("EXIF"))).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("animé trop lourd → passes dégradées tentées (fps 12 puis 8)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stk-"));
    const input = join(dir, "in.mp4");
    writeFileSync(input, Buffer.from("video"));
    ffmpegMode = "oversizedFirst";
    const res = await convertMediaToSticker(input, true);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.degraded).toBe(true);
    // Passe 1 (15 fps) + passe 2 (12 fps) ont tourné ; la 2 a produit un webp léger.
    expect(mFfmpeg.mock.calls.length).toBeGreaterThanOrEqual(2);
    const pass2Args = mFfmpeg.mock.calls[1][0].join(" ");
    expect(pass2Args).toContain("fps=12");
    rmSync(dir, { recursive: true, force: true });
  });

  it("ffmpeg en échec → raison honnête, jamais d'exception", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stk-"));
    const input = join(dir, "in.jpg");
    writeFileSync(input, Buffer.from("img"));
    ffmpegMode = "fail";
    const res = await convertMediaToSticker(input, false);
    expect(res).toEqual({ ok: false, reason: "ffmpeg" });
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── Commandes — flux complets mockés ──────────────────────────────────────

describe(".sticker — image citée → sticker avec pack Nebula", () => {
  it("répond à une image : télécharge, convertit, envoie { sticker }", async () => {
    const sock = makeSock();
    const msg = {
      key: { remoteJid: "chat", id: "m1" },
      message: {
        extendedTextMessage: {
          text: ".s",
          contextInfo: { stanzaId: "q1", participant: "9xx", quotedMessage: { imageMessage: { mimetype: "image/jpeg" } } },
        },
      },
    };
    await stickerCommand.execute(sock, msg, makeContext());
    expect(mDownload).toHaveBeenCalled();
    expect(mFfmpeg).toHaveBeenCalled();
    expect(sock.sendMessage).toHaveBeenCalled();
    const [jid, payload] = sock.sendMessage.mock.calls[0];
    expect(jid).toBe("chat");
    expect(Buffer.isBuffer(payload.sticker)).toBe(true);
    expect((payload.sticker as Buffer).includes(Buffer.from("Nebula"))).toBe(true);
  });

  it("pas de média → aide claire", async () => {
    const sock = makeSock();
    const ctx = makeContext();
    const msg = { key: { remoteJid: "chat", id: "m2" }, message: { conversation: ".s" } };
    await stickerCommand.execute(sock, msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Sticker");
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });

  it("sticker cité → redirection vers .take", async () => {
    const ctx = makeContext();
    const msg = {
      key: { remoteJid: "chat", id: "m3" },
      message: {
        extendedTextMessage: {
          text: ".s",
          contextInfo: { stanzaId: "q2", participant: "9xx", quotedMessage: { stickerMessage: { mimetype: "image/webp" } } },
        },
      },
    };
    await stickerCommand.execute(makeSock(), msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain(".take");
  });
});

describe(".take — resticker avec le pack Nebula", () => {
  it("reply à un sticker → renvoie le média avec NOTRE EXIF", async () => {
    mDownload.mockImplementation(async () => fakeStream([MINIMAL_WEBP]) as any);
    const sock = makeSock();
    const msg = {
      key: { remoteJid: "chat", id: "m4" },
      message: {
        extendedTextMessage: {
          text: ".take",
          contextInfo: { stanzaId: "q3", participant: "9xx", quotedMessage: { stickerMessage: { mimetype: "image/webp" } } },
        },
      },
    };
    await takeCommand.execute(sock, msg, makeContext());
    expect(sock.sendMessage).toHaveBeenCalled();
    const payload = sock.sendMessage.mock.calls[0][1];
    expect(Buffer.isBuffer(payload.sticker)).toBe(true);
    expect((payload.sticker as Buffer).includes(Buffer.from("sticker-pack-name"))).toBe(true);
  });

  it("pas un sticker → aide", async () => {
    const ctx = makeContext();
    const msg = { key: { remoteJid: "chat", id: "m5" }, message: { conversation: ".take" } };
    await takeCommand.execute(makeSock(), msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("sticker");
  });
});

describe(".vv — révélation view-once", () => {
  it("reply à un viewOnce image → renvoie l'image normalement", async () => {
    const sock = makeSock();
    const msg = {
      key: { remoteJid: "chat", id: "m6" },
      message: {
        extendedTextMessage: {
          text: ".vv",
          contextInfo: {
            stanzaId: "q4",
            participant: "9xx",
            quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } },
          },
        },
      },
    };
    await viewonceCommand.execute(sock, msg, makeContext());
    expect(mDownload).toHaveBeenCalled();
    const [jid, payload] = sock.sendMessage.mock.calls[0];
    expect(jid).toBe("chat");
    expect(payload.image).toBeTruthy();
    expect(payload.image.url).toContain("nebula_vv_");
  });

  it("audio view-once → renvoyé comme audio", async () => {
    const sock = makeSock();
    const msg = {
      key: { remoteJid: "chat", id: "m7" },
      message: {
        extendedTextMessage: {
          text: ".vv",
          contextInfo: {
            stanzaId: "q5",
            participant: "9xx",
            quotedMessage: { viewOnceMessageV2: { message: { audioMessage: { mimetype: "audio/ogg" } } } },
          },
        },
      },
    };
    await viewonceCommand.execute(sock, msg, makeContext());
    const payload = sock.sendMessage.mock.calls[0][1];
    expect(payload.audio).toBeTruthy();
    expect(payload.mimetype).toBe("audio/ogg");
  });

  it("rien de cité → aide", async () => {
    const ctx = makeContext();
    const msg = { key: { remoteJid: "chat", id: "m8" }, message: { conversation: ".vv" } };
    await viewonceCommand.execute(makeSock(), msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("consultation unique");
  });
});

// ── .dl — téléchargeur générique yt-dlp ───────────────────────────────────

describe("parseDlJson — extraction depuis le JSON yt-dlp", () => {
  it("JSON vidéo complet → champs exploitables", () => {
    const info = parseDlJson(
      JSON.stringify({
        title: "Ma vidéo",
        ext: "mp4",
        url: "https://cdn.example/v.mp4",
        filesize: 12345678,
        extractor_key: "Facebook",
        vcodec: "avc1",
        acodec: "mp4a",
      }),
    );
    expect(info).toMatchObject({ title: "Ma vidéo", ext: "mp4", extractor: "Facebook", isImage: false });
    expect(info!.url).toBe("https://cdn.example/v.mp4");
  });
  it("Pinterest (image) → isImage", () => {
    const info = parseDlJson(JSON.stringify({ title: "Pin", ext: "jpg", url: "https://i.pinimg.com/x.jpg", vcodec: "none", acodec: "none" }));
    expect(info?.isImage).toBe(true);
  });
  it("réponse d'erreur yt-dlp → null", () => {
    expect(parseDlJson(JSON.stringify({ error: "private video" }))).toBeNull();
  });
  it("JSON cassé ou sans URL → null", () => {
    expect(parseDlJson("not json")).toBeNull();
    expect(parseDlJson(JSON.stringify({ title: "x" }))).toBeNull();
  });
});

describe(".dl — flux complet mocké", () => {
  it("lien valide → analyse, barre LIVE, document ≤ 90 Mo + lien /d/", async () => {
    const sock = makeSock();
    const ctx = makeContext(["https://www.facebook.com/watch/?v=123"]);
    const msg = { key: { remoteJid: "chat", id: "m9" }, message: { conversation: ".dl https://www.facebook.com/watch/?v=123" } };
    await dlCommand.execute(sock, msg, ctx);
    expect(mSafe).toHaveBeenCalled();
    expect(mYtDlp).toHaveBeenCalled();
    expect(mYtDlp.mock.calls[0][0]).toContain("-J");
    expect(mFetch).toHaveBeenCalled();
    expect(mRegister).toHaveBeenCalled();
    // Document envoyé (5 Mo < 90 Mo) + édition finale avec le lien
    const docCall = sock.sendMessage.mock.calls.find((c: any[]) => c[1]?.document);
    expect(docCall).toBeTruthy();
    expect(docCall![1].fileName).toBe("Vidéo Facebook de test.mp4");
    const finishCall = sock.sendMessage.mock.calls.find((c: any[]) => c[1]?.edit && String(c[1].text).includes("Téléchargement terminé"));
    expect(finishCall).toBeTruthy();
    expect(finishCall![1].text).toContain("https://dash.example/d/tok-dl");
    // cleanup du fichier mocké
    const fetched = mFetch.mock.results[0].value as unknown as string;
    if (existsSync(fetched)) rmSync(fetched, { force: true });
  });

  it("sans lien → aide listant les plateformes", async () => {
    const ctx = makeContext([]);
    const msg = { key: { remoteJid: "chat", id: "m10" }, message: { conversation: ".dl" } };
    await dlCommand.execute(makeSock(), msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Facebook");
  });

  it("URL refusée par la garde SSRF → refus propre", async () => {
    mSafe.mockResolvedValueOnce(false);
    const ctx = makeContext(["http://127.0.0.1/x"]);
    const msg = { key: { remoteJid: "chat", id: "m11" }, message: { conversation: ".dl x" } };
    await dlCommand.execute(makeSock(), msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("pas autorisé");
  });
});

// ── Enregistrement menu + connaissances agent ─────────────────────────────

describe("enregistrement « 1 commande = 3 endroits »", () => {
  it("le menu liste dl, s, take et vv", () => {
    const menu = readFileSync(join(__dirname, "../src/bot/commands/menu.ts"), "utf8");
    expect(menu).toContain('["dl",');
    expect(menu).toContain('["s",');
    expect(menu).toContain('["take",');
    expect(menu).toContain('["vv",');
  });
  it("commandKnowledge connaît dl, le sticker et viewonce", () => {
    const ck = readFileSync(join(__dirname, "../src/bot/commandKnowledge.ts"), "utf8");
    expect(ck).toContain("${p}dl");
    expect(ck).toContain("${p}s\\`"); // backtick echappe dans le template literal source
    expect(ck).toContain("${p}take\\`");
    expect(ck).toContain("${p}vv\\`");
  });
  it("les 4 fichiers de commande existent avec default export", async () => {
    expect(stickerCommand.name).toBe("sticker");
    expect(takeCommand.name).toBe("take");
    expect(viewonceCommand.name).toBe("viewonce");
    expect(dlCommand.name).toBe("dl");
    expect(dlCommand.acceptsUrlArgs).toBe(true);
  });
});
