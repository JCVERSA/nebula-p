'use strict';
// Nebula Bot by Dark Neon — Group Settings Manager

const { getGroupSettings, updateGroupSettings } = require('../../database');

// Toutes les features configurables par groupe
const FEATURES = {
  // ── Protection ─────────────────────────────────────────────────
  antilink:         { label: 'Anti-link',                emoji: '🔗', category: 'protection' },
  antispam:         { label: 'Anti-spam',                emoji: '🚫', category: 'protection' },
  antitag:          { label: 'Anti-tag',                 emoji: '🏷️',  category: 'protection' },
  antigroupmention: { label: 'Anti @everyone',           emoji: '📢', category: 'protection' },
  antibot:          { label: 'Anti-bot',                 emoji: '🤖', category: 'protection' },
  anticall:         { label: 'Anti-call',                emoji: '📵', category: 'protection' },
  antidelete:       { label: 'Anti-delete',              emoji: '🗑️',  category: 'protection' },
  antiviewonce:     { label: 'Anti-viewonce',            emoji: '👁️',  category: 'protection' },
  // ── Modération ─────────────────────────────────────────────────
  slowmode:         { label: 'Slow mode',                emoji: '⏱️',  category: 'moderation', note: 'Configurer via .slowmode' },
  detect:           { label: 'Détection mots interdits', emoji: '🔍', category: 'moderation' },
  // ── Automatismes ───────────────────────────────────────────────
  welcome:          { label: 'Message de bienvenue',     emoji: '👋', category: 'auto' },
  goodbye:          { label: 'Message de départ',        emoji: '👋', category: 'auto' },
  autosticker:      { label: 'Auto sticker',             emoji: '🎭', category: 'auto' },
  chatbot:          { label: 'AI chatbot (auto reply)',  emoji: '💬', category: 'auto' },
  // ── Contenu ────────────────────────────────────────────────────
  nsfw:             { label: 'Contenu NSFW',             emoji: '🔞', category: 'content' },
};

module.exports = {
  name: 'settings',
  aliases: ['config', 'setting'],
  category: 'admin',
  description: 'View and manage group settings',
  usage: '.settings | .settings <feature> on/off',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply, isOwner, isAdmin } = extra;
      const settings = getGroupSettings(from);

      // ── .settings (sans argument) → afficher tous les settings ──
      if (!args[0]) {
        const CATEGORY_LABELS = {
          protection: '🛡️ PROTECTION',
          moderation: '⚖️ MODÉRATION',
          auto:       '⚙️ AUTOMATISMES',
          content:    '📦 CONTENU',
        };

        // Grouper par catégorie
        const grouped = {};
        for (const [key, feat] of Object.entries(FEATURES)) {
          const cat = feat.category || 'other';
          if (!grouped[cat]) grouped[cat] = [];
          const val    = key === 'slowmode'
            ? (settings[key] > 0 ? `⏱️ ${settings[key]}s` : '❌ OFF')
            : (settings[key] ? '✅ ON' : '❌ OFF');
          const note = feat.note ? ` _(${feat.note})_` : '';
          grouped[cat].push(`│ ${feat.emoji} *${key}* — ${val}${note}`);
        }

        const sections = Object.entries(CATEGORY_LABELS)
          .filter(([cat]) => grouped[cat])
          .map(([cat, catLabel]) =>
            `\n*${catLabel}*\n` + grouped[cat].join('\n')
          ).join('\n');

        return reply(
          '╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n' +
          '┃ ⚙️ *GROUP SETTINGS*\n' +
          '╰━━━━━━━━━━━━━━━━━━━━━━━━╯' +
          sections + '\n\n' +
          '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
          '💡 Usage: `.settings <feature> on/off`\n' +
          'Ex: `.settings antidelete on`'
        );
      }

      // ── .settings <feature> on/off ──────────────────────────────
      const feature = args[0].toLowerCase();
      const action  = args[1]?.toLowerCase();

      if (!FEATURES[feature]) {
        const list = Object.keys(FEATURES).join(', ');
        return reply(
          '❌ Feature *' + feature + '* inconnue.\n\n' +
          '📋 Features disponibles:\n' + list
        );
      }

      if (!action || !['on', 'off'].includes(action)) {
        const current = settings[feature] ? 'ON ✅' : 'OFF ❌';
        return reply(
          '⚙️ *' + feature + '* est actuellement: ' + current + '\n\n' +
          'Usage: `.settings ' + feature + ' on` ou `.settings ' + feature + ' off`'
        );
      }

      const newValue = action === 'on';

      // Slowmode: on = activer avec 30s par défaut si pas déjà configuré
      if (feature === 'slowmode') {
        const currentSlow = settings.slowmode || 0;
        if (newValue && currentSlow === 0) {
          updateGroupSettings(from, { slowmode: 30 });
          return reply('⏱️ *Slow mode* — ✅ Activé (30s par défaut)\n\n💡 Ajuste avec: `.slowmode medium` ou `.slowmode 45s`\n\n> _Nebula Bot by Dark Neon_');
        } else if (!newValue) {
          updateGroupSettings(from, { slowmode: 0 });
          return reply('⏱️ *Slow mode* — ❌ Désactivé\n\n> _Nebula Bot by Dark Neon_');
        } else {
          return reply(`⏱️ *Slow mode* déjà actif (${currentSlow}s)\n\n💡 Modifie avec: \`.slowmode high\` ou \`.slowmode off\``);
        }
      }

      updateGroupSettings(from, { [feature]: newValue });

      const { emoji, label, note } = FEATURES[feature];
      const noteLine = note ? '\n💡 ' + note : '';
      await reply(
        emoji + ' *' + label + '* — ' + (newValue ? '✅ Activé' : '❌ Désactivé') +
        noteLine + '\n\n' +
        '> _Nebula Bot by Dark Neon_'
      );

    } catch (error) {
      console.error('[Settings Error]:', error);
      await extra.reply('❌ Error: ' + error.message);
    }
  }
};
