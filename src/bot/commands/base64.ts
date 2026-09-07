import { BotCommand } from "../types.js";

/**
 * `.base64` — portage natif de l'original neb (utility/base64.js, owner
 * request 8.59) : actions encode/decode/hex/fromhex/binary/frombinary/url/
 * fromurl/rot13, zéro dépendance. Fidèle à l'original.
 */

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, c => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const HELP_TEXT =
  "🔐 *Encodeur / Décodeur*\n\n" +
  "*Usage:* `.base64 <action> <texte>`\n\n" +
  "Actions:\n" +
  "  • `encode` — texte → Base64\n" +
  "  • `decode` — Base64 → texte\n" +
  "  • `hex` — texte → hexadécimal\n" +
  "  • `fromhex` — hexadécimal → texte\n" +
  "  • `binary` — texte → binaire\n" +
  "  • `frombinary` — binaire → texte\n" +
  "  • `url` — texte → encodage URL\n" +
  "  • `fromurl` — encodage URL → texte\n" +
  "  • `rot13` — chiffre César\n\n" +
  "Ex: `.base64 encode Bonjour`";

const base64Command: BotCommand = {
  name: "base64",
  aliases: ["b64"],
  category: "Outils",
  description: "Encoder / décoder du texte (Base64, hex, binaire, URL, rot13).",
  usage: ".base64 <action> <texte>",
  execute: async (_sock, _msg, context) => {
    try {
      const args = context.args || [];
      const action = (args[0] || "").toLowerCase();
      const text = args.slice(1).join(" ");

      if (!action || !text) return void (await context.reply(HELP_TEXT));

      let result: string;

      switch (action) {
        case "encode":
          result = Buffer.from(text, "utf8").toString("base64");
          break;
        case "decode": {
          const cleaned = text.replace(/\s/g, "");
          result = Buffer.from(cleaned, "base64").toString("utf8");
          break;
        }
        case "hex":
          result = Buffer.from(text, "utf8").toString("hex").match(/.{1,2}/g)!.join(" ");
          break;
        case "fromhex": {
          const hexClean = text.replace(/\s/g, "");
          result = Buffer.from(hexClean, "hex").toString("utf8");
          break;
        }
        case "binary":
          result = text.split("").map(c => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ");
          break;
        case "frombinary": {
          const binParts = text.trim().split(/\s+/);
          result = binParts.map(b => String.fromCharCode(parseInt(b, 2))).join("");
          break;
        }
        case "url":
          result = encodeURIComponent(text);
          break;
        case "fromurl":
          result = decodeURIComponent(text);
          break;
        case "rot13":
          result = rot13(text);
          break;
        default:
          return void (await context.reply(`❌ Action inconnue : *${action}*\n\n${HELP_TEXT}`));
      }

      await context.reply(`✅ *Résultat (${action}) :*\n\n\`\`\`\n${result}\n\`\`\``);
    } catch {
      await context.reply("❌ Impossible de convertir ce texte — vérifie le format d'entrée.");
    }
  }
};

export default base64Command;
