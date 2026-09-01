import { BotCommand } from "../types.js";

const WEATHER_EMOJIS: { [key: string]: string } = {
  "clear sky": "☀️", "few clouds": "🌤️", "scattered clouds": "⛅",
  "broken clouds": "☁️", "overcast clouds": "☁️",
  "shower rain": "🌧️", "rain": "🌧️", "light rain": "🌦️",
  "thunderstorm": "⛈️", "snow": "❄️", "mist": "🌫️", "fog": "🌫️"
};

function getEmoji(description: string): string {
  const desc = description?.toLowerCase() || "";
  for (const [key, emoji] of Object.entries(WEATHER_EMOJIS)) {
    if (desc.includes(key)) return emoji;
  }
  return "🌡️";
}

const weatherCommand: BotCommand = {
  name: "weather",
  category: "Utilities",
  description: "Get real-time weather details of a city.",
  usage: "weather <city>",
  execute: async (sock, msg, context) => {
    await context.react("🌤️");
    const args = context.args || [];

    if (!args.length) {
      return context.reply("❌ Usage: \`.weather <city>\`\n\nExample: \`.weather Paris\` or \`.weather New York\`");
    }

    const city = args.join(" ").trim();

    try {
      // Fetch directly from open API wttr.in with JSON format
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      
      if (!res.ok) {
        throw new Error("Failed to contact wttr.in services");
      }

      const data = await res.json();
      const cur = data?.current_condition?.[0];
      const area = data?.nearest_area?.[0];

      if (!cur) {
        return context.reply(`❌ Weather information not found for *"${city}"*.\nPlease check the city spelling.`);
      }

      const cityName = area?.areaName?.[0]?.value || city;
      const country = area?.country?.[0]?.value || "";
      const weatherDesc = cur.weatherDesc?.[0]?.value || "";
      const emoji = getEmoji(weatherDesc);

      const weatherText =
        `${emoji} *Weather Report — ${cityName}${country ? ", " : ""}${country}*\n\n` +
        `🌡️ *Temperature:* \`${cur.temp_C}°C\` (Feels like \`${cur.FeelsLikeC}°C\`)\n` +
        `💧 *Humidity:* \`${cur.humidity}%\`\n` +
        `💨 *Wind Speed:* \`${cur.windspeedKmph} km/h\`\n` +
        `☁️ *Sky Condition:* \`${weatherDesc}\`\n` +
        `👁️ *Visibility:* \`${cur.visibility} km\`\n\n` +
        `> 🌌 _Powered by Nebula Engine_`;

      await context.reply(weatherText);
    } catch (error: any) {
      console.error("[WEATHER] Error:", error.message || error);
      await context.reply(`❌ Error: Unable to fetch weather data for *"${city}"*.`);
    }
  }
};

export default weatherCommand;
