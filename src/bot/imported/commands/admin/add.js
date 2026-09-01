/**
 * Add Command — Ajouter un membre au groupe
 * Nebula Bot by Dark Neon
 */

const { longDelay } = require('../../utils/antibanDelay');

module.exports = {
  name: 'add',
  aliases: ['adduser', 'addmember', 'ajouter'],
  category: 'admin',
  description: 'Ajouter un membre au groupe',
  usage: '.add <numéro> ou .add @mention',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      let targets = [];

      // Cas 1 : mentions directes
      if (mentioned.length > 0) {
        targets = mentioned;
      }
      // Cas 2 : numéros en arguments
      else if (args.length > 0) {
        for (const arg of args) {
          const num = arg.replace(/[^0-9]/g, '');
          if (num.length >= 7) {
            targets.push(`${num}@s.whatsapp.net`);
          }
        }
      }

      if (targets.length === 0) {
        return extra.reply(
          `❌ *Utilisation incorrecte*\n\n` +
          `Méthode 1 : *.add @user*\n` +
          `Méthode 2 : *.add 237612345678*\n` +
          `Méthode 3 : *.add 237612345678 237698765432* (plusieurs)`
        );
      }

      if (targets.length > 5) {
        return extra.reply('❌ Maximum 5 membres à la fois!');
      }

      const results   = { success: [], failed: [], notOnWA: [] };

      for (const jid of targets) {
        try {
          await longDelay();
          const result = await sock.groupParticipantsUpdate(extra.from, [jid], 'add');
          const status = result?.[0]?.status;

          if (status === '200' || status === 200) {
            results.success.push(jid);
          } else if (status === '403' || status === 403) {
            results.failed.push({ jid, reason: 'L\'utilisateur a bloqué les invitations' });
          } else if (status === '408' || status === 408) {
            results.failed.push({ jid, reason: 'Invitation expirée, envoie le lien du groupe' });
          } else if (status === '409' || status === 409) {
            results.failed.push({ jid, reason: 'Déjà dans le groupe' });
          } else if (status === '404' || status === 404) {
            results.notOnWA.push(jid);
          } else {
            results.failed.push({ jid, reason: `Code: ${status}` });
          }
        } catch (e) {
          results.failed.push({ jid, reason: e.message });
        }
      }

      // Construire le message de résultat
      let text = '📋 *Résultat du .add*\n\n';

      if (results.success.length > 0) {
        const tags = results.success.map(j => `@${j.split('@')[0]}`).join(', ');
        text += `✅ *Ajouté(s) :* ${tags}\n`;
      }

      if (results.failed.length > 0) {
        text += `\n❌ *Échecs :*\n`;
        for (const f of results.failed) {
          text += `• @${f.jid.split('@')[0]} — ${f.reason}\n`;
        }
      }

      if (results.notOnWA.length > 0) {
        const tags = results.notOnWA.map(j => `+${j.split('@')[0]}`).join(', ');
        text += `\n⚠️ *Pas sur WhatsApp :* ${tags}`;
      }

      await sock.sendMessage(extra.from, {
        text,
        mentions: [...results.success, ...results.failed.map(f => f.jid)]
      }, { quoted: msg });

    } catch (err) {
      await extra.reply(`❌ Erreur: ${err.message}`);
    }
  }
};
