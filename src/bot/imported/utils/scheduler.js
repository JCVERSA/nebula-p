/**
 * Cron Scheduler — Nebula Bot by Dark Neon
 *
 * Gère toutes les tâches automatiques planifiées du bot.
 * Utilise node-cron pour programmer des actions récurrentes.
 *
 * Tâches système (toujours actives) :
 *   1. Message de bonjour quotidien à 9h (activable par groupe)
 *   2. Rappel des règles hebdomadaire lundi 10h (activable par groupe)
 *   3. Nettoyage des warns expirés chaque dimanche
 *   4. Rapport d'activité quotidien à 23h (activable par groupe)
 *   5. Passage hors ligne toutes les 30 min (anti-ban)
 *   6. Log de statut toutes les 6h
 *
 * Tâches utilisateur (créées via .schedule) :
 *   - Persistées dans database/schedules.json
 *   - Rechargées automatiquement après redémarrage
 */

const cron     = require('node-cron');
const neonGame = require('./neonGame');
const fs       = require('fs');
const path     = require('path');
const database = require('../database');
const config   = require('../config');

const SCHEDULES_FILE = path.join(__dirname, '../database/schedules.json');
const TZ = config.timezone || 'Europe/Paris';

// Référence au socket Baileys
let _sock = null;

// Tâches utilisateur actives en mémoire
const userTasks = new Map();

// ─── Helpers fichier ──────────────────────────────────────────────────────────

function loadUserSchedules() {
  try {
    if (!fs.existsSync(SCHEDULES_FILE)) {
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveUserSchedules(schedules) {
  try {
    const dir = path.dirname(SCHEDULES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
  } catch (e) {
    console.error('[Scheduler] Error saving schedules:', e.message);
  }
}

function generateId() {
  return `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Convertit le format lisible en expression cron ──────────────────────────
/**
 * Formats supportés :
 *   every 30m           → toutes les 30 minutes
 *   every 2h            → toutes les 2 heures
 *   daily 09:00         → tous les jours à 9h
 *   weekly mon 09:00    → tous les lundis à 9h
 *   monthly 1 09:00     → le 1er de chaque mois à 9h
 */
function parseToCron(expression) {
  const expr = expression.toLowerCase().trim();

  const everyMin = expr.match(/^every\s+(\d+)m$/);
  if (everyMin) {
    const m = parseInt(everyMin[1]);
    if (m < 1 || m > 59) throw new Error('Minutes must be between 1 and 59');
    return `*/${m} * * * *`;
  }

  const everyHour = expr.match(/^every\s+(\d+)h$/);
  if (everyHour) {
    const h = parseInt(everyHour[1]);
    if (h < 1 || h > 23) throw new Error('Hours must be between 1 and 23');
    return `0 */${h} * * *`;
  }

  const daily = expr.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    const h = parseInt(daily[1]), m = parseInt(daily[2]);
    if (h > 23 || m > 59) throw new Error('Invalid time format');
    return `${m} ${h} * * *`;
  }

  const days = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
  const weekly = expr.match(/^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}):(\d{2})$/);
  if (weekly) {
    const d = days[weekly[1]], h = parseInt(weekly[2]), m = parseInt(weekly[3]);
    if (h > 23 || m > 59) throw new Error('Invalid time format');
    return `${m} ${h} * * ${d}`;
  }

  const monthly = expr.match(/^monthly\s+(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (monthly) {
    const day = parseInt(monthly[1]), h = parseInt(monthly[2]), m = parseInt(monthly[3]);
    if (day < 1 || day > 28) throw new Error('Day must be between 1 and 28');
    if (h > 23 || m > 59) throw new Error('Invalid time format');
    return `${m} ${h} ${day} * *`;
  }

  throw new Error(
    'Invalid format! Supported:\n' +
    '  every 30m | every 2h\n' +
    '  daily 09:00\n' +
    '  weekly mon 09:00\n' +
    '  monthly 1 09:00'
  );
}

// ─── Démarrer une tâche utilisateur ──────────────────────────────────────────

function startUserTask(schedule) {
  if (!_sock) return;
  try {
    if (!cron.validate(schedule.cronExpr)) {
      console.warn(`[Scheduler] Invalid cron for ${schedule.id}: ${schedule.cronExpr}`);
      return;
    }
    const task = cron.schedule(schedule.cronExpr, async () => {
      try {
        await _sock.sendMessage(schedule.groupId, { text: schedule.message });
        console.log(`[Scheduler] ✅ Sent task ${schedule.id} to ${schedule.groupId}`);
      } catch (e) {
        console.error(`[Scheduler] ❌ Failed task ${schedule.id}:`, e.message);
      }
    }, { timezone: TZ });
    userTasks.set(schedule.id, task);
  } catch (e) {
    console.error(`[Scheduler] Error starting task ${schedule.id}:`, e.message);
  }
}

// ─── API publique pour les commandes ─────────────────────────────────────────

function addSchedule({ groupId, groupName, createdBy, expression, message }) {
  const cronExpr = parseToCron(expression); // Lance une erreur si invalide
  const id = generateId();
  const schedule = { id, groupId, groupName, createdBy, expression, cronExpr, message, createdAt: Date.now() };
  const schedules = loadUserSchedules();
  schedules.push(schedule);
  saveUserSchedules(schedules);
  startUserTask(schedule);
  return schedule;
}

function removeSchedule(id) {
  const task = userTasks.get(id);
  if (task) { task.stop(); userTasks.delete(id); }
  const all = loadUserSchedules();
  const filtered = all.filter(s => s.id !== id);
  saveUserSchedules(filtered);
  return all.length !== filtered.length;
}

function getGroupSchedules(groupId) {
  return loadUserSchedules().filter(s => s.groupId === groupId);
}

function getAllSchedules() {
  return loadUserSchedules();
}

// ─── Tâches système ───────────────────────────────────────────────────────────

async function sendDailyGoodMorning() {
  if (!_sock) return;
  try {
    const groups = await _sock.groupFetchAllParticipating();
    const messages = [
      '🌅 *Good morning everyone!* Have a wonderful day! ☀️',
      '🌞 *Rise and shine!* Wishing you all a productive day! 💪',
      '👋 *Good morning!* Hope everyone has an amazing day ahead! 🌟',
      '🌄 *Morning everyone!* Let\'s make today count! 🚀',
      '☀️ *Good morning!* Stay positive and have a great day! 😊'
    ];
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    let sent = 0;
    for (const groupId of Object.keys(groups)) {
      try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.dailygreeting) continue;
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
        await _sock.sendMessage(groupId, { text: `${randomMsg}\n\n> _Powered by ${config.botName}_` });
        sent++;
      } catch (e) { /* silencieux par groupe */ }
    }
    if (sent > 0) console.log(`[Cron] Good morning sent to ${sent} groups`);
  } catch (e) {
    console.error('[Cron] Good morning error:', e.message);
  }
}

async function sendWeeklyRules() {
  if (!_sock) return;
  try {
    const groups = await _sock.groupFetchAllParticipating();
    let sent = 0;
    for (const groupId of Object.keys(groups)) {
      try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.weeklyrules || !settings.rules) continue;
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
        const meta = await _sock.groupMetadata(groupId);
        await _sock.sendMessage(groupId, {
          text: `📋 *Weekly Rules Reminder*\n📌 ${meta.subject}\n\n${settings.rules}\n\n> _Please follow the rules!_ 🙏`
        });
        sent++;
      } catch (e) { /* silencieux par groupe */ }
    }
    if (sent > 0) console.log(`[Cron] Weekly rules sent to ${sent} groups`);
  } catch (e) {
    console.error('[Cron] Weekly rules error:', e.message);
  }
}

async function cleanExpiredWarnings() {
  try {
    const warningsPath = path.join(__dirname, '../database/warnings.json');
    if (!fs.existsSync(warningsPath)) return;
    const warnings = JSON.parse(fs.readFileSync(warningsPath, 'utf-8'));
    const expiryMs = 30 * 24 * 60 * 60 * 1000; // 30 jours
    const now = Date.now();
    let cleaned = 0;
    for (const key of Object.keys(warnings)) {
      const entry = warnings[key];
      if (!entry.warnings || entry.warnings.length === 0) { delete warnings[key]; cleaned++; continue; }
      const before = entry.warnings.length;
      entry.warnings = entry.warnings.filter(w => now - w.date < expiryMs);
      entry.count = entry.warnings.length;
      cleaned += before - entry.warnings.length;
      if (entry.count === 0) delete warnings[key];
    }
    fs.writeFileSync(warningsPath, JSON.stringify(warnings, null, 2));
    console.log(`[Cron] Cleaned ${cleaned} expired warning(s)`);
  } catch (e) {
    console.error('[Cron] Warning cleanup error:', e.message);
  }
}

async function sendDailyActivityReport() {
  if (!_sock) return;
  try {
    const statsPath = path.join(__dirname, '../database/groupstats.json');
    if (!fs.existsSync(statsPath)) return;
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    const groups = await _sock.groupFetchAllParticipating();
    const today = new Date().toISOString().split('T')[0];
    let sent = 0;
    for (const groupId of Object.keys(groups)) {
      try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.dailyreport) continue;
        const groupStats = stats[groupId]?.[today];
        if (!groupStats) continue;
        const sorted = Object.entries(groupStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (sorted.length === 0) continue;
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
        const meta = await _sock.groupMetadata(groupId);
        const mentions = sorted.map(([jid]) => jid);
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        let text = `📊 *Daily Activity Report*\n📌 ${meta.subject} — ${today}\n\n🏆 *Top 5 Most Active:*\n\n`;
        sorted.forEach(([jid, count], i) => {
          text += `${medals[i]} @${jid.split('@')[0]} — *${count}* messages\n`;
        });
        text += `\n> _Keep it up! See you tomorrow_ 💪`;
        await _sock.sendMessage(groupId, { text, mentions });
        sent++;
      } catch (e) { /* silencieux par groupe */ }
    }
    if (sent > 0) console.log(`[Cron] Activity report sent to ${sent} groups`);
  } catch (e) {
    console.error('[Cron] Activity report error:', e.message);
  }
}

// ─── Initialisation principale ────────────────────────────────────────────────

function initScheduler(sock) {
  _sock = sock;
  console.log('[Scheduler] 🔄 Initializing...');

  // Tâches système
  cron.schedule('0 9 * * *',   () => sendDailyGoodMorning(),    { timezone: TZ }); // Bonjour quotidien
  cron.schedule('0 10 * * 1',  () => sendWeeklyRules(),          { timezone: TZ }); // Règles lundi
  cron.schedule('0 0 * * 0',   () => cleanExpiredWarnings(),     { timezone: TZ }); // Nettoyage warns
  cron.schedule('0 23 * * *',  () => sendDailyActivityReport(),  { timezone: TZ }); // Rapport activité
  cron.schedule('*/30 * * * *', async () => {                                        // Anti-ban offline
    try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
  });
  // NeonGame : mini-jeu toutes les 2h
  cron.schedule('0 */2 * * *', async () => {
    try {
      const groups = await sock.groupFetchAllParticipating();
      const challenge = neonGame.getNextChallenge();

      for (const groupId of Object.keys(groups)) {
        try {
          neonGame.startSession(groupId, challenge);

          const msg = challenge.type === 'emoji'
            ? `🎮 *NEONGAME — DÉFI !*\n\nPremier à taper *.me ${challenge.display}* gagne *200 🪙* !\n\n⏳ *5 minutes* pour répondre !\n🔥 3 victoires de suite = *+5 000 🪙 bonus* !`
            : `🎮 *NEONGAME — DÉFI ORTHOGRAPHE !*\n\nPremier à écrire correctement :\n\n${challenge.display}\n\nTape *.me <le_mot>* pour gagner *200 🪙* !\n\n⏳ *5 minutes* pour répondre !\n🔥 3 victoires de suite = *+5 000 🪙 bonus* !`;

          await sock.sendMessage(groupId, { text: msg });
        } catch {}
      }
    } catch(e) {
      console.error('[NeonGame] Erreur envoi défi:', e.message);
    }
  }, { timezone: TZ }); // NeonGame toutes les 2h

  cron.schedule('0 */6 * * *', () => {                                               // Log statut
    const mb  = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const up  = process.uptime();
    const h   = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
    console.log(`[Scheduler] 📊 Uptime: ${h}h${m}m | Memory: ${mb}MB | User tasks: ${userTasks.size}`);
  });

  // Recharger les tâches utilisateur sauvegardées
  const saved = loadUserSchedules();
  if (saved.length > 0) {
    console.log(`[Scheduler] 📋 Reloading ${saved.length} saved task(s)...`);
    for (const schedule of saved) startUserTask(schedule);
  }

  console.log('✅ Scheduler ready:');
  console.log('   🌅 Good morning        → Every day at 9:00 AM');
  console.log('   📋 Weekly rules        → Every Monday at 10:00 AM');
  console.log('   🧹 Warns cleanup       → Every Sunday at midnight');
  console.log('   📊 Activity report     → Every day at 11:00 PM');
  console.log('   🛡️  Offline presence    → Every 30 minutes');
  console.log(`   📂 User tasks loaded   → ${saved.length} task(s)`);
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  initScheduler,
  addSchedule,
  removeSchedule,
  getGroupSchedules,
  getAllSchedules,
  parseToCron
};
