// Nebula Bot by Dark Neon
/**
 * AntiViewOnce Command — Rrenvoie les messages "voir une fois" aux admins
 * Le hook est dans handler.js (handleAntiViewOnce)
 */

const database = require('../../database');

module.exports = {
  name: 'antiviewonce',
  aliases: ['avo', 'antiview', 'antivo'],
  category: 'admin',
  description: 'Rrenvoie les messages voir-une-fois aux admins en privé',
  usage: '.antiviewonce <on/off>',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);

      if (!args[0]) {
        const status = settings.antiviewonce ? '✅ ON' : '❌ OFF';
        return extra.reply(
          `👁️ *AntiViewOnce*\n\n` +
          `Statut: *${status}*\n\n` +
          `Quand activé, les images/vidéos "voir une fois"\n` +
          `sont renvoyées aux admins en message privé.\n\n` +
          `Usage:\n` +
          `  .antiviewonce on\n` +
          `  .antiviewonce off`
        );
      }

      const opt = args[0].toLowerCase();
      if (!['on', 'off'].includes(opt)) {
        return extra.reply('❌ Option invalide. Utilise: *.antiviewonce on* ou *.antiviewonce off*');
      }

      const enable = opt === 'on';
      if (enable && settings.antiviewonce) return extra.reply('*AntiViewOnce est déjà activé.*');
      if (!enable && !settings.antiviewonce) return extra.reply('*AntiViewOnce est déjà désactivé.*');

      database.updateGroupSettings(extra.from, { antiviewonce: enable });

      await extra.reply(
        enable
          ? `✅ *AntiViewOnce activé !*\n\nLes médias "voir une fois" seront renvoyés aux admins en privé.`
          : `❌ *AntiViewOnce désactivé.*`
      );

    } catch (error) {
      await extra.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
