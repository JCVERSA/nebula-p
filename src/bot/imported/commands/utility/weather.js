/**
 * Weather Command — Nebula Bot by Dark Neon
 * Fix: clé API déplacée dans config, réponse enrichie, fallback wttr.in
 */

const axios = require('axios');
const config = require('../../config');

const WEATHER_EMOJIS = {
  'clear sky': '☀️', 'few clouds': '🌤️', 'scattered clouds': '⛅',
  'broken clouds': '☁️', 'overcast clouds': '☁️',
  'shower rain': '🌧️', 'rain': '🌧️', 'light rain': '🌦️',
  'thunderstorm': '⛈️', 'snow': '❄️', 'mist': '🌫️', 'fog': '🌫️'
};

function getEmoji(description) {
  const desc = description?.toLowerCase() || '';
  for (const [key, emoji] of Object.entries(WEATHER_EMOJIS)) {
    if (desc.includes(key)) return emoji;
  }
  return '🌡️';
}

module.exports = {
  name: 'weather',
  aliases: ['meteo', 'météo', 'clima'],
  category: 'utility',
  description: 'Météo d\'une ville',
  usage: '.weather <ville>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length) {
        return await sock.sendMessage(msg.key.remoteJid, {
          text: '❌ Usage: .weather <ville>\n\nEx: .weather Douala\nEx: .weather Paris'
        }, { quoted: msg });
      }

      const city = args.join(' ');

      // ── OpenWeatherMap (clé dans config ou env) ───────────────────────────
      const apiKey = config.apiKeys?.openweather || process.env.OPENWEATHER_KEY || '4902c0f2550f58298ad4146a92b65e10';

      let weatherText = null;

      try {
        const res = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
          params: { q: city, appid: apiKey, units: 'metric', lang: 'fr' },
          timeout: 10000
        });
        const d = res.data;
        const emoji = getEmoji(d.weather[0]?.description);
        const desc = d.weather[0]?.description || '';
        const capitalDesc = desc.charAt(0).toUpperCase() + desc.slice(1);

        weatherText =
          `${emoji} *Météo — ${d.name}, ${d.sys?.country || ''}*\n\n` +
          `🌡️ Température: *${Math.round(d.main.temp)}°C* (ressenti ${Math.round(d.main.feels_like)}°C)\n` +
          `📉 Min: ${Math.round(d.main.temp_min)}°C | 📈 Max: ${Math.round(d.main.temp_max)}°C\n` +
          `💧 Humidité: ${d.main.humidity}%\n` +
          `💨 Vent: ${Math.round((d.wind?.speed || 0) * 3.6)} km/h\n` +
          `☁️ ${capitalDesc}\n` +
          `👁️ Visibilité: ${((d.visibility || 0) / 1000).toFixed(1)} km\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;
      } catch (e) {
        // Si 401 (clé invalide) ou autre erreur → fallback wttr.in (aucune clé requise)
        console.log('[WEATHER] OpenWeatherMap failed, trying wttr.in:', e.message);
        try {
          const res = await axios.get(
            `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
            { timeout: 10000 }
          );
          const cur = res.data?.current_condition?.[0];
          const area = res.data?.nearest_area?.[0];
          if (!cur) throw new Error('wttr: no data');

          const cityName = area?.areaName?.[0]?.value || city;
          const country = area?.country?.[0]?.value || '';

          weatherText =
            `🌡️ *Météo — ${cityName}${country ? ', ' + country : ''}*\n\n` +
            `🌡️ Température: *${cur.temp_C}°C* (ressenti ${cur.FeelsLikeC}°C)\n` +
            `💧 Humidité: ${cur.humidity}%\n` +
            `💨 Vent: ${cur.windspeedKmph} km/h\n` +
            `☁️ ${cur.weatherDesc?.[0]?.value || ''}\n` +
            `👁️ Visibilité: ${cur.visibility} km\n\n` +
            `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;
        } catch (e2) {
          return await sock.sendMessage(msg.key.remoteJid, {
            text: `❌ Impossible d'obtenir la météo pour *"${city}"*.\nVérifie le nom de la ville.`
          }, { quoted: msg });
        }
      }

      await sock.sendMessage(msg.key.remoteJid, { text: weatherText }, { quoted: msg });

    } catch (error) {
      console.error('[WEATHER] Error:', error.message);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Erreur météo. Réessaie.'
      }, { quoted: msg });
    }
  }
};
