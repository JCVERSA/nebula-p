import { BotCommand } from "../types.js";

// Active Trivia Sessions: Map<sender, { correctAnswer: string, options: string[], timeout: NodeJS.Timeout }>
const activeSessions = new Map<string, { correctAnswer: string; options: string[]; timeout: any }>();

function decodeHtml(str: string): string {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&ecirc;/g, "ê")
    .replace(/&agrave;/g, "à")
    .replace(/&ccedil;/g, "ç")
    .replace(/&ocirc;/g, "ô")
    .replace(/&uuml;/g, "ü")
    .replace(/&ouml;/g, "ö")
    .replace(/&auml;/g, "ä")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const triviaCommand: BotCommand = {
  name: "trivia",
  category: "Fun & Games",
  description: "Play an interactive trivia quiz game. Respond with .trivia a/b/c/d.",
  usage: "trivia",
  execute: async (sock, msg, context) => {
    await context.react("🧠");
    const args = context.args || [];
    const arg = (args[0] || "").toLowerCase();

    // Check if player has an active session and is answering
    if (activeSessions.has(context.sender) && ["a", "b", "c", "d"].includes(arg)) {
      const session = activeSessions.get(context.sender)!;
      clearTimeout(session.timeout);
      activeSessions.delete(context.sender);

      const answerIdx = { a: 0, b: 1, c: 2, d: 3 }[arg as "a" | "b" | "c" | "d"];
      const chosen = session.options[answerIdx];
      const correct = chosen === session.correctAnswer;

      if (correct) {
        return context.reply(`✅ *CORRECT ANSWER!* 🎉\n\nFantastic job! You answered *"${session.correctAnswer}"* correctly.`);
      } else {
        return context.reply(`❌ *INCORRECT ANSWER!*\n\nBetter luck next time! The correct answer was: *"${session.correctAnswer}"*`);
      }
    }

    if (activeSessions.has(context.sender)) {
      return context.reply("❓ You already have a quiz active! Answer using \`.trivia a\`, \`.trivia b\`, \`.trivia c\`, or \`.trivia d\`.");
    }

    try {
      const url = "https://opentdb.com/api.php?amount=1&type=multiple";
      const res = await fetch(url);
      const data = await res.json();
      const q = data?.results?.[0];

      if (!q) {
        return context.reply("❌ Unable to fetch trivia questions at the moment. Please try again later.");
      }

      const correctAnswer = decodeHtml(q.correct_answer);
      const allOptions = shuffle([...q.incorrect_answers.map(decodeHtml), correctAnswer]);
      const letters = ["A", "B", "C", "D"];

      // Start 30 seconds timer
      const timeout = setTimeout(async () => {
        activeSessions.delete(context.sender);
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: `⏰ *Time's up!* You ran out of time.\n\nThe correct answer was: *"${correctAnswer}"*`
          }, { quoted: msg });
        } catch {}
      }, 30000);

      activeSessions.set(context.sender, { correctAnswer, options: allOptions, timeout });

      const optionsText = allOptions.map((opt, i) => `*${letters[i]}.* ${opt}`).join("\n");

      await context.reply(
        `🧠 *NEBULA TRIVIA QUIZ* — _${decodeHtml(q.category)}_\n` +
        `*Difficulty:* \`${q.difficulty.toUpperCase()}\`\n\n` +
        `❓ *Question:* ${decodeHtml(q.question)}\n\n` +
        `${optionsText}\n\n` +
        `⏳ _You have 30 seconds to reply with:_ \`.trivia a/b/c/d\``
      );
    } catch (error: any) {
      console.error("[TRIVIA] Error:", error.message || error);
      await context.reply("❌ Error fetching the quiz. Please try again.");
    }
  }
};

export default triviaCommand;
