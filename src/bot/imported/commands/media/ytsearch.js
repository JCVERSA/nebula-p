/**
 * YouTube Search Command — Nebula Bot by Dark Neon
 * Utilise yt-search (fiable, pas de clé API requise)
 */

const yts = require('yt-search');

module.exports = {
  name: 'ytsearch',
  aliases: ['yt', 'youtube', 'recherche'],
  category: 'media',
  description: 'Rechercher des vidéos YouTube',
  usage: '.ytsearch <recherche>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length) {
        return extra.reply(
          `🎬 *YouTube Search*\n\n` +
          `Usage : *.ytsearch <titre ou artiste>*\n\n` +
          `Ex : *.ytsearch Burna Boy African Giant*\n\n` +
          `💡 Pour télécharger :\n` +
          `  *.song <nom>* — audio MP3\n` +
          `  *.video <nom>* — vidéo MP4`
        );
      }

      const query = args.join(' ');
      await extra.reply(`🔍 Recherche *"${query}"* sur YouTube...`);

      const result = await yts(query);
      const videos = (result?.videos || []).slice(0, 5);

      if (!videos.length) {
        return extra.reply(`❌ Aucun résultat pour *"${query}"*`);
      }

      const lines = videos.map((v, i) => {
        let line = `*${i + 1}.* ${v.title}\n    🔗 ${v.url}`;
        if (v.author?.name) line += `\n    📺 ${v.author.name}`;
        if (v.timestamp)    line += ` • ⏱ ${v.timestamp}`;
        if (v.views)        line += `\n    👁 ${v.views.toLocaleString()} vues`;
        return line;
      });

      await extra.reply(
        `🎬 *Résultats YouTube — "${query}"*\n` +
        `${'─'.repeat(30)}\n\n` +
        lines.join('\n\n') +
        `\n\n_Utilise .song ou .video pour télécharger_`
      );

    } catch (err) {
      console.error('[YTSEARCH] Error:', err.message);
      await extra.reply(`❌ Erreur lors de la recherche: ${err.message}`);
    }
  }
};
