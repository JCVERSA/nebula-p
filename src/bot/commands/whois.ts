import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

/**
 * `.whois` — portage natif de l'original neb (general/whois.js, owner request
 * 8.59). Version profil : résolution de la cible (mention / reply / numéro /
 * soi-même), rôle dans le groupe, badges, photo de profil et statut WhatsApp.
 * Les stats d'activité (groupstats) et les warns de l'original ne sont PAS
 * portés : ce système n'existe pas dans ce bot (décision 8.59 — pas de
 * modération ni d'économie).
 */

const whoisCommand: BotCommand = {
  name: "whois",
  aliases: ["profile", "profil", "wi", "userinfo", "ui"],
  category: "Outils",
  description: "Profil d'un membre du groupe (rôle, badges, photo).",
  usage: ".whois @user (ou réponds à un message)",
  execute: async (sock, msg, context) => {
    try {
      const from = msg.key.remoteJid!;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;

      // ── Résoudre la cible (mention / reply / numéro / soi-même) ─────────
      let target: string | null = ctx?.mentionedJid?.[0] || null;
      if (!target && ctx?.quotedMessage) target = ctx.participant || null;
      if (!target && (context.args || [])[0]) {
        const num = context.args[0].replace(/[^0-9]/g, "");
        if (num.length >= 6) target = `${num}@s.whatsapp.net`;
      }
      if (!target) target = context.sender;

      // ── Membres du groupe ────────────────────────────────────────────────
      const members = context.getGroupMembers ? await context.getGroupMembers(from) : [];
      const resolvedTarget = target as string;
      const participant = members.find(m => m.id === resolvedTarget || m.number === resolvedTarget.split("@")[0]);

      if (!participant) {
        return void (await context.reply("❌ Cet utilisateur n'est pas dans le groupe."));
      }

      const finalTarget: string = participant.id;
      const number = finalTarget.split("@")[0];
      const isAdmin = participant.admin === "admin" || participant.admin === "superadmin";
      const isOwnerGroup = participant.admin === "superadmin";
      const ownerCfg = getConfig().ownerNumber;
      const isBotOwner = ownerCfg.includes(number);

      // ── Profil WhatsApp (photo + statut) ──────────────────────────────────
      let ppUrl: string | null = null;
      try {
        ppUrl = await sock.profilePictureUrl(finalTarget, "image");
      } catch {}
      let statusText: string | null = null;
      try {
        const statusRes = await (sock as any).fetchStatus(finalTarget);
        statusText = statusRes?.status || null;
      } catch {}

      // ── Badges (comme l'original, sans les badges d'activité) ────────────
      const badges: string[] = [];
      if (isBotOwner) badges.push("👑 Owner du bot");
      if (isOwnerGroup) badges.push("👑 Owner du groupe");
      else if (isAdmin) badges.push("🛡️ Admin");

      // ── Carte de profil ──────────────────────────────────────────────────
      let text = `👤 *PROFIL*\n\n`;
      text += `📛 *Numéro :* @${number}\n`;
      text += `🎫 *Rôle :* ${isOwnerGroup ? "👑 Propriétaire du groupe" : isAdmin ? "🛡️ Administrateur" : "👤 Membre"}\n`;
      if (statusText) text += `💬 *Statut :* ${statusText}\n`;
      if (badges.length) text += `\n🏅 *Badges :* ${badges.join(" | ")}\n`;

      if (ppUrl) {
        await sock.sendMessage(from, {
          image: { url: ppUrl },
          caption: text,
          mentions: [finalTarget]
        }, { quoted: msg });
      } else {
        text += `\n🖼️ Pas de photo de profil visible.`;
        await sock.sendMessage(from, { text, mentions: [finalTarget] }, { quoted: msg });
      }
    } catch (error: any) {
      console.error("[WHOIS] Error:", error?.message || error);
      await context.reply("❌ Impossible d'afficher ce profil.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default whoisCommand;
