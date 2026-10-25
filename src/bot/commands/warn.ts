import { BotCommand } from "../types.js";
import { groupJidOf, extractModerationTargets, botJidOf } from "../utils/groupTargets.js";
import { resolveLiveSocket } from "../liveSocket.js";
import { addWarn, resetWarns, listWarnedUsers, warnKickThreshold, WARN_DECAY_MS } from "../services/groupSettingsStore.js";

/**
 * 9.18mmmm — avertissements : .warn (persistants, décroissance 7 jours).
 *
 * `.warn @user <raison>`  → avertit ; au 3ᵉ avertissement actif (seuil
 *                            NEBULA_WARN_KICK, défaut 3 ; 0 = désactivé)
 *                            le membre est expulsé et son compteur remis à zéro.
 * `.warn`                 → liste des avertissements actifs du groupe.
 * `.warn reset @user`     → remet le compteur à zéro.
 *
 * Défenses : jamais un admin (le propriétaire du groupe est superadmin),
 * jamais le bot. Le compteur SURVIT aux redémarrages (fichier JSON) et un
 * avertissement de plus de 7 jours ne compte plus.
 */

function fmtRemaining(at: number, now = Date.now()): string {
  const left = Math.max(0, WARN_DECAY_MS - (now - at));
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  return days > 0 ? `${days} j` : `${hours} h`;
}

const warnCommand: BotCommand = {
  name: "warn",
  category: "Groupe",
  adminOnly: true,
  groupOnly: true,
  description: "Avertir un membre (3e = expulsion auto) — `list` / `reset`.",
  usage: ".warn @membre <raison> · .warn · .warn reset @membre",
  examples: [".warn @membre spam", ".warn (en reply) insultes", ".warn reset @membre"],
  execute: async (sock, msg, context) => {
    const gid = groupJidOf(msg);
    if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
    if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));

    const args = context.args || [];
    const botJid = botJidOf(resolveLiveSocket(sock));
    const targets = extractModerationTargets(msg, args, botJid);

    // .warn (sans cible) → état des avertissements du groupe
    if (targets.length === 0 && args[0]?.toLowerCase() !== "reset") {
      const warned = listWarnedUsers(gid);
      const threshold = warnKickThreshold();
      if (warned.length === 0) {
        return void (await context.reply(`⚖️ *Aucun avertissement actif.*\n\n\`${context.prefix}warn @membre <raison>\` — ${threshold > 0 ? `le ${threshold}ᵉ avertissement entraîne l'expulsion` : "expulsion auto désactivée (NEBULA_WARN_KICK=0)"}.\nLes avertissements s'effacent d'eux-mêmes après 7 jours.`));
      }
      const lines = warned.map(w => `• @${w.user.split("@")[0]} — *${w.warns.length}/${threshold > 0 ? threshold : "∞"}* (dernier : « ${w.warns[w.warns.length - 1].reason} », expire dans ${fmtRemaining(w.warns[w.warns.length - 1].at)})`);
      await context.reply(`⚖️ *Avertissements actifs :*\n\n${lines.join("\n")}\n\n_\`${context.prefix}warn reset @membre\` pour effacer._`, );
      return;
    }

    // .warn reset @membre
    if (args[0]?.toLowerCase() === "reset") {
      const resetTargets = extractModerationTargets(msg, args.slice(1), botJid);
      if (resetTargets.length === 0) {
        return void (await context.reply(`♻️ \`${context.prefix}warn reset @membre\` — réponds à son message ou mentionne-le.`));
      }
      for (const t of resetTargets) resetWarns(gid, t);
      await resolveLiveSocket(sock).sendMessage(
        gid,
        { text: `♻️ Compteur d'avertissements remis à zéro : ${resetTargets.map(t => `@${t.split("@")[0]}`).join(", ")}`, mentions: resetTargets },
        { quoted: msg },
      );
      return;
    }

    // .warn @membre <raison>
    if (targets.length === 0) {
      return void (await context.reply(`⚖️ \`${context.prefix}warn @membre <raison>\` — réponds à son message ou mentionne-le.`));
    }
    // Raison = args moins les étiquettes de cible (@pseudo, numéros nus).
    const targetNumbers = new Set(targets.map(t => t.split("@")[0]));
    const reason = args
      .filter(a => !a.startsWith("@") && !targetNumbers.has(a.replace(/[^0-9]/g, "")))
      .join(" ")
      .trim() || "aucune raison précisée";
    try {
      const members = (await context.getGroupMembers?.(gid)) || [];
      const member = members.find(m => m.id === targets[0]);
      if (member?.admin) {
        return void (await context.reply("🛡️ Les admins du groupe ne peuvent pas être avertis."));
      }
      const threshold = warnKickThreshold();
      const count = addWarn(gid, targets[0], reason);
      if (threshold > 0 && count >= threshold) {
        const res = await context.kickMember?.(gid, targets[0]);
        if (res === null || res === undefined) throw new Error("kick refusé");
        resetWarns(gid, targets[0]);
        await resolveLiveSocket(sock).sendMessage(
          gid,
          { text: `⚖️ @${targets[0].split("@")[0]} a atteint *${threshold} avertissements* — expulsion automatique. Compteur remis à zéro.`, mentions: [targets[0]] },
          { quoted: msg },
        );
        return;
      }
      await resolveLiveSocket(sock).sendMessage(
        gid,
        {
          text: `⚖️ @${targets[0].split("@")[0]} averti (${reason}) — *${count}/${threshold > 0 ? threshold : "∞"}*${threshold > 0 ? ` : au ${threshold}ᵉ, expulsion automatique` : ""}. S'efface après 7 jours.`,
          mentions: [targets[0]],
        },
        { quoted: msg },
      );
    } catch {
      await context.reply("❌ Avertissement enregistré mais expulsion impossible (je dois être admin) — réessaie ou expulse manuellement.");
    }
  },
};

export default warnCommand;
