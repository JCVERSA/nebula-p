import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 9.18zzzz — outil interne `img` en chemin PRÉFIXE.
 * Terrain 31/10 : l'agent avait écrit « .img attack on titan » dans le chat,
 * l'utilisateur l'a copié → « Commande inconnue : .img — voulais-tu dire
 * .instagram ? ». L'outil reste hors registre/menu (curation 8.59/8.73) mais
 * un humain qui le tape veut une image : le dispatch route vers la même
 * recherche que l'agent (quota web partagé, replis honnêtes).
 */

vi.mock("../src/bot/botEngine.js", () => ({
  addLog: vi.fn(),
  bufferFromDataUri: vi.fn(() => null),
  getCachedGroupMetadata: vi.fn(async () => null),
  maskLogNumber: vi.fn((s: string) => s),
}));
vi.mock("../src/bot/services/imageFinder.js", () => ({
  findImageCandidates: vi.fn(),
  downloadImageCandidate: vi.fn(),
  IMAGE_SEND_LIMIT: 6,
}));
vi.mock("../src/bot/webQuota.js", () => ({
  checkWebQuota: vi.fn(() => ({ allowed: true, limit: 25 })),
  consumeWebQuota: vi.fn(),
}));
vi.mock("../src/bot/auditTrail.js", () => ({
  recordAudit: vi.fn(),
}));

import { dispatchBotCommand } from "../src/bot/commandDispatch.js";
import { findImageCandidates, downloadImageCandidate } from "../src/bot/services/imageFinder.js";
import { checkWebQuota, consumeWebQuota } from "../src/bot/webQuota.js";

const mFind = vi.mocked(findImageCandidates);
const mDownload = vi.mocked(downloadImageCandidate);
const mQuota = vi.mocked(checkWebQuota);
const mConsume = vi.mocked(consumeWebQuota);

const INFO = {
  senderJid: "1555600000040@s.whatsapp.net",
  actorJid: "1555600000040@s.whatsapp.net",
  senderName: "Tester",
  senderNumber: "1555600000040",
  isOwner: false,
  isAdmin: false,
  isGroup: false,
  prefix: ".",
  text: ".img attack on titan",
  messageContent: null,
};

function makeSock() {
  return { sendMessage: vi.fn(async () => true) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mQuota.mockReturnValue({ allowed: true, limit: 25 } as any);
});

describe("9.18zzzz — .img en préfixe : outil interne routé (plus de « commande inconnue »)", () => {
  it("un humain qui tape .img <sujet> reçoit les images (quota consommé, aucune erreur crue)", async () => {
    mFind.mockResolvedValue({
      candidates: [
        { url: "https://upload.wikimedia.org/a.jpg", attribution: "Wikipédia" },
        { url: "https://upload.wikimedia.org/b.jpg", attribution: "Wikipédia" },
      ],
      engines: ["wikipedia"],
    } as any);
    mDownload.mockResolvedValue({ buffer: Buffer.alloc(16), ext: "jpg" } as any);

    const sock = makeSock();
    const out = await dispatchBotCommand(sock, { key: { remoteJid: INFO.senderJid } }, INFO, "img", ["attack", "on", "titan"], "prefix");

    expect(out.ok).toBe(true);
    const texts = sock.sendMessage.mock.calls.map((c: any) => String(c[1]?.text || "")).filter(Boolean);
    const joined = texts.join(" | ");
    expect(joined).not.toContain("Commande inconnue");
    expect(joined).toContain("2 image(s) envoyée(s) pour « attack on titan »");
    // 2 images (payload image, pas texte) + 1 résumé
    const imageCalls = sock.sendMessage.mock.calls.filter((c: any) => c[1]?.image);
    expect(imageCalls.length).toBe(2);
    expect(mConsume).toHaveBeenCalledTimes(1);
  });

  it(".img sans sujet → usage honnête (pas d'erreur, pas de recherche)", async () => {
    const sock = makeSock();
    await dispatchBotCommand(sock, { key: { remoteJid: INFO.senderJid } }, INFO, "img", [], "prefix");
    const texts = sock.sendMessage.mock.calls.map((c: any) => String(c[1]?.text || "")).filter(Boolean);
    expect(texts[0]).toContain("Donne-moi un sujet");
    expect(mFind).not.toHaveBeenCalled();
  });

  it("quota web épuisé → message de limite, aucune recherche", async () => {
    mQuota.mockReturnValue({ allowed: false, limit: 25 } as any);
    const sock = makeSock();
    await dispatchBotCommand(sock, { key: { remoteJid: INFO.senderJid } }, INFO, "img", ["chat"], "prefix");
    const texts = sock.sendMessage.mock.calls.map((c: any) => String(c[1]?.text || "")).filter(Boolean);
    expect(texts[0]).toContain("Limite web du jour atteinte");
    expect(mFind).not.toHaveBeenCalled();
  });

  it("aucune image trouvée → repli honnête (préciser, ou lien direct + .dl)", async () => {
    mFind.mockResolvedValue({ candidates: [], engines: [] } as any);
    const sock = makeSock();
    await dispatchBotCommand(sock, { key: { remoteJid: INFO.senderJid } }, INFO, "img", ["xyz-inconnu"], "prefix");
    const texts = sock.sendMessage.mock.calls.map((c: any) => String(c[1]?.text || "")).filter(Boolean);
    expect(texts[0]).toContain("Aucune image trouvée");
    expect(mConsume).not.toHaveBeenCalled();
  });

  it("régression : une VRAIE commande inconnue garde sa suggestion (img n'a rien changé)", async () => {
    const sock = makeSock();
    await dispatchBotCommand(sock, { key: { remoteJid: INFO.senderJid } }, INFO, "xyzzy-rien", [], "prefix");
    const texts = sock.sendMessage.mock.calls.map((c: any) => String(c[1]?.text || "")).filter(Boolean);
    expect(texts[0]).toContain("Commande inconnue");
    expect(mFind).not.toHaveBeenCalled();
  });
});
