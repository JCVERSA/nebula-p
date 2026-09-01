/**
 * TTS - Text to Speech Command — Nebula Bot by Dark Neon
 * Fix: APIs.textToSpeech retourne un Buffer, pas une URL
 */

const APIs = require('../../utils/api');

module.exports = {
  name: 'tts',
  aliases: ['speak', 'say'],
  category: 'general',
  description: 'Convert text to speech',
  usage: '.tts <text>',

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      const text = args.join(' ');

      if (!text) {
        return extra.reply('🔊 Usage: .tts <text>\nExample: .tts hi how are you');
      }

      if (text.length > 300) {
        return extra.reply('❌ Text too long! Max 300 characters.');
      }

      // APIs.textToSpeech retourne directement un Buffer
      const audioBuffer = await APIs.textToSpeech(text);

      await sock.sendMessage(chatId, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true
      }, { quoted: msg });

    } catch (error) {
      console.error('[TTS] Error:', error.message);
      await extra.reply(`❌ Failed to generate speech: ${error.message}`);
    }
  }
};
