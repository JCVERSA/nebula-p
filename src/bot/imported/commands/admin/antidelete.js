// Nebula Bot by Dark Neon
/**
 * AntiDelete Command — Renvoie les messages supprimés à l'admin en privé
 * Le hook est dans handler.js (handleAntiDelete)
 */

const database = require('../../database');

module.exports = {
  name: 'antidelete',
  aliases: ['ad', 'antiدel'],
  category: 'admin',
  description: 'Renvoie les messages supprimés à l\'admin en privé',
  usage: '.antidelete <on/off>',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);

      if (!args[0]) {
        const status = settings.antidelete ? '✅ ON' : '❌ OFF';
        return extra.reply(
          `🗑️ *AntiDelete*\n\n` +
          `Statut: *${status}*\n\n` +
          `Quand activé, les messages supprimés sont\n` +
          `renvoyés aux admins en message privé.\n\n` +
          `Usage:\n` +
          `  .antidelete on\n` +
          `  .antidelete off`
        );
      }

      const opt = args[0].toLowerCase();
      if (!['on', 'off'].includes(opt)) {
        return extra.reply('❌ Option invalide. Utilise: *.antidelete on* ou *.antidelete off*');
      }

      const enable = opt === 'on';
      if (enable && settings.antidelete) return extra.reply('*AntiDelete est déjà activé.*');
      if (!enable && !settings.antidelete) return extra.reply('*AntiDelete est déjà désactivé.*');

      database.updateGroupSettings(extra.from, { antidelete: enable });

      await extra.reply(
        enable
          ? `✅ *AntiDelete activé !*\n\nLes messages supprimés dans ce groupe seront renvoyés aux admins en privé.`
          : `❌ *AntiDelete désactivé.*`
      );

    } catch (error) {
      await extra.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
