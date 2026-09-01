/**
 * Owner Command - Affiche les infos du propriétaire du bot
 */

const config = require('../../config');

module.exports = {
    name: 'owner',
    aliases: ['creator', 'dev', 'botowner' , 'Neon' ],
    category: 'general',
    description: 'Show bot owner contact information',
    usage: '.owner',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            // Envoyer la carte de contact WhatsApp
            const ownerNames = Array.isArray(config.ownerName) ? config.ownerName : [config.ownerName];
            const vCards = config.ownerNumber.map((num, index) => {
                const name = ownerNames[index] || ownerNames[0] || 'Bot Owner';
                return {
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;waid=${num}:${num}\nEND:VCARD`
                };
            });

            await sock.sendMessage(chatId, {
                contacts: {
                    displayName: ownerNames[0] || 'Bot Owner',
                    contacts: vCards
                }
            });

            // Message avec toutes les infos du owner
            await extra.reply(
                `👑 *Propriétaire du Bot*\n\n` +
                `👤 *Nom:* Dark Neon\n` +
                `📱 *Telegram:* t.me/Neonjca2\n` +
                `📞 *WhatsApp:* wa.me/237640143760\n` +
                `👥 *Groupe:* chat.whatsapp.com/EqrRF0FvlTWLcgJR91RfCA\n\n` +
                `> _Powered by ${config.botName}_`
            );

        } catch (error) {
            console.error('Owner command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
