import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { initRegistry, getCommands, getCommand, suggestClosestCommand } from "../src/bot/commandRegistry.js";

/**
 * Inventaire DÉFINITIF des commandes (curation owner, 8.59 ; .image retirée en 8.73 ;
 * 9.18llll : + sticker/take/viewonce/dl — décision owner 23/10 « analyse
 * KnightBot-Mini et ajoute ce qui vaut le coup », écrits from scratch en
 * patterns maison, PAS un retour du corpus legacy 8.59).
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
  // 9.18llll : reprise concurrent KnightBot-Mini (décision owner 23/10) —
  // implémentations NEUVES (ffmpeg maison + EXIF webpmux, yt-dlp générique).
  { name: "sticker", aliases: ["s", "stiker", "st"] },
  { name: "take", aliases: ["steal", "repack"] },
  { name: "viewonce", aliases: ["vv", "readvo", "readviewonce"] },
  { name: "dl", aliases: ["download", "gdl"] },
  // 9.18mmmm : suite admin groupe P1 (décision owner 24/10 « ok comme par p1 »).
  // kick/promote/demote/hidetag SORTENT de la liste bannie 8.59 — implémentations
  // NEUVES 100% maison (inspiration KnightBot, zéro copier-coller), refus admin,
  // seuil warn NEBULA_WARN_KICK. Arsenal « anti- » et .members restent bannis.
  { name: "kick", aliases: ["expulse"] },
  { name: "promote", aliases: [] },
  { name: "demote", aliases: [] },
  { name: "mute", aliases: [] },
  { name: "unmute", aliases: [] },
  { name: "grouplink", aliases: ["lien"] },
  { name: "groupinfo", aliases: ["ginfo"] },
  { name: "tagall", aliases: ["everyone", "tous"] },
  { name: "hidetag", aliases: ["tag", "ghost"] },
  { name: "del", aliases: ["delete", "supprime"] },
  { name: "welcome", aliases: ["bienvenue"] },
  { name: "goodbye", aliases: ["aurevoir"] },
  { name: "warn", aliases: [] },
  // 9.18nnnn : P2 (décision owner 24/10 « p2 ») — paroles LRCLIB sans clé
  // + sondage natif WhatsApp.
  { name: "lyrics", aliases: ["paroles"] },
  { name: "poll", aliases: ["sondage", "vote"] },
  // 9.18oooo : quick wins R&D — .dla (audio seul d'un lien).
  { name: "dla", aliases: [] },
  // 9.18wwww : Novaboxb — films (décision owner 25/10, French-Stream).
  { name: "novafilm", aliases: ["f", "film", "films"] },
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
    // 9.18llll : sticker/s/download/dl SORTIS de la liste bannie — décision
    // owner 23/10 (nouvelles implémentations, pas le retour du legacy 8.59).
    // 9.18mmmm : kick/promote/demote/hidetag SORTIS à leur tour — décision
    // owner 24/10 (P1 suite admin groupe, code maison). L'arsenal « anti- »
    // (antilink/antitag/antibot), .members, .owner et .access restent bannis.
    const banned = [
      "media", "m", "translate",
      "owner", "members",
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

describe("9.18qqqq — fichiers multi-commandes groupe : aucun faux warning (bug casse terrain 25/10)", () => {
  it("groupModeration/groupSettings/groupAnnounce/groupWelcome sur disque ne produisent AUCUN warning", async () => {
    // Retour terrain 25/10 : « ⚠️ Commande non chargée : groupModeration.ts » ×4
    // à chaque boot VPS alors que les 13 commandes étaient enregistrées (53).
    // Cause : les entrées camelCase du set d'exceptions ne matchaient jamais
    // le nom lowercased du scanner. Fix 9.18qqqq : normalisation lowercase.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nebula-cmds-case-"));
    // Noms EXACTS du disque prod (camelCase) + contenu sans default export,
    // comme les vrais fichiers (exports nommés seulement).
    fs.writeFileSync(path.join(tmp, "groupModeration.ts"), "export const kickCommand = null; export const promoteCommand = null;");
    fs.writeFileSync(path.join(tmp, "groupSettings.ts"), "export const muteCommand = null;");
    fs.writeFileSync(path.join(tmp, "groupAnnounce.ts"), "export const tagallCommand = null;");
    fs.writeFileSync(path.join(tmp, "groupWelcome.ts"), "export const welcomeCommand = null;");
    process.env.NEBULA_COMMANDS_DIR = tmp;
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { warns.push(a.join(" ")); });
    try {
      await initRegistry();
      expect(warns.some((w) => w.includes("groupModeration.ts"))).toBe(false);
      expect(warns.some((w) => w.includes("groupSettings.ts"))).toBe(false);
      expect(warns.some((w) => w.includes("groupAnnounce.ts"))).toBe(false);
      expect(warns.some((w) => w.includes("groupWelcome.ts"))).toBe(false);
      // Les commandes groupe restent enregistrées (built-ins statiques).
      for (const name of ["kick", "promote", "demote", "mute", "unmute", "tagall", "hidetag", "del", "welcome", "goodbye", "warn"]) {
        expect(getCommand(name), `commande ${name}`).toBeTruthy();
      }
    } finally {
      spy.mockRestore();
      delete process.env.NEBULA_COMMANDS_DIR;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
});
