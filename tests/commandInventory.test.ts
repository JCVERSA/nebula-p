import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { initRegistry, getCommands, getCommand, suggestClosestCommand } from "../src/bot/commandRegistry.js";

/**
 * Inventaire DÉFINITIF des commandes (curation owner, 8.59 ; .image retirée en 8.73).
 *
 * La liste ci-dessous est LA vérité absolue décidée par le owner :
 *   .define .sweb .ping .menu .help .qr .base64 .getpp .whois
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
  { name: "define", aliases: [] },
  { name: "sweb", aliases: ["ssweb", "screenshot", "ss", "webss"] },
  { name: "w", aliases: ["watch", "veille", "watchlist"] },
  { name: "trace", aliases: ["tracemoe"] },
  { name: "anime", aliases: ["novabox", "a", "nv"] },
  { name: "slim", aliases: [] }, // 9.18ddd — allègement à la demande (décision owner 17/10)
  { name: "ytvideo", aliases: ["ytv", "ytmp4", "ytvid", "video"] },
  { name: "song", aliases: ["play", "music", "yta", "mp3", "ytm"] },
  { name: "ytlink", aliases: ["ytsearch", "yts", "youtubelink"] },
  { name: "tiktok", aliases: ["tt", "ttdl", "tiktokdl"] },
  { name: "instagram", aliases: ["ig", "insta", "igdl", "reels"] },
  { name: "qr", aliases: ["qrcode"] },
  { name: "base64", aliases: ["b64"] },
  { name: "getpp", aliases: ["getpic"] },
  { name: "whois", aliases: ["profile", "profil", "wi", "userinfo", "ui"] },
  // 8.88 : ajouté sur décision owner explicite (.purge / .p, owner-only)
  { name: "purge", aliases: ["p"] },
  // 8.93 : agent IA (beta, privé) — .agent/.ag
  { name: "agent", aliases: ["ag"] },
  { name: "search", aliases: ["recherche", "websearch"] },
  { name: "fetch", aliases: ["read", "lire"] },
  { name: "wiki", aliases: ["wikipedia", "encyclopedie"] },
  { name: "upload", aliases: ["up", "tr", "lu", "opload", "opl", "upl"] },
  // 9.18u : traduction one-shot (décision owner 14/10, analyse repos —
  // .tr était déjà pris par upload → nom primaire `trad`)
  { name: "trad", aliases: ["traduis", "tl"] },
  // 9.18z : résumé de page web par l'IA (P5 du plan owner — reply à un lien)
  { name: "resume", aliases: ["résume", "sum"] },
  // 9.18bb : rappels programmés (P7 du plan owner — fuseau NEBULA_TZ)
  { name: "remind", aliases: ["rappel", "rappelle"] },
  // 9.18dd : lecture à voix haute (P6 — voix Edge sans clé, reply ou texte)
  { name: "tts", aliases: ["voix", "dis"] },
  // 9.18ii : mode vocal de l'agent (P6b — .on/.off, par chat, voix Henri)
  { name: "on", aliases: [] },
  { name: "off", aliases: [] },
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

// ── 9.11 (audit B1) : suggestion sur typo de commande ──────────────────────
describe("9.11 — suggestClosestCommand (typo → commande la plus proche)", () => {
  it("typo proche → suggestion ; alias exact → canonique ; trop loin → rien", async () => {
    await initRegistry();
    expect(suggestClosestCommand("uv")).toBe("upload");   // .uv → .up (alias de upload)
    expect(suggestClosestCommand("ytv")).toBe("ytvideo"); // alias exact
    expect(suggestClosestCommand("menue")).toBe("menu");
    expect(suggestClosestCommand("a")).toBeNull();        // trop court
    expect(suggestClosestCommand("zzzzzzzz")).toBeNull(); // trop loin de tout
  });
});

describe("9.18mm — voiceMode.ts exempté du scan disque (warning prod erroné)", () => {
  it("un voiceMode.ts dans le dossier commandes ne produit AUCUN warning au boot", async () => {
    // Retour terrain 16/10 : « ⚠️ Commande non chargée : voiceMode.ts » à
    // chaque démarrage VPS alors que .on/.off (built-ins importés
    // statiquement) fonctionnaient et 31 commandes étaient enregistrées.
    // Cause : le scanner disque tentait de recharger le fichier source en
    // prod (Node ne parse pas les .ts). Fix : exception « voicemode ».
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-cmds-"));
    fs.writeFileSync(path.join(tmp, "voiceMode.ts"), "export default {};");
    process.env.NEBULA_COMMANDS_DIR = tmp;
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { warns.push(a.join(" ")); });
    try {
      await initRegistry();
      expect(warns.some((w) => w.includes("voiceMode.ts"))).toBe(false);
      // .on/.off restent bien enregistrés (built-ins, pas touchés)
      expect(getCommand("on")).toBeTruthy();
      expect(getCommand("off")).toBeTruthy();
    } finally {
      spy.mockRestore();
      delete process.env.NEBULA_COMMANDS_DIR;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
});
