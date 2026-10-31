import { beforeEach, describe, expect, it, vi } from "vitest";
import { initRegistry } from "../src/bot/commandRegistry.js";
import menuCommand from "../src/bot/commands/menu.js";

/**
 * 9.18ffff — menu compact interactif (décision owner 31/10) : `.menu`
 * remplissait le chat (4 messages, ~54 commandes). Désormais : UNE carte
 * compacte (catégories numérotées + stats essentielles), `.menu <n°>` pour
 * une catégorie, `.menu all` pour l'affichage historique, filtre inchangé.
 */

const JID = "1555600000050@s.whatsapp.net";

function mk(args: string[]) {
  const sent: any[] = [];
  const sock = {
    sendMessage: vi.fn(async (_to: string, payload: any) => {
      sent.push(payload);
      return {};
    }),
  };
  const msg = { key: { remoteJid: JID } };
  const ctx = { args, sender: JID, senderName: "Tester", react: vi.fn(async () => {}), reply: vi.fn(async (t: string) => { sent.push({ text: t }); }) };
  return { sock, msg, ctx, sent };
}

beforeEach(async () => {
  await initRegistry();
});

describe("9.18ffff — .menu compact interactif", () => {
  it("sans args → UNE carte compacte : catégories numérotées, stats essentielles, hints", async () => {
    const { sock, msg, ctx, sent } = mk([]);
    await menuCommand.execute!(sock as any, msg as any, ctx as any);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1); // UN SEUL message, zéro flood
    const text = String(sent[0].text);
    expect(text).toContain("CATÉGORIES");
    expect(text).toContain("1. 🤖 *AI*");
    expect(text).toContain("6. 📊 *GENERAL*");
    expect(text).toContain("`.menu <n°>`");
    expect(text).toContain("`.menu all`");
    // stats essentielles uniquement (décision owner : préfixe, cmds, version, uptime)
    expect(text).toContain("ᴘʀᴇғɪx");
    expect(text).toContain("ᴠᴇʀsɪᴏɴ");
    expect(text).not.toContain("ʀᴀᴍ");
    expect(text).not.toContain("ᴛɪᴍᴇ ᴢᴏɴᴇ");
    expect(text).not.toContain("ᴜsᴇʀ");
  });

  it(".menu 2 → LA catégorie DOWNLOADER seule, descriptions complètes", async () => {
    const { sock, msg, ctx, sent } = mk(["2"]);
    await menuCommand.execute!(sock as any, msg as any, ctx as any);
    expect(sock.sendMessage).toHaveBeenCalledTimes(1);
    const text = String(sent[0].text);
    expect(text).toContain("DOWNLOADER");
    expect(text).toContain("`.ytv`");
    expect(text).not.toContain("*AI*"); // une seule catégorie, pas de voisin
  });

  it(".menu 99 → hors bornes → aide honnête (jamais d'écran vide)", async () => {
    const { sock, msg, ctx, sent } = mk(["99"]);
    await menuCommand.execute!(sock as any, msg as any, ctx as any);
    expect(sock.sendMessage).not.toHaveBeenCalled(); // pas d'écran vide ni de flood
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(String(sent[0].text)).toContain("Catégorie inconnue");
    expect(String(sent[0].text)).toContain("`.menu 1`");
  });

  it(".menu all → affichage complet historique (carte + sections, tout y est)", async () => {
    const { sock, msg, ctx, sent } = mk(["all"]);
    await menuCommand.execute!(sock as any, msg as any, ctx as any);
    expect(sock.sendMessage.mock.calls.length).toBeGreaterThan(2); // multi-messages conservés
    const joined = sent.map((x: any) => String(x.text || "")).join("\n");
    for (const t of ["AI", "DOWNLOADER", "ANIME", "GROUPE (ADMIN)", "TOOLS & UTILITY", "GENERAL"]) {
      expect(joined).toContain(t);
    }
  }, 20000);

  it(".menu youtube → filtre 9.18oooo inchangé", async () => {
    const { sock, msg, ctx, sent } = mk(["youtube"]);
    await menuCommand.execute!(sock as any, msg as any, ctx as any);
    const text = String(sent[0].text);
    expect(text).toContain("MENU · YOUTUBE");
    expect(text).toContain("`.ytv`");
  });
});
