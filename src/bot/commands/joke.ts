import { BotCommand } from "../types.js";

const jokes = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "Why did the scarecrow win an award? Because he was outstanding in his field!",
  "Why don't skeletons fight each other? They don't have the guts.",
  "I told my doctor that I broke my arm in two places. He told me to stop going to those places.",
  "Why did the bicycle fall over? Because it was two tired!",
  "What do you call a fake noodle? An impasta!",
  "How does a penguin build its house? Igloos it together!",
  "Why did the math book look sad? Because it had too many problems."
];

const jokeCommand: BotCommand = {
  name: "joke",
  category: "Fun & Games",
  description: "Get a random, hilarious joke.",
  usage: "joke",
  execute: async (sock, msg, context) => {
    await context.react("🤡");
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    await context.reply(`🤪 *Nebula Chuckles*\n\n"${joke}"`);
  }
};

export default jokeCommand;
