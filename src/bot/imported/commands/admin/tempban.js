// Nebula Bot by Dark Neon
/**
 * TempBan Command — Ban temporaire avec unban automatique
 * Stocke les bans dans la DB et un timer en mémoire pour l'unban
 */

const database = require('../../database');
const { findParticipant, getLidMappingValue, normalizeJidWithLid } = require('../../utils/jidHelper');
const { longDelay } = require('../../utils/antibanDelay');
const fs   = require('fs');
const path = require('path');

// ── Fichier persistant pour les tempbans (survit aux redémarrages) ────────────
const DB_PATH    = path.join(__dirname, '../../database');
const TBANS_FILE = path.join(DB_PATH, 'tempbans.json');

if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
if (!fs.existsSync(TBANS_FILE)) fs.writeFileSync(TBANS_FILE, '{}');

function readTBans()        { try { return JSON.parse(fs.readFileSync(TBANS_FILE, 'utf8')); } catch { return {}; } }
function writeTBans(data)   { fs.writeFileSync(TBANS_FILE, JSON.stringify(data, null, 2)); }

// ── Timers actifs en mémoire ──────────────────────────────────────────────────
const activeTimers = new Map(); // key: `${groupId}_${userId}` → timeout

// ── Helpers durée ─────────────────────────────────────────────────────────────
const UNITS = { s: 1, m: 60, h: 3600, d: 86400, j: 86400 };

function parseDuration(str) {
  const match = str.trim().match(/^(\d+)(s|m|h|d|j)?$/i);
  if (!match) return null;
  const val  = parseInt(match[1]);
  const unit = (match[2] || 'h').toLowerCase();
  const mult = UNITS[unit] || 3600;
  return val * mult * 1000; // en ms
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}min`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}j`;
}

// ── Unban automatique ─────────────────────────────────────────────────────────
// Résoudre un LID vers un JID @s.whatsapp.net utilisable
async function resolveLidToJid(sock, lid) {
  // Déjà un JID standard
  if (!lid.includes('@lid')) return lid;

  const user = lid.split('@')[0];

  // 1. Essai via mapping fichier
  const mapped = getLidMappingValue(user, 'lidToPn');
  if (mapped) return `${mapped}@s.whatsapp.net`;

  // 2. Essai via normalizeJidWithLid
  try {
    const normalized = normalizeJidWithLid(lid);
    if (normalized && normalized.includes('@s.whatsapp.net')) return normalized;
  } catch {}

  // 3. Essai via sock.getContactInfo
  try {
    const info = await sock.getContactInfo(lid).catch(() => null);
    if (info?.phoneNumber) return `${info.phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  } catch {}

  // 4. Impossible à résoudre — retourner null pour éviter bad-request
  console.warn(`[TempBan] Impossible de résoudre le LID: ${lid}`);
  return null;
}

async function scheduleUnban(sock, groupId, userId, ms, reason) {
  const key = `${groupId}_${userId}`;

  // Annuler un timer existant si re-ban
  if (activeTimers.has(key)) clearTimeout(activeTimers.get(key));

  const timer = setTimeout(async () => {
    try {
      // Résoudre le LID si nécessaire avant le re-add
      let jidToAdd = userId;
      if (userId.includes('@lid')) {
        jidToAdd = await resolveLidToJid(sock, userId);
        if (!jidToAdd) {
          console.warn(`[TempBan] Unban annulé pour LID non résolvable: ${userId}`);
          // Nettoyer quand même la DB
          const tbans = readTBans();
          delete tbans[key];
          writeTBans(tbans);
          activeTimers.delete(key);
          return;
        }
      }

      // Ré-ajouter le membre
      await sock.groupParticipantsUpdate(groupId, [jidToAdd], 'add');
      console.log(`[TempBan] Unban automatique: ${userId} (${jidToAdd}) dans ${groupId}`);

      // Notifier le groupe
      await sock.sendMessage(groupId, {
        text: `✅ @${userId.split('@')[0]} a été débanni automatiquement.\n_Fin de la durée de ban._`,
        mentions: [userId]
      });

      // Supprimer de la DB
      const tbans = readTBans();
      delete tbans[key];
      writeTBans(tbans);
      activeTimers.delete(key);
    } catch (e) {
      console.error(`[TempBan] Erreur unban ${userId}:`, e.message);
    }
  }, ms);

  activeTimers.set(key, timer);
}

// ── Restaurer les timers au démarrage ─────────────────────────────────────────
function restoreTimers(sock) {
  const tbans = readTBans();
  const now   = Date.now();

  for (const [key, ban] of Object.entries(tbans)) {
    const remaining = ban.unbanAt - now;

    // Log pour debug
    const isLid = ban.userId?.includes('@lid');
    if (isLid) {
      console.warn(`[TempBan] Entrée LID détectée: ${ban.userId} — la résolution se fera à l'unban`);
    }

    if (remaining <= 0) {
      // Unban immédiat (bot était éteint pendant le ban)
      scheduleUnban(sock, ban.groupId, ban.userId, 1000, ban.reason);
    } else {
      scheduleUnban(sock, ban.groupId, ban.userId, remaining, ban.reason);
      console.log(`[TempBan] Timer restauré pour ${ban.userId} — ${formatDuration(remaining)} restant`);
    }
  }
}

// ── Module principal ──────────────────────────────────────────────────────────
module.exports = {
  name: 'tempban',
  aliases: ['tban', 'tb', 'bantemp'],
  category: 'admin',
  description: 'Ban temporaire d\'un membre avec unban automatique',
  usage: '.tempban @user <durée> [raison]\nDurées: 30m, 2h, 1d, 7j...',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  // Exposé pour être appelé au démarrage depuis index.js
  restoreTimers,

  async execute(sock, msg, args, extra) {
    try {
      const ctx       = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];

      // ── Afficher la liste des bans actifs si pas d'args ──
      if (!args[0] && mentioned.length === 0) {
        const tbans   = readTBans();
        const groupBans = Object.values(tbans).filter(b => b.groupId === extra.from);

        if (!groupBans.length) {
          return extra.reply('✅ Aucun ban temporaire actif dans ce groupe.');
        }

        const now   = Date.now();
        const lines = groupBans.map(b => {
          const left = formatDuration(Math.max(0, b.unbanAt - now));
          return `• @${b.userId.split('@')[0]} — ⏱ ${left} restant\n  📝 ${b.reason}`;
        });

        return await sock.sendMessage(extra.from, {
          text: `⛔ *Bans temporaires actifs (${groupBans.length})*\n\n${lines.join('\n\n')}`,
          mentions: groupBans.map(b => b.userId)
        }, { quoted: msg });
      }

      // ── Résoudre la cible ──
      let target = mentioned[0] || null;
      let durationStr, reason;

      if (target) {
        // .tempban @user 2h raison
        durationStr = args.find(a => parseDuration(a) !== null) || '1h';
        reason = args.filter(a => !a.startsWith('@') && !parseDuration(a)).join(' ') || 'Aucune raison';
      } else {
        // Pas de mention — vérifier si args[0] est un numéro brut
        const numArg = args[0]?.replace(/[^0-9]/g, '');
        if (numArg && numArg.length >= 6) {
          target = `${numArg}@s.whatsapp.net`;
          durationStr = args[1] || '1h';
          reason = args.slice(2).join(' ') || 'Aucune raison';
        } else {
          return extra.reply(
            '❌ Mentionne un utilisateur!\n\n' +
            'Usage: *.tempban @user 2h raison*\n\n' +
            'Exemples de durées:\n' +
            '  30m = 30 minutes\n' +
            '  2h  = 2 heures\n' +
            '  1d  = 1 jour\n' +
            '  7j  = 7 jours'
          );
        }
      }

      const durationMs = parseDuration(durationStr);
      if (!durationMs) {
        return extra.reply(
          `❌ Durée invalide: *${durationStr}*\n\n` +
          `Exemples valides: 30m, 2h, 1d, 7j`
        );
      }

      if (durationMs > 30 * 24 * 3600 * 1000) {
        return extra.reply('❌ Durée maximum: 30 jours.');
      }

      // ── Vérifications ──
      if (target === extra.sender) return extra.reply('❌ Tu ne peux pas te banni toi-même!');

      const metadata = await sock.groupMetadata(extra.from);
      const found    = findParticipant(metadata.participants, target);
      if (!found) return extra.reply('❌ Utilisateur introuvable dans le groupe.');
      if (found.admin) return extra.reply('❌ Impossible de banni un admin!');

      // Préférer le phoneNumber JID (@s.whatsapp.net) au LID pour le stockage
      // car l'API groupParticipantsUpdate n'accepte pas les LIDs pour le re-add
      if (found.phoneNumber && found.phoneNumber.includes('@s.whatsapp.net')) {
        target = found.phoneNumber;
      } else if (found.id && !found.id.includes('@lid')) {
        target = found.id;
      } else {
        // LID — on tente de résoudre maintenant
        const resolved = normalizeJidWithLid(found.id);
        target = (resolved && !resolved.includes('@lid')) ? resolved : found.id;
      }

      // ── Kick + programmer l'unban ──
      await longDelay();
      await sock.groupParticipantsUpdate(extra.from, [target], 'remove');

      const unbanAt = Date.now() + durationMs;
      const key     = `${extra.from}_${target}`;

      // Sauvegarder dans DB
      const tbans   = readTBans();
      tbans[key]    = { groupId: extra.from, userId: target, unbanAt, reason, bannedBy: extra.sender, bannedAt: Date.now() };
      writeTBans(tbans);

      // Programmer l'unban
      await scheduleUnban(sock, extra.from, target, durationMs, reason);

      await sock.sendMessage(extra.from, {
        text:
          `⛔ *Ban Temporaire*\n\n` +
          `👤 @${target.split('@')[0]} a été banni!\n` +
          `⏱️ Durée: *${formatDuration(durationMs)}*\n` +
          `📝 Raison: ${reason}\n` +
          `🔓 Unban automatique dans: *${formatDuration(durationMs)}*`,
        mentions: [target]
      }, { quoted: msg });

    } catch (error) {
      console.error('[TempBan] Error:', error.message);
      await extra.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
