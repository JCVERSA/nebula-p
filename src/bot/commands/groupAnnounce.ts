import { BotCommand } from "../types.js";
import { groupJidOf, botJidOf } from "../utils/groupTargets.js";
import { resolveLiveSocket } from "../liveSocket.js";
import { typingPresence } from "../services/humanize.js";

/**
 * 9.18mmmm — annonces groupe : .tagall / .hidetag / .del.
 *
 * .tagall  → mentionne tous les membres (visible) avec un message optionnel ;
 * .hidetag → mentionne tous les membres SANS les afficher dans le texte
 *            (mentions fantômes — notifie tout le monde sans mur de @) ;
 * .del     → supprime le message cité (reply) — nécessite que le bot soit
 *            admin du groupe.
 *
 * Anti-ban (axe F) : typing presence avant l'annonce + cap 100 membres.
 */

const MAX_MENTIONED = 100;

async function memberJids(context: any, gid: string, botJid: string | null): Promise<string[]> {
  const members = (await context.getGroupMembers?.(gid)) || [];
  const list: Array<{ id: string; admin: string | null }> = members || [];
  return list.map(m => m.id).filter((id: string) => !botJid || id !== botJid).slice(0, MAX_MENTIONED);
}

const tagallCommand: BotCommand = {
  name: "tagall",
  aliases: ["everyone", "tous"],
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Mentionner tous les membres avec un message (admin).",
  usage: ".tagall [message]",
  examples: [".tagall Réunion ce soir", ".tagall"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    try {
      const live = resolveLiveSocket(sock);
      const jids = await memberJids(context, gid, botJidOf(live));
      if (jids.length === 0) return void (await context.reply("❌ Liste des membres indisponible — réessaie."));
      const custom = (context.args || []).join(" ").trim();
      const header = custom ? `📢 *${custom}*` : "📢 *Mention générale*";
      const body = jids.map(j => `@${j.split("@")[0]}`).join(" ");
      await typingPresence(live, gid);
      await live.sendMessage(gid, { text: `${header}\n\n${body}`, mentions: jids }, { quoted: msg });
    } catch {
      await context.reply("❌ Mention générale impossible — réessaie.");
    }
  },
};

const hidetagCommand: BotCommand = {
  name: "hidetag",
  aliases: ["tag", "ghost"],
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Annonce avec mentions invisibles — notifie tout le monde sans mur de @ (admin).",
  usage: ".hidetag <message>",
  examples: [".hidetag Nouvel épisode dispo !"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    const message = (context.args || []).join(" ").trim();
    if (!message) {
      return void (await context.reply(`👻 \`${context.prefix}hidetag <message>\` — notifie tout le monde sans afficher les mentions.\nEx : \`${context.prefix}hidetag Nouvel épisode dispo, tape .menu\``));
    }
    try {
      const live = resolveLiveSocket(sock);
      const jids = await memberJids(context, gid, botJidOf(live));
      if (jids.length === 0) return void (await context.reply("❌ Liste des membres indisponible — réessaie."));
      await typingPresence(live, gid);
      await live.sendMessage(gid, { text: message, mentions: jids }, { quoted: msg });
    } catch {
      await context.reply("❌ Envoi impossible — réessaie.");
    }
  },
};

const delCommand: BotCommand = {
  name: "del",
  aliases: ["delete", "supprime"],
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Supprimer un message du groupe (reply au message, admin).",
  usage: ".del (réponds au message à supprimer)",
  examples: [".del (en reply du message)"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    const ctxInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo;
    const stanzaId = ctxInfo?.stanzaId;
    const participant = ctxInfo?.participant;
    if (!stanzaId) {
      return void (await context.reply(`🗑️ Réponds au message à supprimer avec \`${context.prefix}del\`.`));
    }
    try {
      const key: Record<string, unknown> = { remoteJid: gid, id: stanzaId, fromMe: false };
      if (participant) key.participant = participant;
      await resolveLiveSocket(sock).sendMessage(gid, { delete: key });
      await context.react("🗑️");
    } catch {
      await context.reply("❌ Suppression impossible — je dois être *admin du groupe* (et le message doit être récent).");
    }
  },
};

export { tagallCommand, hidetagCommand, delCommand };
