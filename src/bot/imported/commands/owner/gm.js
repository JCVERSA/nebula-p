/**
 * Group Members Command — Nebula Bot by Dark Neon
 * List all members of a group with their number and name
 * Owner only (works from private or any group)
 */

const config = require('../../config');
const { jidDecode } = require('@whiskeysockets/baileys');
const { getLidMappingValue } = require('../../utils/jidHelper');

// Convert any JID (including LID) to real phone number
function getRealNumber(jid) {
  if (!jid) return '?';
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return jid.split('@')[0];
    const user = decoded.user;
    const server = decoded.server;

    // If it's a LID server, try to resolve to real phone number
    if (server === 'lid' || server === 'hosted.lid') {
      const pn = getLidMappingValue(user, 'lidToPn');
      if (pn) return pn;
      // LID not mapped yet — flag it clearly
      return `LID:${user}`;
    }
    // Normal JID — just return the number
    return user;
  } catch {
    return jid.split('@')[0];
  }
}

async function resolveGroup(sock, input) {
  const all = await sock.groupFetchAllParticipating();
  const groups = Object.values(all);
  const byId = groups.find(g => g.id.startsWith(input.replace('@g.us', '')));
  if (byId) return byId;
  const lower = input.toLowerCase();
  return groups.find(g => g.subject?.toLowerCase().includes(lower)) || null;
}

module.exports = {
  name: 'gm',
  aliases: ['gmember', 'groupm', 'gmembers'],
  category: 'owner',
  description: 'List all members of a group with their number and name',
  usage: '.gm <group_id or name>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      // ── Owner check ──
      const ownerNumbers = (config.ownerNumber || []).map(n => `${n}@s.whatsapp.net`);
      if (!ownerNumbers.includes(extra.sender)) {
        return extra.reply('👑 This command is only for the bot owner!');
      }

      if (!args[0]) {
        return extra.reply(
          `👥 *Group Members*\n\n` +
          `Usage: .gm <group_id or name>\n\n` +
          `Examples:\n` +
          `  .gm 120363423207517862\n` +
          `  .gm Nébula Crew\n\n` +
          `💡 Use *.botgroup* to see all group IDs.`
        );
      }

      const groupInput = args.join(' ');
      await extra.reply(`🔍 Looking for group *${groupInput}*...`);

      const group = await resolveGroup(sock, groupInput);
      if (!group) {
        return extra.reply(
          `❌ Group not found: *${groupInput}*\n\n` +
          `💡 Use *.botgroup* to see all group IDs and names.`
        );
      }

      const groupId = group.id;
      const groupName = group.subject || groupId;

      // Fetch fresh metadata
      const metadata = await sock.groupMetadata(groupId);
      const participants = metadata.participants || [];

      if (!participants.length) {
        return extra.reply(`❌ No members found in *${groupName}*`);
      }

      // Separate admins and regular members
      const superAdmins = participants.filter(p => p.admin === 'superadmin');
      const admins      = participants.filter(p => p.admin === 'admin');
      const members     = participants.filter(p => !p.admin);

      // Format a participant line
      // Try to get display name from various fields
      const formatMember = (p, index, emoji) => {
        const jid    = p.id || '';
        const number = getRealNumber(jid);
        const isLid  = number.startsWith('LID:');
        const display = isLid ? `⚠️ ${number}` : `+${number}`;
        // WhatsApp doesn't expose names to bots easily, use notify/verifiedName if available
        const name   = p.notify || p.verifiedName || p.name || '—';
        return `${emoji} *${index}.* ${display}\n│    📛 ${name}`;
      };

      // Build sections
      const sections = [];

      if (superAdmins.length) {
        const lines = superAdmins.map((p, i) => formatMember(p, i + 1, '👑'));
        sections.push(`👑 *OWNER (${superAdmins.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n│\n')}`);
      }

      if (admins.length) {
        const lines = admins.map((p, i) => formatMember(p, i + 1, '🛡️'));
        sections.push(`🛡️ *ADMINS (${admins.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n│\n')}`);
      }

      if (members.length) {
        const lines = members.map((p, i) => formatMember(p, i + 1, '👤'));
        sections.push(`👤 *MEMBERS (${members.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n│\n')}`);
      }

      // Header
      const header =
        `╭━━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 👥 *GROUP MEMBERS*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `📌 *Group:* ${groupName}\n` +
        `🆔 *ID:* ${groupId.split('@')[0]}\n` +
        `📊 *Total:* ${participants.length} members\n` +
        `   (${superAdmins.length} owner · ${admins.length} admins · ${members.length} members)\n`;

      const footer = `\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`;

      // Split into chunks of 25 members per message to avoid too-long messages
      const CHUNK_SIZE = 25;

      // Flatten all members for chunking
      const allLines = [];
      for (const section of sections) {
        allLines.push(section);
      }

      // If total is small enough, send in one message
      if (participants.length <= 50) {
        await sock.sendMessage(extra.from, {
          text: header + '\n' + allLines.join('\n\n') + footer
        }, { quoted: msg });
        return;
      }

      // Otherwise send header first, then chunks of members section by section
      await sock.sendMessage(extra.from, { text: header }, { quoted: msg });
      await new Promise(r => setTimeout(r, 500));

      for (const section of sections) {
        const lines = section.split('\n');
        const title = lines.slice(0, 2).join('\n');
        const entries = lines.slice(2);

        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
          const chunk = entries.slice(i, i + CHUNK_SIZE);
          const isFirst = i === 0;
          const isLast  = i + CHUNK_SIZE >= entries.length;

          await sock.sendMessage(extra.from, {
            text: (isFirst ? title + '\n' : '') + chunk.join('\n') + (isLast ? footer : '')
          });
          await new Promise(r => setTimeout(r, 600));
        }
      }

    } catch (error) {
      console.error('[GM] Error:', error.message);
      await extra.reply('❌ Failed to fetch members: ' + error.message);
    }
  }
};

