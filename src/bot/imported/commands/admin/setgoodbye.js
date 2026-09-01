// Nebula Bot by Dark Neon
/**
 * SetGoodbye — Personnaliser le message de départ
 * Variables disponibles : {name}, {numero}, {group}, {count}, {date}, {heure}, {description}
 */

'use strict';

const database = require('../../database');

const HELP_TEXT =
  `👋 *Paramètres du message de départ*\n\n` +
  `*Variables disponibles :*\n` +
  `  \`{name}\` — Prénom/pseudo du membre\n` +
  `  \`{numero}\` — Numéro de téléphone\n` +
  `  \`{group}\` — Nom du groupe\n` +
  `  \`{count}\` — Membres restants après départ\n` +
  `  \`{date}\` — Date complète (ex: lundi 14 mars 2026)\n` +
  `  \`{heure}\` — Heure de départ (ex: 07:45)\n` +
  `  \`{description}\` — Description du groupe\n\n` +
  `*Exemple :*\n` +
  `\`.setgoodbye 😢 {name} nous a quittés...\n` +
  `Il reste {count} membres dans {group}.\n` +
  `Départ le {date} à {heure}.\`\n\n` +
  `*Commandes :*\n` +
  `  \`.setgoodbye <message>\` — définir\n` +
  `  \`.setgoodbye reset\` — remettre par défaut\n` +
  `  \`.setgoodbye preview\` — aperçu du message actuel`;

module.exports = {
  name: 'setgoodbye',
  aliases: ['goodbyemsg', 'goodbyeset'],
  category: 'admin',
  description: 'Personnaliser le message de départ',
  usage: '.setgoodbye <message>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      const groupId  = extra.from;
      const settings = database.getGroupSettings(groupId);

      if (!args[0]) {
        const current = settings.goodbyeMessage || '_(message par défaut)_';
        return extra.reply(
          HELP_TEXT + `\n\n*Message actuel :*\n${current}`
        );
      }

      const sub = args[0].toLowerCase();

      // reset
      if (sub === 'reset') {
        database.updateGroupSettings(groupId, { goodbyeMessage: null });
        return extra.reply('✅ Message de départ remis par défaut !');
      }

      // preview
      if (sub === 'preview') {
        const preview = (settings.goodbyeMessage || '_(aucun message personnalisé — défaut utilisé)_');
        return extra.reply(`👀 *Aperçu du message actuel :*\n\n${preview}`);
      }

      // set
      const newMessage = args.join(' ');
      database.updateGroupSettings(groupId, { goodbyeMessage: newMessage });
      return extra.reply(
        `✅ *Message de départ mis à jour !*\n\n` +
        `📝 *Nouveau message :*\n${newMessage}\n\n` +
        `_Les variables ({name}, {count}...) seront remplacées automatiquement._`
      );

    } catch (error) {
      await extra.reply(`❌ Erreur : ${error.message}`);
    }
  }
};
