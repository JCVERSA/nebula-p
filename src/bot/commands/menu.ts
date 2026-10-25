import os from "os";
import { BotCommand } from "../types.js";
import { effectiveTimezone, getConfig } from "../config.js";

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
      ["agent", "L'agent IA exécute tes demandes (beta, privé)"],
      ["define", "Définition d'un mot ou concept"],
      ["trad", "Traduction (ex: .trad en Bonjour — par reply aussi)"],
      ["tts", "Lit un texte en note vocale (reply, ou .tts <texte>)"],
      ["on", "Réponses vocales de l'agent (voix Henri)"], 
      ["off", "Coupe les réponses vocales (retour au texte)"],
      ["search", "Recherche web (sources récentes : -w semaine, -d 24 h)"],
      ["fetch", "Lire une page web en texte"],
      ["resume", "Résumé IA d'une page (reply à un lien, ou .resume <url>)"],
      ["wiki", "Résumé Wikipédia FR"],
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
      ["dl", "Facebook / X / Pinterest / Reddit… (générique)"],
      ["dla", "Audio seul d'un lien (SoundCloud, YouTube…)"],
    ],
  },
  {
    emoji: "🎌",
    title: "ANIME",
    entries: [
      ["a", "Anime VF / VOSTFR (catalogues as, va ou jt)"],
      ["slim", "Allège la dernière vidéo lourde livrée (~190 Mo, même résolution)"],
      ["w", "Veille des nouveaux épisodes"],
      ["trace", "Identifie l’anime d’une image (réponds à l’image)"],
    ],
  },
  {
    emoji: "👥",
    title: "GROUPE (ADMIN)",
    entries: [
      ["kick", "Expulser un membre (reply ou @mention)"],
      ["promote", "Promouvoir admin"],
      ["demote", "Retirer le rôle admin"],
      ["warn", "Avertir (3e = expulsion auto)"],
      ["mute", "Réserver le groupe aux admins"],
      ["unmute", "Réouvrir le groupe à tous"],
      ["tagall", "Mentionner tous les membres"],
      ["hidetag", "Annonce à mentions invisibles"],
      ["del", "Supprimer un message (reply)"],
      ["grouplink", "Lien d’invitation (reset = owner)"],
      ["groupinfo", "Fiche du groupe"],
      ["welcome", "Message d’accueil automatique"],
      ["goodbye", "Message de départ automatique"],
    ],
  },
  {
    emoji: "🔧",
    title: "TOOLS & UTILITY",
    entries: [
      ["sweb", "Capture d'écran d'un site web"],
      ["up", "Lien temporaire (2 h) pour un fichier (ou en reply)"],
      ["s", "Image / vidéo → sticker WhatsApp"],
      ["take", "Reprends un sticker reçu (pack Nebula)"],
      ["vv", "Révèle un média à consultation unique (reply)"],
      ["qr", "Génère un QR code"],
      ["base64", "Encode / décode (Base64, hex, binaire…)"],
      ["getpp", "Photo de profil"],
      ["whois", "Profil d'un membre du groupe"],
      ["purge", "Purge de l'espace disque (owner)"],
      ["remind", "Rappel programmé (ex: .remind 18h texte)"],
      ["lyrics", "Paroles d'une chanson (seul après .ytm, ou .lyrics <titre>)"],
    ],
  },
  {
    emoji: "📊",
    title: "GENERAL",
    entries: [
      ["ping", "Vitesse et latence"],
      ["poll", "Sondage natif (.poll Question | choix 1 | choix 2)"],
      ["menu", "Cette liste (alias .cmds)"],
      ["help", "Aide détaillée par commande"],
    ],
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
      const tz = effectiveTimezone(); // 9.18hhh : NEBULA_TZ > config > UTC — aucun pays codé dur
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

      // 9.18oooo (quick win) — .menu <mot-clé> : filtre les sections. 50
      // commandes = menu long ; un mot-clé ne renvoie que les entrées qui
      // correspondent (nom, description ou titre de section, sans accents).
      const filterArg = (context.args || []).join(" ").trim();
      if (filterArg) {
        const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const needle = norm(filterArg);
        const hits: string[] = [];
        for (const s of MENU_SECTIONS) {
          const lines: string[] = [];
          for (const [key, desc] of s.entries) {
            if (!known.has(key.toLowerCase())) continue; // honnêteté : commande inconnue ignorée
            if (norm(key).includes(needle) || norm(desc || "").includes(needle) || norm(s.title).includes(needle)) {
              lines.push(c(p, key, desc));
            }
          }
          if (lines.length) hits.push(section(s.emoji, s.title, lines));
        }
        if (hits.length === 0) {
          return void (await context.reply(
            `🔍 Aucune commande ne correspond à « ${filterArg} ».\n\`${p}menu\` sans filtre pour tout afficher.`,
          ));
        }
        await sock.sendMessage(
          msg.key.remoteJid!,
          { text: `╭─「 🔎 *MENU · ${filterArg.toUpperCase().slice(0, 30)}* 」\n\n${hits.join("\n\n")}\n\n> 🌌 *${bn}* │ _\`${p}menu\` pour tout afficher_` },
          { quoted: msg },
        );
        console.log(`[Menu] Filtered "${filterArg}" (${hits.length} section(s)) in ${Date.now() - startTime}ms`);
        return;
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

      // Footer (contacts owner — configurables via .env, 9.18hhh : le repo
      // public reste neutre, chaque déploiement affiche SES contacts).
      // 9.18jjj : .env prioritaire, sinon config dashboard (page Config).
      const ownerName = (process.env.OWNER_NAME || config.ownerName || "").trim();
      const ownerPhone = String(process.env.OWNER_NUMBER || config.ownerNumber || "").replace(/\D/g, "");
      const ownerTelegram = (process.env.OWNER_TELEGRAM || config.ownerTelegram || "").trim().replace(/^@/, "");
      const ownerLines: string[] = [];
      if (ownerPhone || ownerTelegram) {
        ownerLines.push(ownerName ? `│ 👑 *OWNER* — ${ownerName}\n` : `│ 👑 *OWNER*\n`);
        if (ownerPhone) ownerLines.push(`│ 📞 wa.me/${ownerPhone}\n`);
        if (ownerTelegram) ownerLines.push(`│ ✈️  t.me/${ownerTelegram}\n`);
      }
      const contactBlock = ownerLines.length
        ? `╭══════════════════════════════╮\n` + ownerLines.join("") + `╰══════════════════════════════╯\n`
        : "";
      const footer = `\n${contactBlock}> 🌌 *${bn}* │ _Prefix: ${p}_`;

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
