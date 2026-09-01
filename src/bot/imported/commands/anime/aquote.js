/**
 * Anime Quote Command — Nebula Bot by Dark Neon
 * Sources : animechan API + fallback étendu (50 citations)
 */

'use strict';

const axios = require('axios');

// 50 citations triées par thème
const FALLBACK_QUOTES = [
  // Détermination
  { quote: "Je ne reculerai jamais et ne regretterai rien — c'est ma voie du ninja.", character: 'Naruto Uzumaki', anime: 'Naruto' },
  { quote: "Si tu prends des risques, tu peux créer un futur.", character: 'Monkey D. Luffy', anime: 'One Piece' },
  { quote: "Avance, même si tu dois ramper.", character: 'Eren Yeager', anime: 'Attack on Titan' },
  { quote: "Peu importe combien de fois tu tombes, tu dois te relever.", character: 'Izuku Midoriya', anime: 'My Hero Academia' },
  { quote: "La douleur m'indique que je suis encore en vie.", character: 'Guts', anime: 'Berserk' },
  { quote: "Je surpasserai mes limites. Encore et encore.", character: 'Rock Lee', anime: 'Naruto' },
  { quote: "La puissance n'est pas une question de désir — elle répond à un besoin.", character: 'Son Goku', anime: 'Dragon Ball Z' },
  // Sagesse
  { quote: "Le monde n'est pas parfait, mais il fait de son mieux — c'est ce qui le rend si beau.", character: 'Roy Mustang', anime: 'Fullmetal Alchemist' },
  { quote: "Une leçon sans douleur est sans sens. Pour obtenir, on doit sacrifier quelque chose.", character: 'Edward Elric', anime: 'Fullmetal Alchemist' },
  { quote: "La peur n'est pas mauvaise — elle te montre ta faiblesse.", character: 'Gildarts Clive', anime: 'Fairy Tail' },
  { quote: "Le bonheur du présent est construit sur les souffrances du passé.", character: 'Itachi Uchiha', anime: 'Naruto Shippuden' },
  { quote: "Ceux qui brisent les règles sont des déchets, mais ceux qui abandonnent leurs amis sont pires que des déchets.", character: 'Kakashi Hatake', anime: 'Naruto' },
  { quote: "Il n'y a aucune honte à tomber. La vraie honte est de ne pas se relever.", character: 'Shikamaru Nara', anime: 'Naruto' },
  { quote: "Savoir ressentir la douleur des autres, c'est pour ça qu'on essaie d'être gentil.", character: 'Jiraiya', anime: 'Naruto Shippuden' },
  { quote: "Il n'y a pas de raccourci vers un rêve.", character: 'Rock Lee', anime: 'Naruto' },
  // Sacrifice & Amour
  { quote: "Je protégerai tout ce qui me tient à cœur — même si ça doit me briser.", character: 'Tanjiro Kamado', anime: 'Demon Slayer' },
  { quote: "Un sourire peut cacher mille larmes.", character: 'Hana Uzaki', anime: 'Uzaki-chan' },
  { quote: "Même si tu es le seul à croire en quelqu'un, ça suffit.", character: 'Tohru Honda', anime: 'Fruits Basket' },
  { quote: "Les gens meurent deux fois : la première quand ils cessent de respirer, la seconde quand quelqu'un prononce leur nom pour la dernière fois.", character: 'Jiraiya', anime: 'Naruto Shippuden' },
  { quote: "Aucun homme n'a le droit de regarder quelqu'un d'autre de haut, sauf pour l'aider à se relever.", character: 'Gaara', anime: 'Naruto' },
  // Identité & Liberté
  { quote: "Je suis libre. Peu importe ce que les autres disent.", character: 'Roronoa Zoro', anime: 'One Piece' },
  { quote: "Être humain, c'est avoir la capacité de choisir.", character: 'Erwin Smith', anime: 'Attack on Titan' },
  { quote: "Si tu ne peux pas battre le monstre qui est en toi, tu ne battras jamais les monstres dehors.", character: 'Zenitsu Agatsuma', anime: 'Demon Slayer' },
  { quote: "Ce n'est pas le visage qui fait un monstre — c'est ses choix.", character: 'Naruto Uzumaki', anime: 'Naruto' },
  { quote: "Rien n'est à moi. Je ne suis que de passage.", character: 'Spike Spiegel', anime: 'Cowboy Bebop' },
  // JJK & récent
  { quote: "Si tu penses à te rendre, rappelle-toi pourquoi tu as tenu si longtemps.", character: 'Satoru Gojo', anime: 'Jujutsu Kaisen' },
  { quote: "Je nais, j'existe, je mourrai proprement.", character: 'Yuji Itadori', anime: 'Jujutsu Kaisen' },
  { quote: "Tout le monde finit par mourir — ce qui compte, c'est comment tu as vécu.", character: 'Ryomen Sukuna', anime: 'Jujutsu Kaisen' },
  { quote: "Être fort n'est pas tout — savoir quand montrer sa faiblesse, c'est aussi une force.", character: 'Megumi Fushiguro', anime: 'Jujutsu Kaisen' },
  // One Piece
  { quote: "Je veux vivre sans regret.", character: 'Portgas D. Ace', anime: 'One Piece' },
  { quote: "Un homme qui abandonne son rêve meurt debout.", character: 'Donquixote Doflamingo', anime: 'One Piece' },
  { quote: "Nos vies ne nous appartiennent pas — du ventre à la tombe, nous sommes liés aux autres.", character: 'Niko Robin', anime: 'One Piece' },
  // Humour / légèreté
  { quote: "Je ne mange pas pour vivre — je vis pour manger !", character: 'Escanor', anime: 'Seven Deadly Sins' },
  { quote: "Si tu travailles dur, tes rêves se réalisent. Si tu ne travailles pas, ils ne se réalisent pas.", character: 'Sora', anime: 'No Game No Life' },
  { quote: "N'importe quel idiot peut écrire un algorithme compliqué. Seuls les gens brillants en écrivent des simples.", character: 'Shouyou Hinata', anime: 'Haikyuu!!' },
  // Haikyuu & sports
  { quote: "Chaque match est une lutte. Chaque point est une victoire.", character: 'Tobio Kageyama', anime: 'Haikyuu!!' },
  { quote: "Le talent, c'est vouloir faire quelque chose.", character: 'Kōshi Sugawara', anime: 'Haikyuu!!' },
  // Code Geass & psychologique
  { quote: "Les seuls qui devraient tuer sont ceux prêts à être tués.", character: 'Lelouch vi Britannia', anime: 'Code Geass' },
  { quote: "Depuis quand s'entraider est-il une erreur ?", character: 'Light Yagami', anime: 'Death Note' },
  { quote: "Le monde est corrompu. Mais si tu ne touches pas à cette corruption, elle te consumera.", character: 'L Lawliet', anime: 'Death Note' },
  // HxH & Killua
  { quote: "Abandonne. C'est ce qui tue les gens.", character: 'Killua Zoldyck', anime: 'Hunter x Hunter' },
  { quote: "Je peux surpasser n'importe quel obstacle si je travaille suffisamment.", character: 'Gon Freecss', anime: 'Hunter x Hunter' },
  // SAO, Re:Zero
  { quote: "La vie est trop courte pour passer du temps avec des gens qui te vident de ton énergie.", character: 'Kirito', anime: 'Sword Art Online' },
  { quote: "Je ne veux pas une récompense — je veux juste voir mon ami sourire.", character: 'Subaru Natsuki', anime: 'Re:Zero' },
  // Demon Slayer
  { quote: "Les larmes coulent pour les morts, pas pour nous-mêmes.", character: 'Giyu Tomioka', anime: 'Demon Slayer' },
  // Divers
  { quote: "Quoi que tu fasses, fais-le à fond. C'est le secret de la vie.", character: 'Rider', anime: 'Fate/Zero' },
  { quote: "Si tu veux changer le monde, commence par toi-même.", character: 'Okabe Rintarou', anime: 'Steins;Gate' },
  { quote: "La beauté des fleurs tient à leur fragilité.", character: 'Violet Evergarden', anime: 'Violet Evergarden' },
  { quote: "Personne ne peut saisir ce qu'il n'est pas encore capable de comprendre.", character: 'Osamu Dazai', anime: 'Bungou Stray Dogs' },
  { quote: "Le passé ne peut être changé. L'avenir est encore entre tes mains.", character: 'Historia Reiss', anime: 'Attack on Titan' },
];

module.exports = {
  name: 'aquote',
  aliases: ['animequote', 'aqt', 'aniquote'],
  category: 'anime',
  description: 'Citation aléatoire d\'anime',
  usage: '.aquote [anime]',

  async execute(sock, msg, args, extra) {
    try {
      const searchAnime = args.join(' ').trim();
      let quoteData = null;

      if (searchAnime) {
        // Chercher via animechan
        for (const url of [
          `https://animechan.io/api/v1/quotes/random?anime=${encodeURIComponent(searchAnime)}`,
          `https://animechan.vercel.app/api/random/anime?title=${encodeURIComponent(searchAnime)}`,
        ]) {
          try {
            const { data } = await axios.get(url, { timeout: 6000 });
            const q = data?.data?.content || data?.quote;
            const c = data?.data?.character?.name || data?.character;
            const a = data?.data?.anime?.name || data?.anime;
            if (q) { quoteData = { quote: q, character: c, anime: a }; break; }
          } catch {}
        }

        // Si l'API n'a pas trouvé → chercher dans les fallback
        if (!quoteData) {
          const key = searchAnime.toLowerCase();
          const match = FALLBACK_QUOTES.filter(q => q.anime.toLowerCase().includes(key));
          if (match.length) quoteData = match[Math.floor(Math.random() * match.length)];
        }
      }

      // Citation aléatoire générale
      if (!quoteData) {
        try {
          const { data } = await axios.get('https://animechan.io/api/v1/quotes/random', { timeout: 6000 });
          const q = data?.data?.content;
          const c = data?.data?.character?.name;
          const a = data?.data?.anime?.name;
          if (q) quoteData = { quote: q, character: c, anime: a };
        } catch {}
      }

      // Fallback local
      if (!quoteData?.quote) {
        quoteData = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
      }

      const { quote, character, anime } = quoteData;

      await extra.reply(
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 💬 *CITATION ANIME*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_"${quote}"_\n\n` +
        `👤 *${character || 'Inconnu'}*\n` +
        `📺 ${anime || 'Anime inconnu'}\n\n` +
        `> _ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot_`
      );

    } catch (error) {
      console.error('[AQUOTE] Error:', error.message);
      const fb = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
      await extra.reply(
        `💬 _"${fb.quote}"_\n\n👤 *${fb.character}* — 📺 ${fb.anime}`
      );
    }
  }
};
