/**
 * RPS Command — Pierre Feuille Ciseaux avec mise de coins
 * Nebula Bot by Dark Neon
 */

const eco = require('../../utils/economy');

const CHOICES = {
  pierre:   { emoji: '🪨', beats: 'ciseaux' },
  feuille:  { emoji: '📄', beats: 'pierre'  },
  ciseaux:  { emoji: '✂️',  beats: 'feuille' },
  p:        { emoji: '🪨', beats: 'ciseaux', alias: 'pierre'  },
  f:        { emoji: '📄', beats: 'pierre',  alias: 'feuille' },
  c:        { emoji: '✂️',  beats: 'feuille', alias: 'ciseaux' },
  rock:     { emoji: '🪨', beats: 'ciseaux', alias: 'pierre'  },
  paper:    { emoji: '📄', beats: 'pierre',  alias: 'feuille' },
  scissors: { emoji: '✂️',  beats: 'feuille', alias: 'ciseaux' },
};

const BOT_CHOICES = ['pierre', 'feuille', 'ciseaux'];

module.exports = {
  name: 'rps',
  aliases: ['pfc', 'chifoumi', 'rockpaperscissors'],
  category: 'fun',
  description: 'Pierre Feuille Ciseaux — mise des coins!',
  usage: '.rps <pierre|feuille|ciseaux> [mise]',

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          `🎮 *Pierre Feuille Ciseaux*\n\n` +
          `Usage : *.rps <choix> [mise]*\n\n` +
          `Choix : pierre (p), feuille (f), ciseaux (c)\n` +
          `Ex : *.rps pierre 100*\n` +
          `Ex : *.rps p* (sans mise)`
        );
      }

      const playerChoice = CHOICES[args[0].toLowerCase()];
      if (!playerChoice) {
        return extra.reply('❌ Choix invalide! Utilise: *pierre*, *feuille* ou *ciseaux*');
      }

      const playerKey  = playerChoice.alias || args[0].toLowerCase();
      const betAmount  = parseInt(args[1]) || 0;

      // Vérifier la mise
      if (betAmount > 0) {
        const user = eco.getUser(extra.sender);
        if (user.coins < betAmount) {
          return extra.reply(`❌ Solde insuffisant! Tu as *${user.coins.toLocaleString()} 🪙*`);
        }
        if (betAmount > 10000) {
          return extra.reply('❌ Mise maximum : *10,000 🪙*');
        }
      }

      // Choix du bot
      const botKey    = BOT_CHOICES[Math.floor(Math.random() * 3)];
      const botChoice = CHOICES[botKey];

      let result, resultEmoji, coinsChange = 0;

      if (playerKey === botKey) {
        result      = 'ÉGALITÉ';
        resultEmoji = '🤝';
      } else if (playerChoice.beats === botKey) {
        result      = 'VICTOIRE';
        resultEmoji = '🏆';
        coinsChange = betAmount;
      } else {
        result      = 'DÉFAITE';
        resultEmoji = '💀';
        coinsChange = -betAmount;
      }

      // Appliquer la mise
      let balanceText = '';
      if (betAmount > 0) {
        if (coinsChange > 0) {
          eco.addCoins(extra.sender, coinsChange);
          balanceText = `\n💰 Tu gagnes *+${coinsChange} 🪙*`;
        } else if (coinsChange < 0) {
          eco.removeCoins(extra.sender, betAmount);
          balanceText = `\n💸 Tu perds *-${betAmount} 🪙*`;
        } else {
          balanceText = '\n🤝 Mise remboursée';
        }
        const user  = eco.getUser(extra.sender);
        balanceText += `\n💳 Solde : *${user.coins.toLocaleString()} 🪙*`;
      }

      if (result === 'VICTOIRE') eco.addXP(extra.sender, 5);

      await extra.reply(
        `${resultEmoji} *${result} !*\n\n` +
        `👤 Toi : ${playerChoice.emoji} *${playerKey}*\n` +
        `🤖 Bot : ${botChoice.emoji} *${botKey}*\n` +
        balanceText
      );

    } catch (err) {
      await extra.reply(`❌ Erreur: ${err.message}`);
    }
  }
};
