import { BotCommand } from "../types.js";
import { groupJidOf } from "../utils/groupTargets.js";
import { getWelcome, setWelcome, getGoodbye, setGoodbye, DEFAULT_WARN_TEXT, DEFAULT_GOODBYE_TEXT } from "../services/groupSettingsStore.js";

/**
 * 9.18mmmm — messages d'accueil / départ : .welcome / .goodbye.
 *
 * `.welcome`            → état + gabarit actuel
 * `.welcome on`         → active le message (gabarit par défaut si aucun)
 * `.welcome off`        → désactive
 * `.welcome <texte>`    → gabarit personnalisé + active
 *
 * Variables : {user} (mention du nouveau), {groupe} (nom réel), {count}
 * (taille du groupe). Désactivé par défaut — jamais de message surprise.
 */

function statusText(label: string, conf: { enabled: boolean; text: string }, prefix: string, cmd: string, defaultText: string): string {
  return (
    `${label} : *${conf.enabled ? "activé ✅" : "désactivé ⛔"}*\n\n` +
    `Gabarit actuel :\n« ${conf.text || defaultText} »\n\n` +
    `Variables : \`{user}\` (mention), \`{groupe}\`, \`{count}\`\n\n` +
    `• \`${prefix}${cmd} on\` — activer\n` +
    `• \`${prefix}${cmd} off\` — désactiver\n` +
    `• \`${prefix}${cmd} Bienvenue {user} dans {groupe} ! 🎉\` — gabarit personnalisé`
  );
}

function welcomeCommandFactory(kind: "welcome" | "goodbye"): BotCommand {
  const isWelcome = kind === "welcome";
  const name = isWelcome ? "welcome" : "goodbye";
  const aliases = isWelcome ? ["bienvenue"] : ["aurevoir"];
  const label = isWelcome ? "👋 Message d'accueil" : "👋 Message de départ";
  const defaultText = isWelcome ? DEFAULT_WARN_TEXT : DEFAULT_GOODBYE_TEXT;
  return {
    name,
    aliases,
    category: "Groupe",
    adminOnly: true,
    groupOnly: true,
    description: isWelcome ? "Message automatique d'accueil des nouveaux membres (admin)." : "Message automatique de départ des membres (admin).",
    usage: isWelcome ? ".welcome on|off|<texte>" : ".goodbye on|off|<texte>",
    examples: isWelcome
      ? [".welcome on", ".welcome off", ".welcome Salut {user} dans {groupe} !"]
      : [".goodbye on", ".goodbye off", ".goodbye {user} nous quitte…"],
    execute: async (_sock, msg, context) => {
      const gid = groupJidOf(msg);
      if (!gid) return void (await context.reply("👥 Cette commande ne fonctionne que dans un *groupe*."));
      if (!context.isAdmin && !context.isOwner) return void (await context.reply("⛔ *Réservé aux admins du groupe.*"));
      const get = isWelcome ? getWelcome : getGoodbye;
      const set = isWelcome ? setWelcome : setGoodbye;
      const arg = (context.args?.[0] || "").toLowerCase();
      if (context.args && context.args.length > 0 && (arg === "on" || arg === "off")) {
        const conf = set(gid, { enabled: arg === "on" });
        await context.reply(
          arg === "on"
            ? `${label} *activé* ✅\nGabarit : « ${conf.text || defaultText} »`
            : `${label} *désactivé* ⛔`,
        );
        return;
      }
      const custom = (context.args || []).join(" ").trim();
      if (custom) {
        const conf = set(gid, { enabled: true, text: custom.slice(0, 400) });
        await context.reply(`${label} *activé* avec le nouveau gabarit ✅\n« ${conf.text} »`);
        return;
      }
      await context.reply(statusText(label, get(gid), context.prefix, name, defaultText));
    },
  };
}

export const welcomeCommand = welcomeCommandFactory("welcome");
export const goodbyeCommand = welcomeCommandFactory("goodbye");
