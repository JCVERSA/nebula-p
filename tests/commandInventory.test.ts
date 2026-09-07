import { describe, expect, it } from "vitest";
import { initRegistry, getCommands, getCommand } from "../src/bot/commandRegistry.js";

/**
 * Inventaire DÉFINITIF des commandes (curation owner, 8.59).
 *
 * La liste ci-dessous est LA vérité absolue décidée par le owner :
 *   .define .sweb .ping .menu .help .image .qr .base64 .getpp .whois
 *   .watch .ai .ytv .yts .ytm .tiktok .instagram + toutes les commandes
 *   novabox (intouchables).
 *
 * Toute commande ajoutée ou retirée par erreur fait échouer ce test et casse
 * la CI. Pour changer l'inventaire, il faut une décision explicite du owner
 * + mettre à jour ce tableau.
 */
const EXPECTED_INVENTORY: Array<{ name: string; aliases: string[] }> = [
  { name: "ping", aliases: [] },
  { name: "menu", aliases: ["commands", "cmds"] },
  { name: "help", aliases: ["h", "info"] },
  { name: "ai", aliases: [] },
  { name: "image", aliases: [] },
  { name: "define", aliases: [] },
  { name: "sweb", aliases: ["ssweb", "screenshot", "ss", "webss"] },
  { name: "w", aliases: ["watch", "veille", "watchlist"] },
  { name: "trace", aliases: ["tracemoe"] },
  { name: "anime", aliases: ["novabox", "a", "nv"] },
  { name: "ytvideo", aliases: ["ytv", "ytmp4", "ytvid", "video"] },
  { name: "song", aliases: ["play", "music", "yta", "mp3", "ytm"] },
  { name: "ytlink", aliases: ["ytsearch", "yts", "youtubelink"] },
  { name: "tiktok", aliases: ["tt", "ttdl", "tiktokdl"] },
  { name: "instagram", aliases: ["ig", "insta", "igdl", "reels"] },
  { name: "qr", aliases: ["qrcode"] },
  { name: "base64", aliases: ["b64"] },
  { name: "getpp", aliases: ["getpic"] },
  { name: "whois", aliases: ["profile", "profil", "wi", "userinfo", "ui"] },
];

describe("inventaire définitif des commandes (8.59)", () => {
  it("le registre contient EXACTEMENT les commandes décidées par le owner", async () => {
    await initRegistry();
    const names = getCommands().map(c => c.name).sort();
    const expected = EXPECTED_INVENTORY.map(c => c.name).sort();
    expect(names).toEqual(expected);
  });

  it("chaque commande garde exactement ses alias prévus", async () => {
    await initRegistry();
    for (const expected of EXPECTED_INVENTORY) {
      const cmd = getCommand(expected.name);
      expect(cmd, `commande manquante: ${expected.name}`).toBeDefined();
      const aliases = [...(cmd!.aliases || [])].sort();
      expect(aliases, `alias de ${expected.name}`).toEqual([...expected.aliases].sort());
    }
  });

  it("les commandes supprimées en 8.59 ne réapparaissent pas", async () => {
    await initRegistry();
    const banned = [
      "media", "m", "s", "sticker", "download", "dl", "translate",
      "owner", "kick", "promote", "demote", "members", "hidetag",
      "antilink", "antitag", "antibot", "access"
    ];
    for (const cmd of getCommands()) {
      expect(banned, `commande bannie réenregistrée: ${cmd.name}`).not.toContain(cmd.name);
      for (const alias of cmd.aliases || []) {
        expect(banned, `alias banni réenregistré: ${alias} (${cmd.name})`).not.toContain(alias);
      }
    }
  });

  it("les commandes novabox restent intouchées (animes/novabox)", async () => {
    await initRegistry();
    const nova = getCommand("anime");
    expect(nova).toBeDefined();
    expect(nova!.aliases).toContain("novabox");
  });
});
