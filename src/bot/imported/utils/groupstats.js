/**
 * GroupStats Utility v2 — Nebula Bot by Dark Neon
 * Tracking étendu : messages, médias, commandes, streak, historique 7 jours
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../database/groupStats.json');
const BOT_PATH = path.join(__dirname, '../database/botStats.json');

// ── Helpers I/O ───────────────────────────────────────────────────────────────

function loadDB(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

function saveDB(file, data) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[groupStats] save error:', e.message);
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const hour  = () => new Date().getHours().toString();

// ── Group stats ───────────────────────────────────────────────────────────────

function addMessage(groupId, senderId, type = 'text') {
  const db  = loadDB(DB_PATH);
  const day = today();
  const h   = hour();

  if (!db[groupId]) db[groupId] = {};
  if (!db[groupId][day]) db[groupId][day] = { total: 0, users: {}, hours: {}, media: 0, commands: 0 };

  const g = db[groupId][day];
  g.total++;
  if (!g.users[senderId]) g.users[senderId] = { msgs: 0, media: 0, commands: 0, firstSeen: Date.now() };
  g.users[senderId].msgs++;
  g.hours[h] = (g.hours[h] || 0) + 1;

  if (type === 'media')   { g.media++;   g.users[senderId].media++;   }
  if (type === 'command') { g.commands++; g.users[senderId].commands++; }

  saveDB(DB_PATH, db);
}

function getStats(groupId, day = null) {
  const db  = loadDB(DB_PATH);
  const key = day || today();
  return db[groupId]?.[key] || null;
}

// Retourne les stats des 7 derniers jours pour un groupe
function getWeekStats(groupId) {
  const db = loadDB(DB_PATH);
  if (!db[groupId]) return [];

  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, data: db[groupId][key] || null });
  }
  return result;
}

// Top N membres sur les 7 derniers jours
function getWeekTopMembers(groupId, n = 10) {
  const week = getWeekStats(groupId);
  const totals = {};

  for (const { data } of week) {
    if (!data?.users) continue;
    for (const [uid, stats] of Object.entries(data.users)) {
      if (!totals[uid]) totals[uid] = { msgs: 0, media: 0, commands: 0 };
      totals[uid].msgs     += stats.msgs     || 0;
      totals[uid].media    += stats.media    || 0;
      totals[uid].commands += stats.commands || 0;
    }
  }

  return Object.entries(totals)
    .sort((a, b) => b[1].msgs - a[1].msgs)
    .slice(0, n)
    .map(([uid, s]) => ({ uid, ...s }));
}

// Heure la plus active d'un groupe aujourd'hui
function getPeakHour(groupId) {
  const stats = getStats(groupId);
  if (!stats?.hours) return null;
  const sorted = Object.entries(stats.hours).sort((a, b) => b[1] - a[1]);
  return sorted[0] ? { hour: parseInt(sorted[0][0]), count: sorted[0][1] } : null;
}

// Streak d'activité d'un membre (jours consécutifs)
function getMemberStreak(groupId, userId) {
  const db = loadDB(DB_PATH);
  if (!db[groupId]) return 0;

  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (db[groupId][key]?.users?.[userId]?.msgs > 0) {
      streak++;
    } else if (i > 0) {
      break; // streak cassée
    }
  }
  return streak;
}

// ── Bot-wide stats ────────────────────────────────────────────────────────────

function incrementBotStat(key, amount = 1) {
  const db = loadDB(BOT_PATH);
  db[key] = (db[key] || 0) + amount;
  if (!db.lastUpdated) db.lastUpdated = Date.now();
  db.lastUpdated = Date.now();
  saveDB(BOT_PATH, db);
}

function getBotStats() {
  return loadDB(BOT_PATH);
}

function setBotStat(key, value) {
  const db = loadDB(BOT_PATH);
  db[key] = value;
  saveDB(BOT_PATH, db);
}

module.exports = {
  addMessage,
  getStats,
  getWeekStats,
  getWeekTopMembers,
  getPeakHour,
  getMemberStreak,
  incrementBotStat,
  getBotStats,
  setBotStat
};
