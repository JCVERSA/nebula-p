// Nebula Bot by Dark Neon
/**
 * Calc Command - Calculator
 */

module.exports = {
  name: 'calc',
  aliases: ['calculate', 'math'],
  category: 'user',
  description: 'Calculate a mathematical expression',
  usage: '.calc <expression>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          '🧮 *Calculator*\n\n' +
          'Usage: .calc <expression>\n\n' +
          'Examples:\n' +
          '  .calc 2 + 2\n' +
          '  .calc 10 * 5\n' +
          '  .calc 100 / 4\n' +
          '  .calc 2 ** 10\n' +
          '  .calc (5 + 3) * 2'
        );
      }

      const expression = args.join(' ');

      // Security: only allow safe math characters
      if (/[^0-9+\-*/().\s%^]/.test(expression.replace(/\*\*/g, ''))) {
        return extra.reply('❌ Invalid expression! Only numbers and operators (+, -, *, /, **, %) are allowed.');
      }

      // Replace ^ with ** for power
      const sanitized = expression.replace(/\^/g, '**');

      const result = Function(`"use strict"; return (${sanitized})`)();

      if (typeof result !== 'number' || !isFinite(result)) {
        return extra.reply('❌ Invalid calculation result!');
      }

      await extra.reply(`🧮 *Calculator*\n\n📥 Expression: \`${expression}\`\n📤 Result: *${result}*`);

    } catch (error) {
      await extra.reply('❌ Invalid expression! Please check your calculation.');
    }
  }
};
