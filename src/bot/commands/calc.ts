import { BotCommand } from "../types.js";

const calcCommand: BotCommand = {
  name: "calc",
  category: "Utilities",
  description: "Calculate standard mathematical expressions safely.",
  usage: "calc <expression>",
  execute: async (sock, msg, context) => {
    await context.react("🧮");
    const args = context.args || [];

    if (args.length === 0) {
      return context.reply("❌ Usage: \`.calc <expression>\`\n\nExample: \`.calc 5 + 3 * 2\` or \`.calc (10 - 2) / 4\`");
    }

    const expression = args.join(" ");

    // Basic regex check to allow ONLY numbers, standard arithmetic operations, and decimals/parentheses
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return context.reply("❌ Invalid expression! Only numbers and operators (+, -, *, /, parentheses) are allowed.");
    }

    try {
      // Safely evaluate using Function constructor restricting any global leaks
      const computeResult = new Function(`return (${expression})`);
      const result = computeResult();

      if (typeof result !== "number" || !Number.isFinite(result)) {
        return context.reply("❌ The expression does not produce a finite number (e.g. division by zero).");
      }

      let text = `🧮 *Nebula Calculator*\n\n`;
      text += `📝 *Expression:* \`${expression}\`\n`;
      text += `✅ *Result:* \`${result}\``;

      await context.reply(text);
    } catch (evalError) {
      await context.reply("❌ Invalid mathematical expression!");
    }
  }
};

export default calcCommand;
