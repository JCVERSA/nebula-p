'use strict';
// Nebula Bot by Dark Neon

const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ── Optimization: Cache for total commands count ──────────────────────────────
let cachedTotalCommands = 0;
let lastCommandsCountTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getTotalCommands() {
  const now = Date.now();
  if (cachedTotalCommands > 0 && (now - lastCommandsCountTime < CACHE_TTL)) {
    return cachedTotalCommands;
  }

  const commandsPath = path.join(__dirname, '..');
  let count = 0;
  try {
    const categories = fs.readdirSync(commandsPath);
    categories.forEach(folder => {
      const fp = path.join(commandsPath, folder);
      if (fs.lstatSync(fp).isDirectory()) {
        count += fs.readdirSync(fp).filter(f => f.endsWith('.js')).length;
      }
    });
    cachedTotalCommands = count;
    lastCommandsCountTime = now;
  } catch(e) {
    return cachedTotalCommands || 0;
  }
  return count;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function section(emoji, title, lines) {
  const body = lines.map(l => l === '' ? '│' : `│  ◈  ${l}`).join('\n');
  return `╭─「 ${emoji} *${title}* 」\n${body}\n╰${'┄'.repeat(22)}`;
}

const c = (prefix, name, desc) => desc ? `\`${prefix}${name}\` — _${desc}_` : `\`${prefix}${name}\``;

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${d}d ${h}h ${m}m ${sc}s`;
}

function getRam() {
  const total = os.totalmem();
  const used  = total - os.freemem();
  return `${(used / 1024 ** 3).toFixed(2)} GB / ${(total / 1024 ** 3).toFixed(2)} GB`;
}

module.exports = {
  name: 'menu',
  aliases: ['commands', 'cmds'],
  category: 'general',
  usage: '.menu',

  async execute(sock, msg, args, extra) {
    try {
      const startTime = Date.now();
      const p    = Array.isArray(config.prefix) ? config.prefix[0] : (config.prefix || '.');
      const bn   = config.botName || 'Nebula Bot';
      const tz   = config.timezone || 'UTC';
      const sender = extra.sender || msg.key.participant || msg.key.remoteJid;
      const delay  = (ms) => new Promise(r => setTimeout(r, ms));

      const totalCommands = getTotalCommands();

      const now     = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: tz });
      const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).replace(/\//g, '/');
      const uptime  = formatUptime(process.uptime() * 1000);
      const ram     = getRam();

      let senderName = sender.split('@')[0];
      // ── Optimization: Use cached metadata if available ──────────────────────
      const meta = extra.groupMetadata;
      if (meta && meta.participants) {
        const part = meta.participants.find(pp => pp.id === sender);
        if (part && (part.name || part.notify)) senderName = part.name || part.notify;
      }

      // MSG 1 — HEADER CARD
      const header =
        `╭══〘〘 \`${bn}\` 〙〙═⊷\n` +
        `│↠🤖 ᴍᴏᴅᴇ: ${config.selfMode ? 'private' : 'public'}\n` +
        `│↠✒️ ᴘʀᴇғɪx: [ ${p} ]\n` +
        `│↠👤 ᴜsᴇʀ: ${senderName}\n` +
        `│↠🧩 ᴄᴍᴅs: *${totalCommands}*\n` +
        `│↠🚀 ᴠᴇʀsɪᴏɴ: 3.0.0\n` +
        `│↠⏱️ ᴜᴘᴛɪᴍᴇ: ${uptime}\n` +
        `│↠⏰ ᴛɪᴍᴇ: ${timeStr}\n` +
        `│↠📅 ᴅᴀᴛᴇ: ${dateStr}\n` +
        `│↠🌍 ᴛɪᴍᴇ ᴢᴏɴᴇ: ${tz}\n` +
        `│↠💾 ʀᴀᴍ: ${ram}\n` +
        `╰═══════════════════════⊷`;

      // MSG 2 — ADMIN + AI
      const adminBlock = section('🛡️', 'ADMIN', [
        c(p,'kick'), c(p,'promote'), c(p,'demote'), c(p,'add','Add member'),
        c(p,'mute'), c(p,'unmute'), c(p,'warn'), c(p,'warns'), c(p,'clean'),
        c(p,'delete'), c(p,'hidetag'), c(p,'tagadmins'), c(p,'members'),
        c(p,'inactive','Inactive members today'),
        c(p,'active','Active members + stats'),
        c(p,'poll'), c(p,'grouplink'), c(p,'setname'), c(p,'setdesc'),
        c(p,'setrules'), c(p,'rules'), c(p,'setwelcome'), c(p,'setgoodbye'),
        c(p,'welcome'), c(p,'goodbye'),
        c(p,'report','Report a member to admins'),
        '',
        '🔒 *PROTECTION*',
        c(p,'antilink'), c(p,'antispam'), c(p,'antitag'),
        c(p,'antigroupmention'), c(p,'antidelete'), c(p,'antiviewonce'),
        c(p,'slowmode'), c(p,'tempban'), c(p,'autosticker'), c(p,'autotasks'),
        '',
        '📅 *SCHEDULE*',
        c(p,'schedule'), c(p,'schedulelist'), c(p,'unschedule'),
      ]);

      const msg2 = adminBlock;

      // MSG 3 — MEDIA + CONVERTER + TEXT FX
      const mediaBlock = section('⬇️', 'DOWNLOADER', [
        c(p,'tiktok'), c(p,'facebook'), c(p,'instagram'),
        c(p,'igs'), c(p,'igsc'),
        c(p,'ytsearch','Search YouTube'),
        c(p,'song','YouTube → MP3'),
        c(p,'video','YouTube → MP4'),
        c(p,'ytlink'), c(p,'lyrics'),
      ]);

      const converterBlock = section('🔄', 'CONVERTER', [
        c(p,'sticker','Image/video → sticker'),
        c(p,'take','Sticker → image'),
        c(p,'tts','Text to speech'),
        c(p,'translate','Translate text'),
        c(p,'crop','Crop an image'),
        c(p,'attp','Animated text sticker'),
      ]);

      const fxBlock = section('✏️', 'TEXT EFFECTS', [
        '`' + p + 'fire`  `' + p + 'neon`  `' + p + 'ice`  `' + p + 'glitch`',
        '`' + p + 'hacker`  `' + p + 'matrix`  `' + p + 'devil`  `' + p + 'snow`',
        '`' + p + 'thunder`  `' + p + 'metallic`  `' + p + 'sand`',
        '`' + p + 'light`  `' + p + 'leaves`  `' + p + 'purple`',
        '`' + p + 'arena`  `' + p + 'impressive`  `' + p + 'blackpink`  `' + p + '1917`',
      ]);

      const msg3 = [mediaBlock, converterBlock, fxBlock].join('\n\n');

      // MSG 4 — FUN + ANIME + TOOLS + OWNER
      const funBlock = section('😂', 'FUN & GAMES', [
        '`' + p + 'joke`  `' + p + 'meme`  `' + p + 'memesearch`',
        '`' + p + 'truth`  `' + p + 'dare`  `' + p + 'ship`  `' + p + 'gayrate`',
        '`' + p + 'insult`  `' + p + 'flirt`  `' + p + 'complimentry`  `' + p + 'pies`',
        c(p,'roast','Friendly AI roast'),
        c(p,'rps','Rock Paper Scissors with bet 🪙'),
        c(p,'riddle','Riddle — win coins 🪙'),
      ]);

      const animeBlock = section('🎌', 'ANIME', [
        c(p,'anime','Anime info (AniList)'),
        c(p,'anisearch','Paginated search'),
        c(p,'seasonal','Seasonal anime'),
        c(p,'animerec','Recommendations'),
        c(p,'topanime','Rankings'),
        c(p,'manga'), c(p,'character','Random/named character'),
        c(p,'aquote','Anime quote'),
        c(p,'animetts','Anime TTS voice'),
        '',
        '🎭 *REACTION GIFS (35)*',
        '`' + p + 'hug`  `' + p + 'kiss`  `' + p + 'pat`  `' + p + 'cuddle`  `' + p + 'slap`',
        '`' + p + 'cry`  `' + p + 'blush`  `' + p + 'smile`  `' + p + 'laugh`  `' + p + 'wink`',
        '`' + p + 'wave`  `' + p + 'poke`  `' + p + 'punch`  `' + p + 'bite`  `' + p + 'dance`',
      ]);

      const statsBlock = section('📊', 'STATS & GENERAL', [
        c(p,'leaderboard','Top active members'),
        c(p,'groupstats','Group statistics'),
        c(p,'botstat','Bot global stats'),
        c(p,'whois','Member profile'),
        c(p,'myactivity','My activity stats'),
        c(p,'groupinfo'), c(p,'ping'), c(p,'uptime'), c(p,'owner'),
        c(p,'sticker'), c(p,'getpp'), c(p,'qr'), c(p,'ssweb'), c(p,'viewonce'),
      ]);

      const utilityBlock = section('🔧', 'TOOLS & UTILITY', [
        c(p,'upload','File → download link (max 195MB)'),
        c(p,'shorten','URL shortener'),
        c(p,'currency','Currency conversion'),
        c(p,'ocr','Extract text from image'),
        c(p,'base64','Encode/decode B64, Hex, Binary'),
        c(p,'calc'), c(p,'weather'), c(p,'quote'), c(p,'remind'),
      ]);

      const ownerBlock = section('👑', 'OWNER ONLY', [
        c(p,'broadcast'), c(p,'mode'), c(p,'block'), c(p,'unblock'),
        c(p,'anticall'), c(p,'autoreact'), c(p,'setbotname'), c(p,'setbotpp'),
        c(p,'setprefix'), c(p,'setmenuimage'), c(p,'newsletter'), c(p,'restart'),
        c(p,'update'),
        '',
        '🎮 *REMOTE CONTROL*',
        c(p,'botgroup','List bot groups'),
        c(p,'gm','Members of a group'),
        c(p,'remote','Remote control in other groups'),
      ]);

      const footer =
        '\n╭══════════════════════════════╮\n' +
        '│ 👑 *OWNER* — Dark Neon\n' +
        '│ 📞 wa.me/237640143760\n' +
        '│ ✈️  t.me/Neonjca2\n' +
        '╰══════════════════════════════╯\n' +
        '> 🌌 *' + bn + '* │ _Prefix: ' + p + '_';

      const msg4 = [funBlock, animeBlock, statsBlock, utilityBlock, ownerBlock].join('\n\n') + footer;

      // ── Send ──────────────────────────────────────────────────────────────
      const imgPath = path.join(__dirname, '../../utils/bot_image.jpg');
      try {
        if (fs.existsSync(imgPath)) {
          await sock.sendMessage(extra.from, {
            image: fs.readFileSync(imgPath),
            caption: header,
            mentions: [sender]
          }, { quoted: msg });
        } else {
          await sock.sendMessage(extra.from, { text: header, mentions: [sender] }, { quoted: msg });
        }
      } catch(e) {
        await extra.reply(header);
      }

      const executionTime = Date.now() - startTime;
      console.log(`[Menu] Generated in ${executionTime}ms`);

      await delay(600);
      await sock.sendMessage(extra.from, { text: msg2 });
      await delay(600);
      await sock.sendMessage(extra.from, { text: msg3 });
      await delay(600);
      await sock.sendMessage(extra.from, { text: msg4 });

    } catch (error) {
      console.error('[Menu Error]:', error);
      await extra.reply('❌ Menu error: ' + error.message);
    }
  }
};
