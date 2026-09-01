/**
 * Mock Economy System - Nebula Bot Bridge
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'economy_db.json');

let economyData = {};

function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      economyData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load economy database:', e);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(economyData, null, 2));
  } catch (e) {
    console.error('Failed to save economy database:', e);
  }
}

loadData();

function ensureUser(sender) {
  const jid = String(sender);
  if (!economyData[jid]) {
    economyData[jid] = {
      coins: 2000, // Generous starting balance
      xp: 0,
      level: 1
    };
    saveData();
  }
  return economyData[jid];
}

module.exports = {
  getUser(sender) {
    return ensureUser(sender);
  },

  addCoins(sender, amount) {
    const user = ensureUser(sender);
    user.coins += Number(amount) || 0;
    saveData();
    return user;
  },

  removeCoins(sender, amount) {
    const user = ensureUser(sender);
    user.coins = Math.max(0, user.coins - (Number(amount) || 0));
    saveData();
    return user;
  },

  addXP(sender, amount) {
    const user = ensureUser(sender);
    user.xp += Number(amount) || 0;
    const nextLevelXP = user.level * 100;
    let leveledUp = false;
    if (user.xp >= nextLevelXP) {
      user.level += 1;
      user.xp -= nextLevelXP;
      leveledUp = true;
    }
    saveData();
    return { leveledUp, newLevel: user.level };
  }
};
