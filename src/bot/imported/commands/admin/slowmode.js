// Nebula Bot by Dark Neon
/**
 * SlowMode Command — Limite les membres à 1 message par X secondes
 * Le tracking est en mémoire dans handler.js
 */

const database = require('../../database');

const PRESETS = {
  low:    { seconds: 10,  label: '🐢 Faible  (1 msg / 10s)'  },
  medium: { seconds: 30,  label: '🚶 Moyen   (1 msg / 30s)'  },
  high:   { seconds: 60,  label: '🐌 Élevé   (1 msg / 60s)'  },
  strict: { seconds: 300, label: '🔒 Strict  (1 msg / 5min)' },
};

module.exports = {
  name: 'slowmode',
  aliases: ['slow', 'slowm', 'lent'],
  category: 'admin',
  description: 'Limite chaque membre à 1 message par X secondes',
  usage: '.slowmode <on/off/low/medium/high/strict/Xs>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);
      const current  = settings.slowmode || 0;

      if (!args[0]) {
        const statusLine = current > 0
          ? `✅ *ON* — 1 message / *${current}s*`
          : `❌ *OFF*`;

        return extra.reply(
          `⏱️ *SlowMode*\n\n` +
          `Statut actuel: ${statusLine}\n\n` +
          `*Présets disponibles:*\n` +
          Object.entries(PRESETS).map(([k, v]) => `  .slowmode ${k} — ${v.label}`).join('\n') +
          `\n\n*Personnalisé:*\n` +
          `  .slowmode 45s → 1 msg toutes les 45s\n\n` +
          `*Désactiver:*\n` +
          `  .slowmode off`
        );
      }

      const opt = args[0].toLowerCase();

      // OFF
      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { slowmode: 0 });
        return extra.reply('❌ *SlowMode désactivé.*\nTous les membres peuvent écrire librement.');
      }

      // Préset nommé
      let seconds = 0;
      if (PRESETS[opt]) {
        seconds = PRESETS[opt].seconds;
      } else if (opt === 'on') {
        seconds = 30; // défaut: medium
      } else {
        // Durée personnalisée: "30s", "60s", "120", etc.
        const match = opt.match(/^(\d+)s?$/);
        if (!match) {
          return extra.reply(
            `❌ Option invalide.\n\n` +
            `Utilise un préset: *low, medium, high, strict*\n` +
            `Ou une durée: *.slowmode 45s*\n` +
            `Ou: *.slowmode off*`
          );
        }
        seconds = parseInt(match[1]);
        if (seconds < 5)  return extra.reply('❌ Minimum 5 secondes.');
        if (seconds > 3600) return extra.reply('❌ Maximum 3600 secondes (1 heure).');
      }

      database.updateGroupSettings(extra.from, { slowmode: seconds });

      const mins = seconds >= 60 ? `${Math.floor(seconds/60)}min${seconds%60 > 0 ? ` ${seconds%60}s` : ''}` : `${seconds}s`;
      await extra.reply(
        `⏱️ *SlowMode activé !*\n\n` +
        `Les membres peuvent envoyer *1 message toutes les ${mins}*.\n` +
        `Les admins ne sont pas affectés.`
      );

    } catch (error) {
      await extra.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
