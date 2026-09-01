import { BotCommand } from "../types.js";

const truths = [
  "What is your biggest secret that nobody in this chat knows?",
  "What is the most embarrassing thing you've ever done in public?",
  "Who is your current secret crush?",
  "Have you ever lied to get out of a date or meeting with a friend?",
  "What is the most useless thing you've ever spent money on?",
  "What was the last thing you searched on your phone's private browser?",
  "Have you ever read someone else's text messages without permission?",
  "What is your worst habit that you try to hide from people?",
  "If you could trade lives with anyone in this chat for one day, who would it be and why?",
  "What is the biggest lie you've ever told your parents?",
  "What is the most childish thing you still do?",
  "If you won the lottery tomorrow, what is the first thing you would buy?",
  "Have you ever blamed a sibling or friend for something you did?",
  "What is your biggest fear or phobia?",
  "What is the strangest food combination you secretly enjoy?",
  "If you could only eat one meal for the rest of your life, what would it be?",
  "What is the most embarrassing song or artist on your playlist?"
];

const truthCommand: BotCommand = {
  name: "truth",
  category: "Fun & Games",
  description: "Get a random truth question.",
  usage: "truth",
  execute: async (sock, msg, context) => {
    await context.react("🕵️");
    const randomTruth = truths[Math.floor(Math.random() * truths.length)];
    await context.reply(`🕵️ *Nebula Truth Question*\n\n"${randomTruth}"\n\n_Answer honestly! No lies allowed!_`);
  }
};

export default truthCommand;
