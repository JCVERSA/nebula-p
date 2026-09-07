import os from "os";
import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

/**
 * `.menu` — portage du style du bot Na (commands/general/menu.js, owner
 * request 8.60) : carte d'en-tête avec stats (mode, préfixe, utilisateur,
 * commandes, version, uptime, heure, RAM), sections encadrées
 * `╭─「 🤖 *TITRE* 」…╰┄┄`, footer owner. Interface texte uniquement
 * (décision owner) et contenu = NOS vraies commandes (curation 8.59) :
 * les entrées sont validées contre le registre — le menu ne peut pas
 * annoncer une commande qui n'existe pas.
 */

/** Keep in sync with package.json — pinned by tests/menuNa.test.ts. */
export const APP_VERSION = "1.1.0";

export type MenuEntry = [key: string, desc?: string];
export interface MenuSection {
  emoji: string;
  title: string;
  entries: MenuEntry[];
}

/**
 * Plan d'affichage : `key` = nom OU alias enregistré (résolu au runtime).
 * Exporté pour le test d'inventaire (le menu doit couvrir le registre).
 */
export const MENU_SECTIONS: MenuSection[] = [
  {
    emoji: "🤖",
    title: "AI",
    entries: [
      ["ai", "Pose une question à l'IA"],
      ["image", "Génère une image par IA"],
      ["define", "Définition d'un mot ou concept"],
    ],
  },
  {
    emoji: "⬇️",
    title: "DOWNLOADER",
    entries: [
      ["ytv", "YouTube → vidéo MP4 (360/480/720/1080)"],
      ["ytm", "YouTube → audio MP3"],
      ["yts", "Recherche YouTube (liens)"],
      ["tiktok", "TikTok sans watermark"],
      ["instagram", "Instagram photo / vidéo / reel"],
    ],
  },
  {
    emoji: "🎌",
    title: "ANIME",
    entries: [
      ["a", "Anime en VF / VOSTFR"],
      ["w", "Veille des nouveaux épisodes"],
      ["trace", "Identifie l’anime d’une image (réponds à l’image)"],
    ],
  },
  {
    emoji: "🔧",
    title: "TOOLS & UTILITY",
    entries: [
      ["sweb", "Capture d'écran d'un site web"],
      ["qr", "Génère un QR code"],
      ["base64", "Encode / décode (Base64, hex, binaire…)"],
      ["getpp", "Photo de profil"],
      ["whois", "Profil d'un membre du groupe"],
    ],
  },
  {
    emoji: "📊",
    title: "GENERAL",
    entries: [["ping", "Vitesse et latence"], ["menu", "Cette liste (alias .cmds)"], ["help", "Aide détaillée par commande"]],
  },
];

/** Sections envoyées dans le 2ᵉ message (les suivantes dans le 3ᵉ). */
const SECTIONS_PER_MESSAGE = [2, 3];

// ── Helpers (fidèles au menu Na) ─────────────────────────────────────────────

function section(emoji: string, title: string, lines: string[]): string {
  const body = lines.map(l => (l === "" ? "│" : `│  ◈  ${l}`)).join("\n");
  return `╭─「 ${emoji} *${title}* 」\n${body}\n╰${"┄".repeat(22)}`;
}

const c = (prefix: string, name: string, desc?: string) => (desc ? `\`${prefix}${name}\` — _${desc}_` : `\`${prefix}${name}\``);

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${d}d ${h}h ${m}m ${sc}s`;
}

function getRam(): string {
  const total = os.totalmem();
  const used = total - os.freemem();
  return `${(used / 1024 ** 3).toFixed(2)} GB / ${(total / 1024 ** 3).toFixed(2)} GB`;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Commande ────────────────────────────────────────────────────────────────

const menuCommand: BotCommand = {
  name: "menu",
  aliases: ["commands", "cmds"],
  category: "General",
  description: "Afficher toutes les commandes par catégorie.",
  usage: "menu",
  execute: async (sock, msg, context) => {
    try {
      const startTime = Date.now();
      const config = getConfig();
      const p = config.prefix || ".";
      const bn = config.botName || "Nebula Bot";
      const tz = config.timezone || "Africa/Douala";
      await context.react("🌌");

      // Le registre est la seule source de vérité (curation 8.59).
      const commands: BotCommand[] = (global as any).botCommands || [];

      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: tz });
      const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
      const uptime = formatUptime(process.uptime() * 1000);
      const ram = getRam();
      const senderName = context.senderName || context.sender.split("@")[0];

      // MSG 1 — CARTE D'EN-TÊTE
      const header =
        `╭══〘〘 \`${bn}\` 〙〙═⊷\n` +
        `│↠🤖 ᴍᴏᴅᴇ: public\n` +
        `│↠✒️ ᴘʀᴇғɪx: [ ${p} ]\n` +
        `│↠👤 ᴜsᴇʀ: ${senderName}\n` +
        `│↠🧩 ᴄᴍᴅs: *${commands.length}*\n` +
        `│↠🚀 ᴠᴇʀsɪᴏɴ: ${APP_VERSION}\n` +
        `│↠⏱️ ᴜᴘᴛɪᴍᴇ: ${uptime}\n` +
        `│↠⏰ ᴛɪᴍᴇ: ${timeStr}\n` +
        `│↠📅 ᴅᴀᴛᴇ: ${dateStr}\n` +
        `│↠🌍 ᴛɪᴍᴇ ᴢᴏɴᴇ: ${tz}\n` +
        `│↠💾 ʀᴀᴍ: ${ram}\n` +
        `╰═══════════════════════⊷`;

      // Sections rendues à partir du registre : une entrée dont la commande
      // n'existe pas est ignorée (+ warn) — le menu reste honnête.
      const known = new Set<string>();
      for (const cmd of commands) {
        known.add(cmd.name.toLowerCase());
        for (const a of cmd.aliases || []) known.add(a.toLowerCase());
      }
      const rendered: string[] = [];
      for (const s of MENU_SECTIONS) {
        const lines: string[] = [];
        for (const [key, desc] of s.entries) {
          if (!known.has(key.toLowerCase())) {
            console.warn(`[Menu] Entrée ignorée (commande absente du registre): ${key}`);
            continue;
          }
          lines.push(c(p, key, desc));
        }
        if (lines.length) rendered.push(section(s.emoji, s.title, lines));
      }

      // Footer (contacts owner — confirmés par le owner, 8.60)
      const footer =
        `\n╭══════════════════════════════╮\n` +
        `│ 👑 *OWNER* — Dark Neon\n` +
        `│ 📞 wa.me/237640143760\n` +
        `│ ✈️  t.me/Neonjca2\n` +
        `╰══════════════════════════════╯\n` +
        `> 🌌 *${bn}* │ _Prefix: ${p}_`;

      // Découpe en messages successifs (comme Na, ~2 sections par message).
      const messages: string[] = [];
      let idx = 0;
      for (const count of SECTIONS_PER_MESSAGE) {
        const chunk = rendered.slice(idx, idx + count);
        if (!chunk.length) continue;
        messages.push(chunk.join("\n\n"));
        idx += count;
      }
      if (idx < rendered.length) {
        messages.push(rendered.slice(idx).join("\n\n"));
      }
      if (messages.length) {
        messages[messages.length - 1] += footer;
      }

      // Envoi : carte (reply + mention), puis les messages de sections.
      await sock.sendMessage(msg.key.remoteJid!, { text: header, mentions: [context.sender] }, { quoted: msg });

      console.log(`[Menu] Generated in ${Date.now() - startTime}ms`);

      for (const m of messages) {
        await delay(600);
        await sock.sendMessage(msg.key.remoteJid!, { text: m });
      }
    } catch (error: any) {
      console.error("[Menu] Error:", error?.message || error);
      await context.reply("😕 Le menu n'a pas pu s'afficher.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default menuCommand;
