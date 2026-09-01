import { BotCommand } from "../types.js";

const roasts = [
  (t: string) => `${t}, your face makes onions cry. 🧅`,
  (t: string) => `${t}, you're the reason they put instructions on shampoo bottles. 🧴`,
  (t: string) => `${t}, if you were an spice, you'd be flour. 🌾`,
  (t: string) => `${t}, you are like a cloud. When you disappear, it's a beautiful day. ☀️`,
  (t: string) => `${t}, I'd agree with you but then we'd both be wrong. 🤷`,
  (t: string) => `${t}, your secrets are safe with me. I don't even listen to you. 🤫`,
  (t: string) => `${t}, you bring everyone so much joy... when you leave the room. 🚪`,
  (t: string) => `${t}, your Wi-Fi signal is stronger than your personality. 📶`,
  (t: string) => `${t}, you look like a "before" picture. 📸`,
  (t: string) => `${t}, I have neither the time nor the crayons to explain this to you. 🖍️`,
  (t: string) => `${t}, your morning energy looks like a phone on 3% battery. 🔋`,
  (t: string) => `${t}, you're the reason the "Mute" button was invented. 🔇`,
  (t: string) => `${t}, you're so quiet even your cat adopted you out of pity. 🐱`
];

const roastCommand: BotCommand = {
  name: "roast",
  category: "Fun & Games",
  description: "Playfully and lightheartedly roast someone.",
  usage: "roast <@mention or name> | roast me",
  execute: async (sock, msg, context) => {
    await context.react("🔥");
    const args = context.args || [];
    
    if (!args.length) {
      return context.reply(
        `🔥 *Nebula Roast*\n\n` +
        `Usage:\n` +
        `  \`.roast me\` - Get roasted yourself\n` +
        `  \`.roast <name>\` - Roast someone else\n` +
        `  \`.roast @mention\` - Roast a group member\n\n` +
        `_⚠️ Played for light humor only!_`
      );
    }

    let target = args.join(" ").trim();
    let targetName = target;

    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (target.toLowerCase() === "me" || target.toLowerCase() === "moi") {
      targetName = context.senderName || "you";
    } else if (mentionedJid) {
      targetName = mentionedJid.split("@")[0];
    }

    targetName = targetName.replace(/@\d+/g, "").trim() || "someone";

    const roastFn = roasts[Math.floor(Math.random() * roasts.length)];
    const roastText = roastFn(targetName);

    await sock.sendMessage(msg.key.remoteJid, {
      text: `🔥 *Nebula Roast*\n\n${roastText}\n\n_⚠️ Just friendly humor, don't take it personally!_`,
      mentions: mentionedJid ? [mentionedJid] : []
    }, { quoted: msg });
  }
};

export default roastCommand;
