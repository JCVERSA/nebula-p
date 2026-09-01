// Nebula Bot by Dark Neon
/**
 * Active Command — Inverse de inactive
 * Liste les membres qui ont envoyé au moins un message aujourd'hui
 */

const { getStats } = require('../../utils/groupstats');

module.exports = {
  name: 'active',
  aliases: ['actif', 'online', 'present'],
  category: 'admin',
  description: 'Liste les membres actifs aujourd\'hui',
  usage: '.active',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: false,

  async execute(sock, msg, args, extra) {
    try {
      await extra.reply('⏳ Vérification de l\'activité...');

      const groupMetadata = await sock.groupMetadata(extra.from);
      const allMembers    = groupMetadata.participants;

      const stats        = getStats(extra.from);
      const statsUsers   = stats ? stats.users : {};
      const activeSenders = new Set(Object.keys(statsUsers));

      // Membres actifs (qui ont envoyé au moins 1 message aujourd'hui)
      const active = allMembers.filter(p => activeSenders.has(p.id));

      const totalMembers   = allMembers.length;
      const inactiveCount  = totalMembers - active.length;

      if (active.length === 0) {
        return extra.reply(
          `😴 *Aucun membre actif aujourd'hui*\n\n` +
          `📊 Total membres : *${totalMembers}*\n` +
          `_Personne n'a encore envoyé de message aujourd'hui !_`
        );
      }

      // Trier par nombre de messages (du plus actif au moins)
      const sorted = active
        .map(p => ({
          id:   p.id,
          msgs: statsUsers[p.id]?.msgs     || 0,
          media: statsUsers[p.id]?.media   || 0,
          cmds: statsUsers[p.id]?.commands || 0,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        }))
        .sort((a, b) => b.msgs - a.msgs);

      const mentions = sorted.map(p => p.id);

      const list = sorted.map((p, i) => {
        const adminTag = p.isAdmin ? ' 👑' : '';
        const tag      = p.id.split('@')[0];
        let line = `${i + 1}. @${tag}${adminTag} — *${p.msgs}* msg`;
        if (p.media > 0)   line += ` • ${p.media} média`;
        if (p.cmds > 0)    line += ` • ${p.cmds} cmd`;
        return line;
      }).join('\n');

      const topUser = sorted[0];
      const pct     = Math.round((active.length / totalMembers) * 100);

      const text =
        `✅ *MEMBRES ACTIFS AUJOURD'HUI*\n` +
        `${'─'.repeat(30)}\n\n` +
        list +
        `\n\n${'─'.repeat(30)}\n` +
        `📊 *Résumé :*\n` +
        `• ✅ Actifs     : *${active.length}* (${pct}%)\n` +
        `• 😴 Inactifs   : *${inactiveCount}*\n` +
        `• 👥 Total      : *${totalMembers}*\n` +
        `• 🏆 Plus actif : @${topUser.id.split('@')[0]} (${topUser.msgs} msg)`;

      await sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });

    } catch (error) {
      await extra.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
