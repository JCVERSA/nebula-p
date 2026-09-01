// Nebula Bot by Dark Neon
/**
 * YTLink Command - Search YouTube and get links
 * Uses yt-search package (already installed)
 */

const yts = require('yt-search');

module.exports = {
  name: 'ytlink',
  aliases: ['ytsearch', 'yts', 'youtubelink'],
  category: 'media',
  description: 'Search and get YouTube links for a song or video',
  usage: '.ytlink <song or video name>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          '🎵 *YouTube Link Search*\n\n' +
          'Usage: .ytlink <song or video name>\n\n' +
          'Examples:\n' +
          '  .ytlink Bohemian Rhapsody Queen\n' +
          '  .ytlink lofi hip hop chill'
        );
      }

      const query = args.join(' ');
      await extra.reply('🔍 Searching YouTube...');

      const result = await yts(query);
      const videos = result.videos.slice(0, 3);

      if (!videos || videos.length === 0) {
        return extra.reply('❌ No results found! Try a different search term.');
      }

      let text = `🎵 *YouTube Search Results*\n\nQuery: _${query}_\n\n`;

      videos.forEach((v, i) => {
        text += `${i + 1}. *${v.title}*\n`;
        text += `   👤 ${v.author.name}\n`;
        text += `   ⏱️ ${v.timestamp} | 👁️ ${v.views.toLocaleString()} views\n`;
        text += `   🔗 ${v.url}\n\n`;
      });

      await extra.reply(text.trim());

    } catch (error) {
      console.error('[YTLink Error]:', error);
      await extra.reply('❌ Failed to search YouTube. Please try again.');
    }
  }
};
