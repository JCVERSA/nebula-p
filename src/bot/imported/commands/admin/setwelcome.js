// Nebula Bot by Dark Neon
/**
 * SetWelcome — Personnaliser le message de bienvenue
 * Variables disponibles : {name}, {numero}, {group}, {count}, {date}, {heure}, {description}
 */

'use strict';

const database = require('../../database');

const HELP_TEXT =
  `👋 *Paramètres du message de bienvenue*\n\n` +
  `*Variables disponibles :*\n` +
  `  \`{name}\` — Prénom/pseudo du membre\n` +
  `  \`{numero}\` — Numéro de téléphone\n` +
  `  \`{group}\` — Nom du groupe\n` +
  `  \`{count}\` — Nombre de membres\n` +
  `  \`{date}\` — Date complète (ex: lundi 14 mars 2026)\n` +
  `  \`{heure}\` — Heure d'arrivée (ex: 07:45)\n` +
  `  \`{description}\` — Description du groupe\n\n` +
  `*Exemple :*\n` +
  `\`.setwelcome 🌌 Bienvenue {name} !\n` +
  `Tu es le membre n°{count} de {group}.\n` +
  `Arrivée le {date} à {heure} 🎉\`\n\n` +
  `*Commandes :*\n` +
  `  \`.setwelcome <message>\` — définir\n` +
  `  \`.setwelcome reset\` — remettre par défaut\n` +
  `  \`.setwelcome preview\` — aperçu du message actuel`;

module.exports = {
  name: 'setwelcome',
  aliases: ['welcomemsg', 'welcomeset'],
  category: 'admin',
  description: 'Personnaliser le message de bienvenue',
  usage: '.setwelcome <message>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const groupId  = extra.from;
      const settings = database.getGroupSettings(groupId);

      if (!args[0]) {
        const current = settings.welcomeMessage || '_(message par défaut)_';
        return extra.reply(
          HELP_TEXT + `\n\n*Message actuel :*\n${current}`
        );
      }

      const sub = args[0].toLowerCase();

      // reset
      if (sub === 'reset') {
        database.updateGroupSettings(groupId, { welcomeMessage: null });
        return extra.reply('✅ Message de bienvenue remis par défaut !');
      }

      // preview
      if (sub === 'preview') {
        const preview = (settings.welcomeMessage || '_(aucun message personnalisé — défaut utilisé)_');
        return extra.reply(`👀 *Aperçu du message actuel :*\n\n${preview}`);
      }

      // set
      const newMessage = args.join(' ');
      database.updateGroupSettings(groupId, { welcomeMessage: newMessage });
      return extra.reply(
        `✅ *Message de bienvenue mis à jour !*\n\n` +
        `📝 *Nouveau message :*\n${newMessage}\n\n` +
        `_Les variables ({name}, {count}...) seront remplacées automatiquement._`
      );

    } catch (error) {
      await extra.reply(`❌ Erreur : ${error.message}`);
    }
  }
};
