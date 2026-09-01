/**
 * Updated database.js using atomic operations
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { atomicWrite, AtomicDatabase } = require('./utils/database-atomic');

const DB_PATH = path.join(__dirname, 'database');
const FILES = {
  GROUPS: path.join(DB_PATH, 'groups.json'),
  USERS: path.join(DB_PATH, 'users.json'),
  WARNINGS: path.join(DB_PATH, 'warnings.json'),
  MODS: path.join(DB_PATH, 'mods.json')
};

// Create database directory
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize atomic database
const db = new AtomicDatabase();

// Initialize all files - Using sync versions for startup to avoid race conditions
const initDBSync = (filePath, defaultData = {}) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    db.cache.set(filePath, defaultData);
  } else {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      db.cache.set(filePath, JSON.parse(data));
    } catch (e) {
      console.error(`[Database] Failed to load ${filePath}:`, e.message);
      db.cache.set(filePath, defaultData);
    }
  }
};

// Initialize at startup (synchronously)
initDBSync(FILES.GROUPS, {});
initDBSync(FILES.USERS, {});
initDBSync(FILES.WARNINGS, {});
initDBSync(FILES.MODS, { moderators: [] });
console.log('✅ Database initialized with atomic operations');

// Flush to disk every 5 seconds (more frequent than before for better durability)
setInterval(async () => {
  if (db.dirty.size === 0) return;
  
  const results = await db.flush();
  const failed = results.filter(r => !r.success);

  if (failed.length > 0) {
    console.error('[Database] Flush errors:', failed);
  }
}, 5000);

// Final flush on exit - Using synchronous writes for the exit handler
const flushSync = () => {
  if (db.dirty.size === 0) return;
  console.log('[Database] Final flush on exit...');
  for (const filePath of db.dirty) {
    try {
      const data = db.cache.get(filePath);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`[Database] Final flush error for ${filePath}:`, e.message);
    }
  }
};

process.on('exit', flushSync);
process.on('SIGINT', () => {
  flushSync();
  process.exit();
});
process.on('SIGTERM', () => {
  flushSync();
  process.exit();
});

// Helper: Get data from cache
const getData = (filePath) => db.get(filePath) || {};

// Helper: Update data in cache and mark as dirty
const setData = (filePath, data) => {
  db.set(filePath, data);
  return true;
};

// --- Group Settings ---
const getGroupSettings = (groupId) => {
  const groups = getData(FILES.GROUPS);
  if (!groups[groupId]) {
    groups[groupId] = { ...config.defaultGroupSettings };
    setData(FILES.GROUPS, groups);
  }
  return groups[groupId];
};

const updateGroupSettings = (groupId, settings) => {
  const groups = getData(FILES.GROUPS);
  groups[groupId] = { ...groups[groupId], ...settings };
  return setData(FILES.GROUPS, groups);
};

// --- User Data ---
const getUser = (userId) => {
  const users = getData(FILES.USERS);
  if (!users[userId]) {
    users[userId] = {
      registered: Date.now(),
      premium: false,
      banned: false
    };
    setData(FILES.USERS, users);
  }
  return users[userId];
};

const updateUser = (userId, data) => {
  const users = getData(FILES.USERS);
  users[userId] = { ...users[userId], ...data };
  return setData(FILES.USERS, users);
};

// --- Warnings System ---
const getWarnings = (groupId, userId) => {
  const warnings = getData(FILES.WARNINGS);
  const key = `${groupId}_${userId}`;
  return warnings[key] || { count: 0, warnings: [] };
};

const addWarning = (groupId, userId, reason) => {
  const warnings = getData(FILES.WARNINGS);
  const key = `${groupId}_${userId}`;
  
  if (!warnings[key]) {
    warnings[key] = { count: 0, warnings: [] };
  }
  
  warnings[key].count++;
  warnings[key].warnings.push({
    reason,
    date: Date.now()
  });
  
  setData(FILES.WARNINGS, warnings);
  return warnings[key];
};

const removeWarning = (groupId, userId) => {
  const warnings = getData(FILES.WARNINGS);
  const key = `${groupId}_${userId}`;
  
  if (warnings[key] && warnings[key].count > 0) {
    warnings[key].count--;
    warnings[key].warnings.pop();
    setData(FILES.WARNINGS, warnings);
    return true;
  }
  return false;
};

const clearWarnings = (groupId, userId) => {
  const warnings = getData(FILES.WARNINGS);
  const key = `${groupId}_${userId}`;
  delete warnings[key];
  return setData(FILES.WARNINGS, warnings);
};

// --- Moderators System ---
const getModerators = () => {
  const mods = getData(FILES.MODS);
  return mods.moderators || [];
};

const addModerator = (userId) => {
  const mods = getData(FILES.MODS);
  if (!mods.moderators) mods.moderators = [];
  if (!mods.moderators.includes(userId)) {
    mods.moderators.push(userId);
    return setData(FILES.MODS, mods);
  }
  return false;
};

const removeModerator = (userId) => {
  const mods = getData(FILES.MODS);
  if (mods.moderators) {
    mods.moderators = mods.moderators.filter(id => id !== userId);
    return setData(FILES.MODS, mods);
  }
  return false;
};

const isModerator = (userId) => {
  const mods = getModerators();
  return mods.includes(userId);
};

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  getUser,
  updateUser,
  getWarnings,
  addWarning,
  removeWarning,
  clearWarnings,
  getModerators,
  addModerator,
  removeModerator,
  isModerator,
  // Added raw access
  getGroups: () => db.get(FILES.GROUPS),
  getUsers: () => db.get(FILES.USERS),
  getWarningsRaw: () => db.get(FILES.WARNINGS),
  getMods: () => db.get(FILES.MODS),
  setGroups: (data) => db.set(FILES.GROUPS, data),
  setUsers: (data) => db.set(FILES.USERS, data),
  setWarningsRaw: (data) => db.set(FILES.WARNINGS, data),
  setMods: (data) => db.set(FILES.MODS, data),
  flush: async () => await db.flush()
};
