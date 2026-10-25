import { BotCommand } from "../types.js";
import { groupJidOf } from "../utils/groupTargets.js";
import { resolveLiveSocket } from "../liveSocket.js";

/**
 * 9.18mmmm — réglages groupe : .mute / .unmute / .grouplink / .groupinfo.
 *
 * .mute   → seuls les admins peuvent écrire (groupSettingUpdate announcement)
 * .unmute → retour à la normale (not_announcement)
 * .grouplink → lien d'invitation ; `.grouplink reset` (owner Nebula) révoque
 *              l'ancien lien et en génère un neuf — action destructive donc
 *              réservée à l'owner, pas aux admins du groupe.
 * .groupinfo → fiche du groupe, ouverte à tous les membres.
 */

const muteCommand: BotCommand = {
  name: "mute",
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Réserver le groupe aux admins seuls (admin).",
  usage: ".mute",
  examples: [".mute"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    try {
      await resolveLiveSocket(sock).groupSettingUpdate(gid, "announcement");
      await context.react("🔇");
      await context.reply("🔇 *Groupe réservé aux admins* — seuls les admins peuvent écrire. `.unmute` pour rouvrir.");
    } catch {
      await context.reply("❌ Impossible — vérifie que *je suis bien admin du groupe* et réessaie.");
    }
  },
};

const unmuteCommand: BotCommand = {
  name: "unmute",
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Réautoriser tous les membres à écrire (admin).",
  usage: ".unmute",
  examples: [".unmute"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    try {
      await resolveLiveSocket(sock).groupSettingUpdate(gid, "not_announcement");
      await context.react("🔊");
      await context.reply("🔊 *Groupe réouvert à tous* — tout le monde peut de nouveau écrire.");
    } catch {
      await context.reply("❌ Impossible — vérifie que *je suis bien admin du groupe* et réessaie.");
    }
  },
};

const grouplinkCommand: BotCommand = {
  name: "grouplink",
  aliases: ["lien"],
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Lien d'invitation du groupe (admin) — `reset` régénère (owner).",
  usage: ".grouplink [reset]",
  examples: [".grouplink", ".grouplink reset"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    const sub = (context.args?.[0] || "").toLowerCase();
    try {
      const live = resolveLiveSocket(sock);
      if (sub === "reset") {
        if (!context.isOwner) {
          return void (await context.reply("🔑 *Révoquer le lien est réservé à l'owner Nebula* — un lien révoqué exclut tous les anciens invités."));
        }
        await live.groupRevokeInvite(gid);
        const code = await live.groupInviteCode(gid);
        await context.reply(`♻️ *Ancien lien révoqué.* Nouveau lien d'invitation :\nhttps://chat.whatsapp.com/${code}`);
      } else {
        const code = await live.groupInviteCode(gid);
        await context.reply(`🔗 *Lien d'invitation :*\nhttps://chat.whatsapp.com/${code}\n\n_${context.prefix}grouplink reset_ pour le régénérer (owner)._`);
      }
    } catch {
      await context.reply("❌ Impossible de récupérer le lien — vérifie que *je suis bien admin du groupe*.");
    }
  },
};

const groupinfoCommand: BotCommand = {
  name: "groupinfo",
  aliases: ["ginfo"],
  category: "Groupe",
  groupOnly: true,
  description: "Fiche du groupe : nom, description, membres, admins.",
  usage: ".groupinfo",
  examples: [".groupinfo"],
  execute: async (_sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    try {
      const meta = await context.getGroupMetadata?.(gid);
      if (!meta) throw new Error("pas de metadata");
      const members = (await context.getGroupMembers?.(gid)) || [];
      const admins = members.filter(m => m.admin);
      const owner = meta.owner || members.find(m => m.admin === "superadmin")?.id || null;
      const desc = String(meta.desc || meta.description || "").trim();
      const created = meta.creation ? new Date(Number(meta.creation) * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
      const lines = [
        `👥 *${String(meta.subject || "Groupe").slice(0, 80)}*`,
        desc ? `\n📝 ${desc.slice(0, 300)}${desc.length > 300 ? "…" : ""}` : "",
        `\n\n👤 *Membres :* ${members.length || meta.size || "?"}`,
        `🛡️ *Admins :* ${admins.length}`,
        owner ? `👑 *Créé par :* @${String(owner).split("@")[0]}` : "",
        created ? `\n📅 *Créé le :* ${created}` : "",
      ].filter(Boolean);
      await context.reply(lines.join(""));
    } catch {
      await context.reply("❌ Impossible de lire les informations du groupe — réessaie.");
    }
  },
};

export { muteCommand, unmuteCommand, grouplinkCommand, groupinfoCommand };
