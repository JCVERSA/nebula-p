/**
 * Remote Command — Nebula Bot by Dark Neon
 * Execute group admin commands from private chat or another group
 * Owner only
 *
 * Usage:
 *   .remote <group_id> <command> [args]
 *   .remote <group_name> <command> [args]
 *
 * Examples:
 *   .remote 120363... warn @2376... spamming
 *   .remote "Mon Groupe" kick @2376...
 *   .remote 120363... mute
 *   .remote 120363... antilink on
 */

const config = require('../../config');
const database = require('../../database');
const { findParticipant } = require('../../utils/jidHelper');
const { longDelay } = require('../../utils/antibanDelay');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNumber(n) {
  return n.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

function extractMentioned(allArgs, contextInfo) {
  // 1. From WhatsApp native @mention system (always populated when user tags someone)
  const fromCtx = (contextInfo?.mentionedJid || []).filter(Boolean);

  // 2. From raw text like @237659012832 or just 237659012832 in args
  const fromArgs = allArgs
    .filter(a => /^@?\d{6,}$/.test(a))
    .map(a => formatNumber(a));

  // 3. Merge, normalize, deduplicate
  const all = [...fromCtx, ...fromArgs].map(j =>
    j.includes('@') ? j : formatNumber(j)
  );
  return [...new Set(all)];
}

async function resolveGroup(sock, input) {
  const all = await sock.groupFetchAllParticipating();
  const groups = Object.values(all);

  // Try exact group ID
  const byId = groups.find(g => g.id.startsWith(input.replace('@g.us', '')));
  if (byId) return byId;

  // Try name (case-insensitive)
  const lower = input.toLowerCase();
  const byName = groups.find(g => g.subject?.toLowerCase().includes(lower));
  return byName || null;
}

// ── Remote command handler ────────────────────────────────────────────────────

const SUPPORTED_COMMANDS = [
  'warn','warns','clearwarns',
  'kick','remove',
  'mute','unmute',
  'promote','demote',
  'antilink','antispam','antitag','antigroupmention',
  'welcome','goodbye',
  'setwelcome','setgoodbye','setname','setdesc','setrules','rules',
  'hidetag','tagadmins',
  'clean','delete',
  'grouplink','members','inactive',
  'settings','autosticker','autotasks',
  'schedule','unschedule','schedulelist',
  'poll'
];

module.exports = {
  name: 'remote',
  aliases: ['rc', 'rmcmd', 'gcmd'],
  category: 'owner',
  description: 'Execute an admin command in any group remotely',
  usage: '.remote <group_id or name> <command> [args]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      // ── Owner check ──
      const ownerNumbers = (config.ownerNumber || []).map(n => `${n}@s.whatsapp.net`);
      if (!ownerNumbers.includes(extra.sender)) {
        return extra.reply('👑 This command is only for the bot owner!');
      }

      // ── Parse args ──
      if (args.length < 2) {
        return extra.reply(
          `╭━━━━━━━━━━━━━━━━╮\n` +
          `┃ 🎮 *REMOTE CONTROL*\n` +
          `╰━━━━━━━━━━━━━━━━╯\n\n` +
          `📝 *Usage:*\n` +
          `  .remote <group_id> <cmd> [args]\n\n` +
          `📌 *Examples:*\n` +
          `  .remote 120363... warn @237... spamming\n` +
          `  .remote MyGroup kick @237...\n` +
          `  .remote 120363... mute\n` +
          `  .remote 120363... antilink on\n` +
          `  .remote 120363... promote @237...\n\n` +
          `📋 *Supported commands:*\n` +
          SUPPORTED_COMMANDS.map(c => `  • ${Array.isArray(config.prefix) ? config.prefix[0] : config.prefix}${c}`).join('\n') + '\n\n' +
          `💡 Use *.botgroup* to see all group IDs.\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot*`
        );
      }

      const groupInput = args[0];
      const cmdName = args[1].toLowerCase().replace(/^\./, '');
      const cmdArgs = args.slice(2);
      const ctx = msg.message?.extendedTextMessage?.contextInfo
               || msg.message?.conversation
               || {};
      // Pass ALL args so we catch @numbers even if they appear anywhere
      const mentioned = extractMentioned(args, ctx);

      // ── Find group ──
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

      // ── Validate command ──
      if (!SUPPORTED_COMMANDS.includes(cmdName)) {
        return extra.reply(
          `❌ Command *${cmdName}* is not supported for remote use.\n\n` +
          `📋 Supported: ${SUPPORTED_COMMANDS.join(', ')}`
        );
      }

      // ── Execute ──
      await extra.reply(`⚙️ Executing *.${cmdName}* in *${groupName}*...`);

      // Helper to send result back to the caller
      const replyToOwner = (text) => sock.sendMessage(extra.from, { text: `📨 *[${groupName}]*\n${text}` });

      // Helper to send message in the target group
      const sendInGroup = (content) => sock.sendMessage(groupId, content);

      // Get group metadata once
      const metadata = await sock.groupMetadata(groupId);
      const participants = metadata.participants || [];

      // Resolve target — return JID directly, even if not found in local metadata
      // (LID-based accounts may not match, but sock calls will still work)
      const getTarget = () => {
        if (mentioned.length === 0) return null;
        // Try to find via findParticipant first (LID-aware)
        const byParticipant = findParticipant(participants, mentioned[0]);
        if (byParticipant) return byParticipant.id;
        // Fallback: use the raw JID from mention directly
        return mentioned[0];
      };

      await longDelay();

      // ── Command routing ──────────────────────────────────────────────────────

      switch (cmdName) {

        // WARN
        case 'warn': {
          const target = getTarget();
          if (!target) return replyToOwner('❌ Please mention a user to warn. Example: .remote GroupName warn @237...');
          const reason = cmdArgs.filter(a => !a.startsWith('@')).join(' ') || 'No reason specified';
          const MAX = config.maxWarnings || 3;
          const warnData = database.addWarning(groupId, target, reason);
          const count = warnData.count;
          if (count >= MAX) {
            database.clearWarnings(groupId, target);
            await sock.groupParticipantsUpdate(groupId, [target], 'remove');
            await sendInGroup({ text: `⛔ @${target.split('@')[0]} has been kicked after reaching ${MAX} warnings!\nReason: ${reason}`, mentions: [target] });
            await replyToOwner(`✅ @${target.split('@')[0]} warned and kicked (${MAX}/${MAX}) in *${groupName}*`);
          } else {
            await sendInGroup({ text: `⚠️ *Warning* ⚠️\n\n@${target.split('@')[0]} has been warned!\n📝 Reason: ${reason}\n⚠️ Warnings: ${count}/${MAX}`, mentions: [target] });
            await replyToOwner(`✅ @${target.split('@')[0]} warned (${count}/${MAX}) in *${groupName}*`);
          }
          break;
        }

        // WARNS
        case 'warns': {
          const target = getTarget();
          if (!target) {
            const allWarns = database.getAllWarnings ? database.getAllWarnings(groupId) : {};
            const lines = Object.entries(allWarns).map(([jid, w]) => `• @${jid.split('@')[0]}: ${w.count || 0} warn(s)`);
            return replyToOwner(lines.length ? `📋 *Warnings in ${groupName}:*\n${lines.join('\n')}` : `✅ No warnings in *${groupName}*`);
          }
          const w = database.getWarnings ? database.getWarnings(groupId, target) : null;
          const count = w?.count || 0;
          return replyToOwner(`⚠️ @${target.split('@')[0]} has *${count}/${config.maxWarnings || 3}* warning(s) in *${groupName}*`);
        }

        // CLEARWARNS
        case 'clearwarns': {
          const target = getTarget();
          if (!target) return replyToOwner('❌ Please mention a user.');
          database.clearWarnings(groupId, target);
          await replyToOwner(`✅ Warnings cleared for @${target.split('@')[0]} in *${groupName}*`);
          break;
        }

        // KICK / REMOVE
        case 'kick':
        case 'remove': {
          const target = getTarget();
          if (!target) return replyToOwner('❌ Please mention a user to kick. Example: .remote GroupName kick @237...');
          const found = findParticipant(participants, target);
          if (!found) return replyToOwner('❌ User not found in group.');
          if (found.admin) return replyToOwner('❌ Cannot kick an admin!');
          await sock.groupParticipantsUpdate(groupId, [target], 'remove');
          await sendInGroup({ text: `✅ @${target.split('@')[0]} has been kicked!`, mentions: [target] });
          await replyToOwner(`✅ @${target.split('@')[0]} kicked from *${groupName}*`);
          break;
        }

        // MUTE
        case 'mute': {
          await sock.groupSettingUpdate(groupId, 'announcement');
          await sendInGroup({ text: '🔇 *Group has been muted!* Only admins can send messages now.' });
          await replyToOwner(`✅ *${groupName}* has been muted.`);
          break;
        }

        // UNMUTE
        case 'unmute': {
          await sock.groupSettingUpdate(groupId, 'not_announcement');
          await sendInGroup({ text: '🔊 *Group has been unmuted!* Everyone can send messages now.' });
          await replyToOwner(`✅ *${groupName}* has been unmuted.`);
          break;
        }

        // PROMOTE
        case 'promote': {
          const target = getTarget();
          if (!target) return replyToOwner('❌ Please mention a user to promote.');
          const found = findParticipant(participants, target);
          if (!found) return replyToOwner('❌ User not found in group.');
          if (found.admin) return replyToOwner('❌ User is already an admin!');
          await sock.groupParticipantsUpdate(groupId, [target], 'promote');
          await sendInGroup({ text: `⭐ @${target.split('@')[0]} has been promoted to admin!`, mentions: [target] });
          await replyToOwner(`✅ @${target.split('@')[0]} promoted in *${groupName}*`);
          break;
        }

        // DEMOTE
        case 'demote': {
          const target = getTarget();
          if (!target) return replyToOwner('❌ Please mention a user to demote.');
          const found = findParticipant(participants, target);
          if (!found) return replyToOwner('❌ User not found in group.');
          if (!found.admin) return replyToOwner('❌ User is not an admin!');
          await sock.groupParticipantsUpdate(groupId, [target], 'demote');
          await sendInGroup({ text: `✅ @${target.split('@')[0]} is no longer an admin!`, mentions: [target] });
          await replyToOwner(`✅ @${target.split('@')[0]} demoted in *${groupName}*`);
          break;
        }

        // ANTILINK
        case 'antilink': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`🔗 Antilink in *${groupName}*: *${s.antilink ? 'ON' : 'OFF'}* | Action: *${s.antilinkAction || 'delete'}*`);
          }
          if (opt === 'on') database.updateGroupSettings(groupId, { antilink: true });
          else if (opt === 'off') database.updateGroupSettings(groupId, { antilink: false });
          else if (opt === 'set' && cmdArgs[1]) database.updateGroupSettings(groupId, { antilinkAction: cmdArgs[1], antilink: true });
          await replyToOwner(`✅ Antilink *${opt}* in *${groupName}*`);
          break;
        }

        // ANTISPAM
        case 'antispam': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`🛡️ Antispam in *${groupName}*: *${s.antispam ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { antispam: opt === 'on' });
          await replyToOwner(`✅ Antispam *${opt}* in *${groupName}*`);
          break;
        }

        // ANTITAG
        case 'antitag': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`🏷️ Antitag in *${groupName}*: *${s.antitag ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { antitag: opt === 'on' });
          await replyToOwner(`✅ Antitag *${opt}* in *${groupName}*`);
          break;
        }

        // ANTIGROUPMENTION
        case 'antigroupmention': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`📢 Anti @everyone in *${groupName}*: *${s.antigroupmention ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { antigroupmention: opt === 'on' });
          await replyToOwner(`✅ Antigroupmention *${opt}* in *${groupName}*`);
          break;
        }

        // WELCOME
        case 'welcome': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`👋 Welcome in *${groupName}*: *${s.welcome ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { welcome: opt === 'on' });
          await replyToOwner(`✅ Welcome *${opt}* in *${groupName}*`);
          break;
        }

        // GOODBYE
        case 'goodbye': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`👋 Goodbye in *${groupName}*: *${s.goodbye ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { goodbye: opt === 'on' });
          await replyToOwner(`✅ Goodbye *${opt}* in *${groupName}*`);
          break;
        }

        // SETNAME
        case 'setname': {
          const name = cmdArgs.join(' ');
          if (!name) return replyToOwner('❌ Please provide a new group name.');
          await sock.groupUpdateSubject(groupId, name);
          await replyToOwner(`✅ Group name changed to *${name}* in *${groupName}*`);
          break;
        }

        // SETDESC
        case 'setdesc': {
          const desc = cmdArgs.join(' ');
          if (!desc) return replyToOwner('❌ Please provide a new description.');
          await sock.groupUpdateDescription(groupId, desc);
          await replyToOwner(`✅ Description updated in *${groupName}*`);
          break;
        }

        // GROUPLINK
        case 'grouplink': {
          const code = await sock.groupInviteCode(groupId);
          await replyToOwner(`🔗 *Invite link for ${groupName}:*\nhttps://chat.whatsapp.com/${code}`);
          break;
        }

        // MEMBERS
        case 'members': {
          const admins = participants.filter(p => p.admin).map(p => `👑 @${p.id.split('@')[0]}`);
          const members = participants.filter(p => !p.admin).map(p => `👤 @${p.id.split('@')[0]}`);
          await replyToOwner(
            `👥 *Members of ${groupName}* (${participants.length})\n\n` +
            `*Admins (${admins.length}):*\n${admins.join('\n')}\n\n` +
            `*Members (${members.length}):*\n${members.slice(0, 30).join('\n')}` +
            (members.length > 30 ? `\n... and ${members.length - 30} more` : '')
          );
          break;
        }

        // SETTINGS
        case 'settings': {
          const s = database.getGroupSettings(groupId);
          const lines = Object.entries(s).map(([k, v]) => `│ *${k}*: ${v === true ? '✅ ON' : v === false ? '❌ OFF' : v}`);
          await replyToOwner(`⚙️ *Settings of ${groupName}:*\n${lines.join('\n')}`);
          break;
        }

        // AUTOSTICKER
        case 'autosticker': {
          const opt = cmdArgs[0]?.toLowerCase();
          if (!opt) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`🎭 Autosticker in *${groupName}*: *${s.autosticker ? 'ON' : 'OFF'}*`);
          }
          database.updateGroupSettings(groupId, { autosticker: opt === 'on' });
          await replyToOwner(`✅ Autosticker *${opt}* in *${groupName}*`);
          break;
        }

        // SETRULES / RULES
        case 'setrules':
        case 'rules': {
          const rules = cmdArgs.join(' ');
          if (!rules) {
            const s = database.getGroupSettings(groupId);
            return replyToOwner(`📜 *Rules of ${groupName}:*\n${s.rules || 'No rules set.'}`);
          }
          database.updateGroupSettings(groupId, { rules });
          await replyToOwner(`✅ Rules updated in *${groupName}*`);
          break;
        }

        // TAGADMINS
        case 'tagadmins': {
          const adminList = participants.filter(p => p.admin).map(p => p.id);
          if (!adminList.length) return replyToOwner(`❌ No admins found in *${groupName}*`);
          await sendInGroup({
            text: `📢 *Tagging Admins:*\n${adminList.map(j => `@${j.split('@')[0]}`).join(' ')}`,
            mentions: adminList
          });
          await replyToOwner(`✅ Admins tagged in *${groupName}*`);
          break;
        }

        // HIDETAG
        case 'hidetag': {
          const text = cmdArgs.join(' ') || '📢 Message to all members';
          const allJids = participants.map(p => p.id);
          await sendInGroup({ text, mentions: allJids });
          await replyToOwner(`✅ All members tagged silently in *${groupName}*`);
          break;
        }

        default:
          await replyToOwner(`❌ Command *${cmdName}* is not yet implemented for remote use.`);
      }

    } catch (error) {
      console.error('[REMOTE] Error:', error.message);
      await extra.reply('❌ Remote command failed: ' + error.message);
    }
  }
};
