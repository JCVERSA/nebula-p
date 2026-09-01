import { BotCommand } from "../types.js";
import { getGroupPolicy, setGroupPolicy } from "../groupAccessStore.js";
import { DEFAULT_GROUP_POLICY } from "../accessControl.js";
import { getAuditEvents } from "../auditTrail.js";

/**
 * RoleGuard management command (owner-only).
 *
 * Usage:
 *   .access            — show this group's policy
 *   .access default    — reset to default (allow everything, no lists)
 *   .access mode allow — defaultTo allow
 *   .access mode deny  — defaultTo deny
 *   .access deny <cmd|category>[...]      — member deny list (commas or spaces)
 *   .access allow <cmd|category>[...]     — member allow list (wins over deny-default)
 *   .access admin <cmd|category>[...]     — admin allow list (overrides member deny)
 *
 * Lists are replace-on-write, e.g. `.access deny kick promote` sets exactly
 * those two entries. Categories match any command in that category.
 */
const command: BotCommand = {
  name: "access",
  aliases: ["acl", "accesscontrol"],
  category: "security",
  description: "Manage RoleGuard access control for this group (owner only)",
  usage: ".access [mode|deny|allow|admin <entries...>]",
  execute: async (_sock, _msg, context) => {
    if (!context.isOwner) {
      await context.reply("❌ *Access Denied:* RoleGuard management is owner-only.");
      return;
    }
    if (!context.args || context.args.length === 0) {
      const current = getGroupPolicy(context.sender);
      await context.reply(
        `🛡️ *RoleGuard — Current Policy*\n\n` +
        `• Default mode: *${current.defaultTo === "allow" ? "Allow (open)" : "Deny (locked)"}*\n` +
        `• Member deny list: ${current.memberDeny.length ? current.memberDeny.join(", ") : "_none_"}\n` +
        `• Member allow list: ${current.memberAllow.length ? current.memberAllow.join(", ") : "_none_"}\n` +
        `• Admin allow list: ${current.adminAllow.length ? current.adminAllow.join(", ") : "_none_"}\n\n` +
        `✏️ Commands:\n` +
        `• \`.access mode deny\` — lock this group\n` +
        `• \`.access mode allow\` — open this group\n` +
        `• \`.access deny kick promote\` — block commands for members\n` +
        `• \`.access allow menu info\` — allow specific commands for members\n` +
        `• \`.access admin group remove\` — admin overrides (e.g. allow .group for admins)\n` +
        `• \`.access default\` — reset to defaults`
      );
      return;
    }

    const args = [...context.args];
    const sub = args[0].toLowerCase();
    const entries = args.slice(1).join(" ").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const current = getGroupPolicy(context.sender);

    if (sub === "default" || sub === "reset") {
      const reset = setGroupPolicy(context.sender, { ...DEFAULT_GROUP_POLICY });
      await context.reply(`🛡️ *RoleGuard reset to defaults* (mode: ${reset.defaultTo}).`);
      return;
    }
    if (sub === "mode") {
      const mode = (entries[0] || "").toLowerCase();
      if (mode !== "allow" && mode !== "deny") {
        await context.reply("⚠️ Usage: `.access mode <allow|deny>`");
        return;
      }
      const updated = setGroupPolicy(context.sender, { ...current, defaultTo: mode });
      await context.reply(`🛡️ RoleGuard mode set to *${updated.defaultTo}*.`);
      return;
    }
    if (sub === "audit") {
      const count = Math.min(Math.max(1, parseInt(entries[0] || "5", 10) || 5), 20);
      const recent = getAuditEvents(count).filter((e) => e.action.startsWith("roleguard.") || e.action.startsWith("auth."));
      if (recent.length === 0) {
        await context.reply("🛡️ No recent RoleGuard/auth audit events.");
        return;
      }
      const lines = recent.map((e) => `• ${e.at.slice(11, 19)} ${e.action} — ${e.target || e.detail || ""}`).join("\n");
      await context.reply(`🛡️ *Audit Trail (last ${recent.length})*\n\n${lines}`);
      return;
    }
    if (sub === "deny" || sub === "allow" || sub === "admin") {
      // Validate against known command names/categories so typos are caught.
      const registryCards = (global as any).botCommands as
        | Array<{ name: string; category: string }>
        | undefined;
      if (entries.length === 0) {
        await context.reply(`⚠️ Usage: \`.access ${sub} <entry1> <entry2> ...\` (empty list clears it)`);
        return;
      }
      const known = new Set<string>();
      if (registryCards) {
        for (const c of registryCards) {
          known.add(c.name.toLowerCase());
          known.add(c.category.toLowerCase());
        }
        const unknown = entries.filter((e) => !known.has(e));
        if (unknown.length > 0) {
          await context.reply(
            `⚠️ Unknown command/category: ${unknown.map((u) => `\`${u}\``).join(", ")}\n` +
            `_Check \`.help\` for valid names._`
          );
          return;
        }
      }
      if (sub === "deny") {
        const updated = setGroupPolicy(context.sender, { ...current, memberDeny: entries });
        await context.reply(`🛡️ Member deny list updated: ${updated.memberDeny.join(", ") || "_none_"}.`);
      } else if (sub === "allow") {
        const updated = setGroupPolicy(context.sender, { ...current, memberAllow: entries });
        await context.reply(`🛡️ Member allow list updated: ${updated.memberAllow.join(", ") || "_none_"}.`);
      } else {
        const updated = setGroupPolicy(context.sender, { ...current, adminAllow: entries });
        await context.reply(`🛡️ Admin allow list updated: ${updated.adminAllow.join(", ") || "_none_"}.`);
      }
      return;
    }

    await context.reply("⚠️ Unknown subcommand. Use `.access` to see usage.");
  },
};

export default command;
