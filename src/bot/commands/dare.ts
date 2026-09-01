import { BotCommand } from "../types.js";

const dares = [
  "Send a screenshot of your phone's home screen!",
  "Let someone else write a funny status for your WhatsApp!",
  "Call a random contact and sing them a song!",
  "Post an embarrassing selfie to your status!",
  "Text your crush and confess your feelings, or send a screenshot of your inbox!",
  "Do 20 pushups and send a voice note counting them!",
  "Change your profile picture to an anime character for 24 hours!",
  "Send a voice note singing the alphabet backwards!",
  "Let the group choose your chat wallpaper or profile status for a day!",
  "Tell the group your most embarrassing childhood moment!",
  "Share your last 5 Google searches!",
  "Do your best impression of a robot or an animal in a 10-second voice note!",
  "Speak in a formal Shakespearean accent in the next 3 messages!",
  "Post a status saying 'I lost a bet to Nebula Bot' for 12 hours!",
  "Send a flirty message to the 5th person in your recent chats!",
  "Do 50 jumping jacks and send a voice note of your heavy breathing!",
  "Tell a joke—if no one laughs, you have to do another dare!",
  "Record yourself saying 'Nebula is the greatest AI assistant ever' with dramatic emotion!"
];

const dareCommand: BotCommand = {
  name: "dare",
  category: "Fun & Games",
  description: "Get a random, exciting dare challenge.",
  usage: "dare",
  execute: async (sock, msg, context) => {
    await context.react("😈");
    const randomDare = dares[Math.floor(Math.random() * dares.length)];
    await context.reply(`😈 *Nebula Dare Challenge*\n\n"${randomDare}"\n\n_Show some courage and complete the challenge!_`);
  }
};

export default dareCommand;
