import { BotCommand } from "../types.js";

const quotes = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { text: "What you get by achieving your goals is not as important as what you become by achieving your goals.", author: "Zig Ziglar" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" }
];

const quoteCommand: BotCommand = {
  name: "quote",
  category: "Fun & Games",
  description: "Get an inspiring daily motivational quote.",
  usage: "quote",
  execute: async (sock, msg, context) => {
    await context.react("💡");
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    await context.reply(`💡 *Nebula Wisdom*\n\n"${quote.text}"\n\n— *${quote.author}*`);
  }
};

export default quoteCommand;
