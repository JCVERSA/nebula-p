/**
 * Report Command — Signaler un membre aux admins
 * Nebula Bot by Dark Neon
 */

const database = require('../../database');

// Cooldown : 1 report par personne par 10 minutes
const reportCooldowns = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

module.exports = {
  name: 'report',
  aliases: ['signaler', 'sig'],
  category: 'admin',
  description: 'Signaler un membre aux administrateurs du groupe',
  usage: '.report @user <raison>',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      // Cooldown anti-spam
      const lastReport = reportCooldowns.get(extra.sender);
      if (lastReport && Date.now() - lastReport < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastReport)) / 1000);
        return extra.reply(`⏳ Attends encore *${remaining}s* avant de refaire un signalement.`);
      }

      if (!mentioned[0]) {
        return extra.reply(
          `📢 *SIGNALEMENT*\n\n` +
          `Usage : *.report @user <raison>*\n\n` +
          `Ex : *.report @user Envoie du spam dans le groupe*`
        );
      }

      const target = mentioned[0];

      if (target === extra.sender) {
        return extra.reply('❌ Tu ne peux pas te signaler toi-même!');
      }

      // Récupérer les admins
      const metadata = await sock.groupMetadata(extra.from);
      const admins   = metadata.participants.filter(p => p.admin).map(p => p.id);

      if (admins.includes(target)) {
        return extra.reply('❌ Tu ne peux pas signaler un administrateur!');
      }

      const reason = args.filter(a => !a.startsWith('@')).join(' ') || 'Aucune raison précisée';
      const date   = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' });

      reportCooldowns.set(extra.sender, Date.now());

      // Message aux admins
      const reportText =
        `🚨 *NOUVEAU SIGNALEMENT*\n` +
        `${'─'.repeat(28)}\n` +
        `👤 *Signalé :* @${target.split('@')[0]}\n` +
        `📢 *Signalé par :* @${extra.sender.split('@')[0]}\n` +
        `📝 *Raison :* ${reason}\n` +
        `🕒 *Date :* ${date}\n` +
        `${'─'.repeat(28)}\n` +
        `_Admins : @${admins.map(a => a.split('@')[0]).join(' @')}_`;

      await sock.sendMessage(extra.from, {
        text: reportText,
        mentions: [target, extra.sender, ...admins]
      }, { quoted: msg });

      // Confirmer à l'auteur du report (en privé si possible)
      try {
        await sock.sendMessage(extra.sender, {
          text:
            `✅ *Signalement envoyé!*\n\n` +
            `👤 Utilisateur : @${target.split('@')[0]}\n` +
            `📝 Raison : ${reason}\n\n` +
            `Les admins ont été notifiés.`,
          mentions: [target]
        });
      } catch {}

    } catch (err) {
      await extra.reply(`❌ Erreur: ${err.message}`);
    }
  }
};
