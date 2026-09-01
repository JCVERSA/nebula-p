// Nebula Bot by Dark Neon
/**
 * BotStat Command — Statistiques globales du bot
 * Messages traités, commandes exécutées, groupes, uptime, mémoire
 */

const { getBotStats } = require('../../utils/groupstats');
const config = require('../../config');
const os     = require('os');

function formatUptime(ms) {
  const s  = Math.floor(ms / 1000);
  const d  = Math.floor(s / 86400);
  const h  = Math.floor((s % 86400) / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  const parts = [];
  if (d) parts.push(`${d}j`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sc || !parts.length) parts.push(`${sc}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n || 0);
}

module.exports = {
  name: 'botstat',
  aliases: ['botstats', 'bstats', 'bs', 'botinfo'],
  category: 'general',
  description: 'Statistiques globales du bot',
  usage: '.botstat',

  async execute(sock, msg, args, extra) {
    try {
      const botStats   = getBotStats();
      const uptimeMs   = process.uptime() * 1000;
      const memUsage   = process.memoryUsage();
      const totalMem   = os.totalmem();
      const freeMem    = os.freemem();
      const usedMem    = totalMem - freeMem;
      const memPct     = ((usedMem / totalMem) * 100).toFixed(1);
      const heapPct    = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
      const nodeVer    = process.version;
      const platform   = os.platform();
      const cpuModel   = os.cpus()[0]?.model?.trim() || 'Unknown';
      const cpuLoad    = os.loadavg()[0].toFixed(2);

      // Compter les groupes actifs depuis groupFetchAllParticipating
      let groupCount = '...';
      try {
        const groups = await sock.groupFetchAllParticipating();
        groupCount = Object.keys(groups).length;
      } catch {}

      // Date de démarrage estimée
      const startedAt = new Date(Date.now() - uptimeMs);
      const startedStr = startedAt.toLocaleString('fr-FR', { timeZone: config.timezone || 'Africa/Douala' });

      // Barre de progression mémoire
      const memBar = (pct) => {
        const filled = Math.round(pct / 10);
        const color  = pct > 85 ? '🔴' : pct > 60 ? '🟡' : '🟢';
        return `${color} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}%`;
      };

      const text =
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 📊 *BOT STATISTICS*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +

        `🤖 *Bot:* ${config.botName || 'Nebula Bot'}\n` +
        `👑 *Owner:* ${(config.ownerName || ['Dark Neon']).join(', ')}\n` +
        `⏱️ *Uptime:* ${formatUptime(uptimeMs)}\n` +
        `🕐 *Démarré le:* ${startedStr}\n\n` +

        `📨 *Messages traités:* ${formatNum(botStats.totalMessages)}\n` +
        `⚡ *Commandes exécutées:* ${formatNum(botStats.totalCommands)}\n` +
        `👥 *Groupes actifs:* ${groupCount}\n\n` +

        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💾 *SYSTÈME*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ *OS:* ${platform}\n` +
        `🔧 *Node.js:* ${nodeVer}\n` +
        `🧠 *CPU:* ${cpuModel}\n` +
        `📈 *CPU Load:* ${cpuLoad}\n\n` +
        `💾 *RAM Système:*\n` +
        `   ${memBar(parseFloat(memPct))}\n` +
        `   Utilisée: ${formatBytes(usedMem)} / ${formatBytes(totalMem)}\n\n` +
        `🔧 *Heap Node.js:*\n` +
        `   ${memBar(parseFloat(heapPct))}\n` +
        `   Utilisée: ${formatBytes(memUsage.heapUsed)} / ${formatBytes(memUsage.heapTotal)}\n\n` +
        `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      await extra.reply(text);

    } catch (err) {
      console.error('[botstat] error:', err);
      extra.reply('❌ Erreur lors du chargement des statistiques.');
    }
  }
};
