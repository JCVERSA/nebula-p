// Nebula Bot by Dark Neon
/**
 * Commande .roast — Roast/taquinerie (humour léger, 100% statique)
 */

'use strict';

const cooldowns = new Map();
const COOLDOWN_MS = 15000;

const ROASTS = [
  (t) => `${t}, t'as l'air si sérieux qu'on dirait que tu déclares tes impôts même en vacances 😂`,
  (t) => `${t}, ton WiFi est plus stable que ta vie amoureuse... et encore 📶`,
  (t) => `${t}, tu arrives toujours en retard mais au moins tu arrives — un peu comme les promesses de l'État 💀`,
  (t) => `${t}, t'es la preuve vivante qu'on peut survivre sans ambition 🌿`,
  (t) => `${t}, même ton ombre essaie de garder ses distances parfois 😭`,
  (t) => `${t}, tu parles tellement que les murs ont commencé à mettre des écouteurs 🎧`,
  (t) => `${t}, ton téléphone a plus de batterie que toi en soirée 🔋`,
  (t) => `${t}, t'as mis 10 minutes à lire ce roast. C'est noté 📝`,
  (t) => `${t}, tu es l'humain qui a fait comprendre aux gens pourquoi certains animaux mangent leurs petits 💀`,
  (t) => `${t}, même Google Maps ne trouve pas ta motivation 📍`,
  (t) => `${t}, tu fais semblant de travailler tellement bien que ton patron a failli te féliciter 😂`,
  (t) => `${t}, t'es le genre de personne qui met "en réflexion" sur un formulaire à remplir tout de suite 🤔`,
  (t) => `${t}, ton énergie du matin ressemble à un téléphone à 3% de batterie ⚡`,
  (t) => `${t}, tu es la raison pour laquelle les modes silencieux ont été inventés 🔇`,
  (t) => `${t}, t'as une présence si discrète que ton chat t'a adopté par pitié 🐱`,
];

module.exports = {
  name: 'roast',
  aliases: ['rotir', 'taquin'],
  category: 'fun',
  description: 'Roast/taquinerie légère et bienveillante',
  usage: '.roast <@mention ou nom> | .roast me',

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length) {
        return extra.reply(
          '🔥 *Nebula Roast*\n\n' +
          'Usage :\n' +
          '  `.roast me` — te faire rôtir toi-même\n' +
          '  `.roast <nom>` — taquiner quelqu\'un\n' +
          '  `.roast @mention` — taquiner un membre du groupe\n\n' +
          '⚠️ _Humour léger uniquement !_'
        );
      }

      // Anti-spam
      const now = Date.now();
      const lastUsed = cooldowns.get(extra.sender) || 0;
      if (now - lastUsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
        return extra.reply(`⏳ Cooldown actif ! Attends encore ${remaining}s.`);
      }
      cooldowns.set(extra.sender, now);

      // Cible
      let target = args.join(' ').trim();
      const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      let targetName = target;

      if (target.toLowerCase() === 'me' || target.toLowerCase() === 'moi') {
        targetName = extra.pushName || 'toi';
      } else if (mentionedJid) {
        targetName = mentionedJid.split('@')[0];
      }

      targetName = targetName.replace(/@\d+/g, '').trim() || 'quelqu\'un';

      const roastFn = ROASTS[Math.floor(Math.random() * ROASTS.length)];
      const roastText = roastFn(targetName);

      await sock.sendMessage(extra.from, { react: { text: '🔥', key: msg.key } });
      await sock.sendMessage(extra.from, {
        text: `🔥 *Nebula Roast*\n\n${roastText}\n\n_⚠️ C'est de l'humour bienveillant !_`,
        mentions: mentionedJid ? [mentionedJid] : [],
      }, { quoted: msg });

    } catch (error) {
      console.error('[Roast Error]:', error.message);
      await extra.reply(`❌ Erreur : ${error.message}`);
    }
  }
};
