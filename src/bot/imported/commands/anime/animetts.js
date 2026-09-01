/**
 * Anime Voice TTS Command — Nebula Bot by Dark Neon
 * Uses VoiceVox Engine (JP) + gTTS fallback for anime-style voices
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Available anime-style voices via StreamElements TTS
// These are real voices with anime-ish characteristics
const VOICES = {
  // Japanese voices (most anime-like)
  'sakura':  { id: 'ja-JP-NanamiNeural',    lang: 'ja', label: '🌸 Sakura (JP Girl)' },
  'kenji':   { id: 'ja-JP-KeitaNeural',     lang: 'ja', label: '⚔️ Kenji (JP Boy)' },
  // English anime-style voices
  'aria':    { id: 'en-US-AriaNeural',       lang: 'en', label: '✨ Aria (EN Girl)' },
  'guy':     { id: 'en-US-GuyNeural',        lang: 'en', label: '🗡️ Guy (EN Boy)' },
  'jenny':   { id: 'en-US-JennyNeural',      lang: 'en', label: '💫 Jenny (Cute)' },
  'sonia':   { id: 'en-GB-SoniaNeural',      lang: 'en', label: '👑 Sonia (UK Girl)' },
  // French voices
  'yuki':    { id: 'fr-FR-DeniseNeural',     lang: 'fr', label: '❄️ Yuki (FR Girl)' },
  'ryu':     { id: 'fr-FR-HenriNeural',      lang: 'fr', label: '🔥 Ryu (FR Boy)' },
};

const VOICE_LIST = Object.entries(VOICES)
  .map(([name, v]) => `${v.label} → *.animetts ${name} <text>*`)
  .join('\n');

async function fetchTTS(text, voice) {
  // Using StreamElements TTS API (free, no key)
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${voice.id}&text=${encodeURIComponent(text)}`;

  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `animetts_${Date.now()}.mp3`);
    const file = fs.createWriteStream(tmpFile);

    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tmpFile);
      });
    }).on('error', reject);
  });
}

module.exports = {
  name: 'animetts',
  aliases: ['atts', 'animevoice', 'anivoice'],
  category: 'anime',
  description: 'Text-to-Speech with anime-style voices',
  usage: '.animetts <voice> <text>\nExample: .animetts sakura Ohayou gozaimasu!',

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          `🎙️ *Anime TTS — Available Voices*\n\n` +
          `${VOICE_LIST}\n\n` +
          `📝 *Usage:* .animetts <voice> <text>\n` +
          `📌 *Example:* .animetts sakura Ohayou gozaimasu!`
        );
      }

      const voiceName = args[0].toLowerCase();
      const voice = VOICES[voiceName];

      if (!voice) {
        const names = Object.keys(VOICES).join(', ');
        return extra.reply(`❌ Unknown voice! Available: ${names}\n\nUse *.animetts* alone to see all voices.`);
      }

      const text = args.slice(1).join(' ').trim();
      if (!text) {
        return extra.reply(`🎙️ Please provide text!\nExample: .animetts ${voiceName} Hello everyone!`);
      }

      if (text.length > 200) {
        return extra.reply('❌ Text too long! Maximum 200 characters.');
      }

      await extra.reply(`🎙️ Generating voice with *${voice.label}*...`);

      const tmpFile = await fetchTTS(text, voice);
      const audioBuffer = fs.readFileSync(tmpFile);

      // Cleanup
      try { fs.unlinkSync(tmpFile); } catch {}

      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Empty audio buffer received');
      }

      await sock.sendMessage(extra.from, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true, // Send as voice note
        fileName: `animetts_${voiceName}.mp3`
      }, { quoted: msg });

      // Small caption message after voice note
      await extra.reply(`${voice.label}\n_"${text}"_\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`);

    } catch (error) {
      console.error('[ANIMETTS] Error:', error.message);
      await extra.reply(
        `❌ Failed to generate voice.\n\n` +
        `💡 *Try:*\n` +
        `• Check your text has no special characters\n` +
        `• Keep text under 200 chars\n` +
        `• Use *.animetts* to see available voices`
      );
    }
  }
};
