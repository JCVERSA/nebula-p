/**
 * Global Configuration — Nebula Bot by Dark Neon
 *
 * ⚠️  SÉCURITÉ — IMPORTANT :
 * Les clés API ci-dessous ont des fallbacks hardcodés à titre de développement.
 * En PRODUCTION (bot-hosting.net), toujours définir ces variables dans l'onglet
 * "Startup" → "Environment Variables" du panel Pterodactyl :
 *   SESSION_ID, OWNER_NUMBER, OPENWEATHER_KEY, RENDER_SECRET, RENDER_DASHBOARD_URL
 *   (Les clés IA seront rajoutées lors de la prochaine intégration)
 * Les clés hardcodées ci-dessous doivent être régénérées si elles ont été exposées.
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.split(',') : [], // Always use env var in production
    ownerName: process.env.OWNER_NAME || 'Owner',

    // Bot Configuration
    botName: process.env.BOT_NAME || 'Nebula Bot',
    prefix: process.env.PREFIX ? process.env.PREFIX.split(',') : ['.', '/', '-', '1'], // Allowed prefixes for commands
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: process.env.NEWSLETTER_JID || '120363161513685998@newsletter', // Ton canal WhatsApp si tu en as un
    updateZipUrl: process.env.UPDATE_ZIP_URL || '', // URL de ton repo ZIP si tu en as un

    // Sticker Configuration
    packname: 'Nebula Bot',

    // Bot Behavior
    selfMode: false,     // true = seulement le owner peut utiliser les commandes
    autoRead: false,     // lire automatiquement les messages
    autoTyping: false,   // afficher "en train d'écrire..."
    autoBio: false,      // mettre à jour le statut automatiquement
    autoSticker: false,  // convertir les images en stickers automatiquement
    autoReact: false,    // réagir automatiquement aux messages
    autoReactMode: 'bot', // 'bot' = réagir aux commandes | 'all' = réagir à tout
    autoDownload: false,

    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete',       // 'delete' ou 'kick'
      antitag: false,
      antitagAction: 'delete',
      antiall: false,
      antiviewonce: false,
      antibot: false,
      anticall: false,
      antigroupmention: false,
      antigroupmentionAction: 'delete',
      welcome: false,
      welcomeMessage: '╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n┃Member count: #memberCount\n┃𝚃𝙸𝙼𝙴: time⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*',
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false
    },

    // API Keys
    apiKeys: {
      remove_bg:   process.env.REMOVE_BG_API_KEY || '',
      openweather: process.env.OPENWEATHER_KEY   || '',
    },

    // Messages système
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for the bot owner!',
      adminOnly: '🛡️ This command is only for group admins!',
      groupOnly: '👥 This command can only be used in groups!',
      privateOnly: '💬 This command can only be used in private chat!',
      botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
      invalidCommand: '❓ Invalid command! Type .menu for help'
    },

    // Timezone
    timezone: process.env.TIMEZONE || 'Europe/Paris', // Change selon ta zone (Europe/Paris, America/New_York, etc.)

    // Health check server (required by hosting platforms expecting a bound port)
    healthCheckPort: process.env.HEALTHCHECK_PORT || 8000,

    // Limits
    maxWarnings: 3,

    // Social Links
    social: {
      github: '',
      instagram: '',
      youtube: '',
      telegram: 'https://t.me/Neonjca2',
      whatsapp: 'https://wa.me/237640143760',
      group: 'https://chat.whatsapp.com/EqrRF0FvlTWLcgJR91RfCA'
    }
};
