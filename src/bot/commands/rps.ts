import { BotCommand } from "../types.js";

interface RPSChoice {
  emoji: string;
  beats: string;
  alias?: string;
}

const CHOICES: { [key: string]: RPSChoice } = {
  rock:     { emoji: "🪨", beats: "scissors" },
  paper:    { emoji: "📄", beats: "rock" },
  scissors: { emoji: "✂️",  beats: "paper" },
  r:        { emoji: "🪨", beats: "scissors", alias: "rock" },
  p:        { emoji: "📄", beats: "rock",  alias: "paper" },
  s:        { emoji: "✂️",  beats: "paper", alias: "scissors" },
  pierre:   { emoji: "🪨", beats: "scissors", alias: "rock" },
  feuille:  { emoji: "📄", beats: "rock",  alias: "paper" },
  ciseaux:  { emoji: "✂️",  beats: "paper", alias: "scissors" }
};

const BOT_CHOICES = ["rock", "paper", "scissors"];

const rpsCommand: BotCommand = {
  name: "rps",
  category: "Fun & Games",
  description: "Play Rock-Paper-Scissors (Pierre-Feuille-Ciseaux) against Nebula Bot.",
  usage: "rps <rock|paper|scissors>",
  execute: async (sock, msg, context) => {
    await context.react("🎮");
    const args = context.args || [];

    if (!args[0]) {
      return context.reply(
        `🎮 *Rock, Paper, Scissors (RPS)*\n\n` +
        `Usage: \`.rps <your choice>\`\n` +
        `Options: \`rock\` (r), \`paper\` (p), \`scissors\` (s)\n\n` +
        `Example: \`.rps rock\``
      );
    }

    const inputChoice = args[0].toLowerCase();
    const playerChoice = CHOICES[inputChoice];

    if (!playerChoice) {
      return context.reply("❌ Invalid choice! Use \`rock\`, \`paper\`, or \`scissors\`.");
    }

    const playerKey = playerChoice.alias || inputChoice;

    // Get random bot choice
    const botKey = BOT_CHOICES[Math.floor(Math.random() * 3)];
    const botChoice = CHOICES[botKey];

    let result = "";
    let resultEmoji = "";

    if (playerKey === botKey) {
      result = "IT'S A DRAW";
      resultEmoji = "🤝";
    } else if (playerChoice.beats === botKey) {
      result = "YOU WIN";
      resultEmoji = "🏆";
    } else {
      result = "YOU LOSE";
      resultEmoji = "💀";
    }

    await context.reply(
      `${resultEmoji} *${result}!*\n\n` +
      `👤 *You chose:* ${playerChoice.emoji} _${playerKey}_\n` +
      `🤖 *Bot chose:* ${botChoice.emoji} _${botKey}_`
    );
  }
};

export default rpsCommand;
