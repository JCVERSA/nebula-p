import { BotCommand } from "../types.js";
import { getConfig } from "../config.js";

/**
 * 9.18oooo (quick win) — `.help <commande>` : carte d'aide détaillée en
 * français avec exemples concrets tapables. Sans argument : guide court.
 *
 * Le registre reste la seule source de vérité : les commandes viennent de
 * (global).botCommands (cf. commandRegistry) — jamais de liste codée dure.
 */

const helpCommand: BotCommand = {
  name: "help",
  category: "General",
  description: "Aide détaillée d'une commande (avec exemples) ou guide rapide.",
  usage: ".help <commande>",
  aliases: ["h", "info"],
  execute: async (_sock, msg, context) => {
    const config = getConfig();
    const p = config.prefix || ".";
    const commands: BotCommand[] = (global as any).botCommands || [];

    await context.react("📖");

    // 1. Sans argument : guide court
    if (!context.args || context.args.length === 0) {
      const helpText =
        `📖 *Aide Nebula* 📖\n\n` +
        `Pour l'aide détaillée d'une commande (description, usage, alias, exemples) :\n` +
        `👉 \`${p}help <commande>\`\n\n` +
        `*Ex :* \`${p}help warn\`\n\n` +
        `⚡ *Astuces :*\n` +
        `• \`${p}menu\` liste toutes les catégories.\n` +
        `• \`${p}menu <mot-clé>\` filtre le menu (ex : \`${p}menu groupe\`).\n` +
        `• Les commandes marchent avec ou sans majuscules.\n` +
        `• Certaines commandes sont réservées aux admins de groupe.\n\n` +
        `🌌 _Nebula Engine — actif et sécurisé_`;
      return void (await context.reply(helpText));
    }

    // 2. Recherche par nom ou alias (insensible à la casse)
    const query = String(context.args[0] || "").toLowerCase().trim();
    const targetCmd = commands.find(
      cmd => cmd.name.toLowerCase() === query ||
             (cmd.aliases && cmd.aliases.some(alias => alias.toLowerCase() === query)),
    );

    if (!targetCmd) {
      await context.react("❓");
      return void (await context.reply(
        `❓ *Commande inconnue :* \`${query}\`\n\n\`${p}menu\` pour voir toutes les commandes disponibles.`,
      ));
    }

    // 3. Carte détaillée
    let detail = `📘 *${targetCmd.name}* — ${targetCmd.category}\n\n`;
    detail += `📝 ${targetCmd.description}\n\n`;

    // Les usage sont écrits avec le préfixe par défaut « . » — on remplace
    // par le préfixe réel, quel qu'il soit.
    const rawUsage = targetCmd.usage || targetCmd.name;
    const usageStr = `${p}${rawUsage.replace(/^\./, "")}`;
    detail += `💡 *Utilisation :* \`${usageStr}\`\n`;

    if (targetCmd.aliases && targetCmd.aliases.length > 0) {
      detail += `🔗 *Alias :* ${targetCmd.aliases.map(al => `\`${p}${al}\``).join(", ")}\n`;
    }

    // Badges de capacité (tags du registre — honnêteté immédiate)
    const badges: string[] = [];
    if ((targetCmd as any).ownerOnly) badges.push("👑 owner Nebula");
    if ((targetCmd as any).adminOnly) badges.push("🛡️ admin du groupe");
    if ((targetCmd as any).groupOnly) badges.push("👥 groupes uniquement");
    if ((targetCmd as any).privateOnly) badges.push("🔒 privé uniquement");
    if (badges.length > 0) detail += `🎯 *Accès :* ${badges.join(" · ")}\n`;

    if (targetCmd.examples && targetCmd.examples.length > 0) {
      detail += `\n✨ *Exemples :*\n`;
      for (const ex of targetCmd.examples.slice(0, 4)) {
        detail += `• \`${ex.startsWith(p) ? ex : `${p}${ex}`}\`\n`;
      }
    }

    detail += `\n_Les paramètres entre <chevrons> ou [crochets] sont à remplacer._`;

    await context.reply(detail);
  },
};

export default helpCommand;
