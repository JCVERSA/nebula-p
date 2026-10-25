import { BotCommand } from "../types.js";
import { groupJidOf, extractModerationTargets, botJidOf } from "../utils/groupTargets.js";
import { resolveLiveSocket } from "../liveSocket.js";

/**
 * 9.18mmmm — modération groupe : .kick / .promote / .demote.
 *
 * Inspiration KnightBot-Mini (leurs kick/promote/demote), design maison :
 *  - cibles par @mention, reply OU numéro nu — plusieurs cibles d'un coup ;
 *  - DÉFENSES : jamais un admin du groupe (le propriétaire du groupe est
 *    superadmin → couvert), jamais le bot lui-même, cap 10 cibles par
 *    commande ;
 *  - RoleGuard adminOnly + vérification runtime (défense en profondeur) ;
 *  - confirmation avec mention réelle du membre (jamais de nom codé).
 */

const MAX_TARGETS = 10;

function helpKick(prefix: string): string {
  return (
    `👢 *Expulser un membre*\n\n` +
    `Réponds à son message avec \`${prefix}kick\`, ou mentionne-le : \`${prefix}kick @membre\` (plusieurs à la fois possible).\n\n` +
    `_Les admins du groupe ne peuvent pas être expulsés._`
  );
}

const kickCommand: BotCommand = {
  name: "kick",
  aliases: ["expulse"],
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Expulser un membre du groupe (admin).",
  usage: ".kick @membre (ou en reply, plusieurs possibles)",
  examples: [".kick @membre", ".kick 237600000000", ".kick (en reply du message)"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) {
      return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    }
    const botJid = botJidOf(resolveLiveSocket(sock));
    const targets = extractModerationTargets(msg, context.args || [], botJid);
    if (targets.length === 0) {
      const mentionedBotTried = extractModerationTargets(msg, context.args || [], null).length > 0;
      return void (await context.reply(mentionedBotTried ? "😅 Je ne vais pas m'expulser moi-même." : helpKick(context.prefix)));
    }
    if (targets.length > MAX_TARGETS) {
      return void (await context.reply(`⚠️ Maximum ${MAX_TARGETS} expulsions par commande.`));
    }
    try {
      const members = (await context.getGroupMembers?.(gid)) || [];
      const admins = new Set(members.filter(m => m.admin).map(m => m.id));
      const inGroup = new Set(members.map(m => m.id));
      const kicked: string[] = [];
      for (const target of targets) {
        if (admins.has(target)) {
          await context.reply(`⚠️ @${target.split("@")[0]} est admin du groupe — expulsion refusée.`);
          continue;
        }
        if (inGroup.size > 0 && !inGroup.has(target)) {
          await context.reply(`⚠️ @${target.split("@")[0]} n'est pas dans ce groupe.`);
          continue;
        }
        const res = await context.kickMember?.(gid, target);
        if (res === null || res === undefined) throw new Error("kick refusé");
        kicked.push(target);
      }
      if (kicked.length > 0) {
        await resolveLiveSocket(sock).sendMessage(
          gid,
          {
            text: `👢 ${kicked.length > 1 ? `${kicked.length} membres expulsés` : "Membre expulsé"} : ${kicked.map(t => `@${t.split("@")[0]}`).join(", ")}`,
            mentions: kicked,
          },
          { quoted: msg },
        );
      }
    } catch {
      await context.reply("❌ Expulsion impossible — vérifie que *je suis bien admin du groupe* et réessaie.");
    }
  },
};

const promoteCommand: BotCommand = {
  name: "promote",
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Promouvoir un membre admin du groupe (admin).",
  usage: ".promote @membre (ou en reply)",
  examples: [".promote @membre", ".promote (en reply)"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) {
      return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    }
    const botJid = botJidOf(resolveLiveSocket(sock));
    const targets = extractModerationTargets(msg, context.args || [], botJid);
    if (targets.length === 0) {
      return void (await context.reply(`⬆️ Réponds au membre avec \`${context.prefix}promote\` ou mentionne-le : \`${context.prefix}promote @membre\`.`));
    }
    try {
      const promoted: string[] = [];
      for (const target of targets.slice(0, MAX_TARGETS)) {
        const res = await context.promoteMember?.(gid, target);
        if (res === null || res === undefined) throw new Error("promote refusé");
        promoted.push(target);
      }
      await resolveLiveSocket(sock).sendMessage(
        gid,
        { text: `⬆️ ${promoted.length > 1 ? "Nouveaux admins" : "Nouvel admin"} : ${promoted.map(t => `@${t.split("@")[0]}`).join(", ")}`, mentions: promoted },
        { quoted: msg },
      );
    } catch {
      await context.reply("❌ Promotion impossible — vérifie que *je suis bien admin du groupe* et réessaie.");
    }
  },
};

const demoteCommand: BotCommand = {
  name: "demote",
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Retirer le rôle admin d'un membre (admin).",
  usage: ".demote @membre (ou en reply)",
  examples: [".demote @admin"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) {
      return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
    }
    const botJid = botJidOf(resolveLiveSocket(sock));
    const targets = extractModerationTargets(msg, context.args || [], botJid);
    if (targets.length === 0) {
      return void (await context.reply(`⬇️ Réponds au membre avec \`${context.prefix}demote\` ou mentionne-le : \`${context.prefix}demote @membre\`.`));
    }
    try {
      const members = (await context.getGroupMembers?.(gid)) || [];
      const demoted: string[] = [];
      for (const target of targets.slice(0, MAX_TARGETS)) {
        // Le propriétaire du groupe (superadmin) ne peut pas être rétrogradé.
        const member = members.find(m => m.id === target);
        if (member?.admin === "superadmin") {
          await context.reply("👑 Le propriétaire du groupe ne peut pas être rétrogradé.");
          continue;
        }
        const res = await context.demoteMember?.(gid, target);
        if (res === null || res === undefined) throw new Error("demote refusé");
        demoted.push(target);
      }
      if (demoted.length > 0) {
        await resolveLiveSocket(sock).sendMessage(
          gid,
          { text: `⬇️ Rôle admin retiré : ${demoted.map(t => `@${t.split("@")[0]}`).join(", ")}`, mentions: demoted },
          { quoted: msg },
        );
      }
    } catch {
      await context.reply("❌ Rétrogradation impossible — vérifie que *je suis bien admin du groupe* et réessaie.");
    }
  },
};

export { kickCommand, promoteCommand, demoteCommand };
