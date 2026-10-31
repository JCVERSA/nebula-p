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
      ["f", "Films VF / VOSTFR (novafilm)"],
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
      ["welcome", "Message d’accueil auto (+ .welcome card <preset>)"],
      ["goodbye", "Message de départ auto (+ .goodbye card <preset>)"],
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
      ["agtrace", "Trace une décision de Nova sans l'exécuter (owner)"],
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
      await context.react("🌌");

      // Le registre est la seule source de vérité (curation 8.59).
      const commands: BotCommand[] = (global as any).botCommands || [];

      const uptime = formatUptime(process.uptime() * 1000);

      // MSG 1 — CARTE D'EN-TÊTE (9.18ffff : stats ESSENTIELLES — la carte
      // complète à 10 lignes remplissait le chat pour rien).
      const header =
        `╭══〘〘 \`${bn}\` 〙〙═⊷\n` +
        `│↠✒️ ᴘʀᴇғɪx: [ ${p} ]\n` +
        `│↠🧩 ᴄᴍᴅs: *${commands.length}*\n` +
        `│↠🚀 ᴠᴇʀsɪᴏɴ: ${APP_VERSION}\n` +
        `│↠⏱️ ᴜᴘᴛɪᴍᴇ: ${uptime}\n` +
        `╰═══════════════════════⊷`;

      // Sections rendues à partir du registre : une entrée dont la commande
      // n'existe pas est ignorée (+ warn) — le menu reste honnête.
      const known = new Set<string>();
      for (const cmd of commands) {
        known.add(cmd.name.toLowerCase());
        for (const a of cmd.aliases || []) known.add(a.toLowerCase());
      }

      // ── Rendu d'une section (descriptions complètes, boîtes Na) ──────────
      const renderSection = (sec: MenuSection): string | null => {
        const lines: string[] = [];
        for (const [key, desc] of sec.entries) {
          if (!known.has(key.toLowerCase())) {
            console.warn(`[Menu] Entrée ignorée (commande absente du registre): ${key}`);
            continue;
          }
          lines.push(c(p, key, desc));
        }
        return lines.length ? section(sec.emoji, sec.title, lines) : null;
      };

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
      const footerHints =
        `\n${contactBlock}> 🌌 *${bn}* │ _\`${p}menu <n°>\` catégorie · \`${p}menu all\` · \`${p}menu <mot>\` · \`${p}help <cmd>\`_`;

      const filterArg = (context.args || []).join(" ").trim();

      // ── 9.18ffff — `.menu <n°>` : UNE catégorie (interactif, zéro flood).
      if (/^\d+$/.test(filterArg)) {
        const n = parseInt(filterArg, 10);
        const idx = n - 1;
        const sec = idx >= 0 && idx < MENU_SECTIONS.length ? renderSection(MENU_SECTIONS[idx]) : null;
        if (!sec) {
          return void (await context.reply(
            `❓ *Catégorie inconnue* — réponds \`${p}menu 1\` à \`${p}menu ${MENU_SECTIONS.length}\`, ou \`${p}menu\` pour la carte.`,
          ));
        }
        await sock.sendMessage(msg.key.remoteJid!, { text: `${sec}\n${footerHints}` }, { quoted: msg });
        console.log(`[Menu] Catégorie ${n} en ${Date.now() - startTime}ms`);
        return;
      }

      // ── 9.18ffff — `.menu all` : affichage COMPLET (comportement historique).
      if (filterArg.toLowerCase() === "all") {
        const rendered = MENU_SECTIONS.map(renderSection).filter((x): x is string => !!x);
        const messages: string[] = [];
        let idx = 0;
        for (const count of SECTIONS_PER_MESSAGE) {
          const chunk = rendered.slice(idx, idx + count);
          if (!chunk.length) continue;
          messages.push(chunk.join("\n\n"));
          idx += count;
        }
        if (idx < rendered.length) messages.push(rendered.slice(idx).join("\n\n"));
        if (messages.length) messages[messages.length - 1] += footerHints;
        await sock.sendMessage(msg.key.remoteJid!, { text: header, mentions: [context.sender] }, { quoted: msg });
        for (const m of messages) {
          await delay(600);
          await sock.sendMessage(msg.key.remoteJid!, { text: m });
        }
        console.log(`[Menu] Complet (${rendered.length} sections) en ${Date.now() - startTime}ms`);
        return;
      }

      // ── 9.18oooo — `.menu <mot-clé>` : filtre les sections (inchangé). ────
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
            `🔍 Aucune commande ne correspond à « ${filterArg} ».\n\`${p}menu\` pour la carte, \`${p}menu all\` pour tout afficher.`,
          ));
        }
        await sock.sendMessage(
          msg.key.remoteJid!,
          { text: `╭─「 🔎 *MENU · ${filterArg.toUpperCase().slice(0, 30)}* 」\n\n${hits.join("\n\n")}\n\n${footerHints}` },
          { quoted: msg },
        );
        console.log(`[Menu] Filtered "${filterArg}" (${hits.length} section(s)) in ${Date.now() - startTime}ms`);
        return;
      }

      // ── 9.18ffff — DÉFAUT : carte COMPACTE interactive (1 seul message).
      // Décision owner 31/10 : le menu complet (4 messages ~54 commandes)
      // remplissait le chat — la carte liste les catégories numérotées avec
      // 3 commandes phares, le détail se prend À LA DEMANDE.
      const indexLines: string[] = [];
      MENU_SECTIONS.forEach((s, i) => {
        const examples = s.entries
          .filter(([key]) => known.has(key.toLowerCase()))
          .slice(0, 3)
          .map(([key]) => `${p}${key}`);
        if (!examples.length) return;
        indexLines.push(`${i + 1}. ${s.emoji} *${s.title}* — ${examples.join(", ")}…`);
      });
      const compact = `${header}\n\n${section("🗂️", "CATÉGORIES", indexLines)}${footerHints}`;
      await sock.sendMessage(msg.key.remoteJid!, { text: compact, mentions: [context.sender] }, { quoted: msg });
      console.log(`[Menu] Carte compacte (${indexLines.length} catégories) en ${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error("[Menu] Error:", error?.message || error);
      await context.reply("😕 Le menu n'a pas pu s'afficher.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default menuCommand;
