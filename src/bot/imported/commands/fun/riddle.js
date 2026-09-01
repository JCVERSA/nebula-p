/**
 * Riddle Command — Devinettes interactives avec gain de coins
 * Nebula Bot by Dark Neon
 */

const eco = require('../../utils/economy');

const RIDDLES = [
  { q: "Je suis grand quand je suis jeune et petit quand je suis vieux. Qu'est-ce que je suis ?", a: ["bougie", "crayon"], hint: "On m'utilise pour éclairer ou écrire..." },
  { q: "Plus je sèche, plus je suis mouillée. Qu'est-ce que je suis ?", a: ["serviette"], hint: "On m'utilise après le bain..." },
  { q: "J'ai des dents mais je ne mords pas. Qu'est-ce que je suis ?", a: ["peigne", "scie", "fourchette", "engrenage"], hint: "Je sers à démêler les cheveux..." },
  { q: "Quel mot devient plus court quand on lui ajoute deux lettres ?", a: ["court"], hint: "C'est son propre nom..." },
  { q: "Je marche sans jambes et cours sans pieds. Qu'est-ce que je suis ?", a: ["eau", "riviere", "fleuve"], hint: "Je suis liquide et je coule..." },
  { q: "Qu'est-ce qu'un crocodile trouve sous l'eau ?", a: ["fond", "le fond"], hint: "C'est le bas..." },
  { q: "Je pèse la même chose quand je suis vide que quand je suis pleine. Qu'est-ce que je suis ?", a: ["bulle", "trou", "ombre"], hint: "Je n'ai pas de matière..." },
  { q: "Tout le monde me traverse mais personne ne me voit. Qu'est-ce que je suis ?", a: ["temps", "vent", "air"], hint: "Je suis invisible mais présent partout..." },
  { q: "Plus je suis chaud, plus vite je disparais. Qu'est-ce que je suis ?", a: ["glace", "neige"], hint: "Tu me mets dans ton verre en été..." },
  { q: "J'ai une tête mais pas de corps, une queue mais pas de patte. Qu'est-ce que je suis ?", a: ["pièce", "piece", "monnaie"], hint: "Je suis de l'argent..." },
  { q: "Je commence la nuit et finis le matin. Qu'est-ce que je suis ?", a: ["n", "la lettre n"], hint: "C'est une lettre de l'alphabet..." },
  { q: "Quelle chose peut remplir une pièce entière sans prendre de place ?", a: ["lumiere", "lumière", "son", "bruit"], hint: "On me voit ou on m'entend..." },
];

// Sessions actives de devinettes : Map<sender, { riddleIndex, answer, timeout, reward }>
const activeSessions = new Map();

module.exports = {
  name: 'riddle',
  aliases: ['devinette', 'quiz', 'devine'],
  category: 'fun',
  description: 'Réponds à une devinette et gagne des coins!',
  usage: '.riddle',

  async execute(sock, msg, args, extra) {
    try {
      // Si c'est une réponse
      const text = args.join(' ').toLowerCase().trim();

      if (activeSessions.has(extra.sender)) {
        const session = activeSessions.get(extra.sender);

        if (!text) {
          // Redemander la devinette (sans args)
          const r = RIDDLES[session.riddleIndex];
          return extra.reply(`❓ *Devinette en cours :*\n\n_${r.q}_\n\n💡 Indice: *.riddle hint*\n⏳ Tu as encore du temps!`);
        }

        if (text === 'hint' || text === 'indice') {
          const r = RIDDLES[session.riddleIndex];
          return extra.reply(`💡 *Indice :* ${r.hint}`);
        }

        if (text === 'skip' || text === 'passer') {
          clearTimeout(session.timeout);
          activeSessions.delete(extra.sender);
          const r   = RIDDLES[session.riddleIndex];
          const ans = r.a[0];
          return extra.reply(`⏭️ Devinette passée!\n\n✅ La réponse était : *${ans}*\n\nUtilise *.riddle* pour en avoir une nouvelle!`);
        }

        // Vérifier la réponse
        const r       = RIDDLES[session.riddleIndex];
        const correct = r.a.some(ans => text.includes(ans) || ans.includes(text));

        clearTimeout(session.timeout);
        activeSessions.delete(extra.sender);

        if (correct) {
          eco.addCoins(extra.sender, session.reward);
          const { leveledUp, newLevel } = eco.addXP(extra.sender, 15);
          const user = eco.getUser(extra.sender);

          let reply =
            `✅ *BONNE RÉPONSE !* 🎉\n\n` +
            `La réponse était : *${r.a[0]}*\n` +
            `💰 Tu gagnes : *+${session.reward} 🪙*\n` +
            `💳 Solde : *${user.coins.toLocaleString()} 🪙*`;

          if (leveledUp) reply += `\n\n🎉 NIVEAU SUPÉRIEUR ! Niveau *${newLevel}* !`;

          return extra.reply(reply);
        } else {
          return extra.reply(
            `❌ *MAUVAISE RÉPONSE !*\n\n` +
            `La réponse était : *${r.a[0]}*\n\n` +
            `Utilise *.riddle* pour réessayer!`
          );
        }
      }

      // Nouvelle devinette
      const idx    = Math.floor(Math.random() * RIDDLES.length);
      const riddle = RIDDLES[idx];
      const reward = Math.floor(Math.random() * 100) + 50; // 50–150 coins

      // Timeout de 60 secondes
      const timeout = setTimeout(async () => {
        activeSessions.delete(extra.sender);
        try {
          await sock.sendMessage(extra.from, {
            text: `⏰ *Temps écoulé !*\n\nLa réponse était : *${riddle.a[0]}*\n\nUtilise *.riddle* pour réessayer!`
          });
        } catch {}
      }, 60000);

      activeSessions.set(extra.sender, { riddleIndex: idx, timeout, reward });

      await extra.reply(
        `🧩 *DEVINETTE* (+${reward} 🪙)\n\n` +
        `❓ _${riddle.q}_\n\n` +
        `⏳ Tu as *60 secondes* pour répondre!\n` +
        `💡 *.riddle hint* pour un indice\n` +
        `⏭️ *.riddle skip* pour passer`
      );

    } catch (err) {
      await extra.reply(`❌ Erreur: ${err.message}`);
    }
  }
};
