/**
 * Outbound Flow Delay & Cooldown Manager (Formerly Anti-Ban Delay)
 * Helps smooth out successive fast client messages using randomized Gaussian delay jitter.
 */

const { gaussianDelay } = require("./antiban.js");

/**
 * Wait for a random duration with Gaussian distribution.
 * @param {number} min - Minimum delay in ms (default: 500)
 * @param {number} max - Maximum delay in ms (default: 1500)
 */
const randomDelay = (min = 500, max = 1500) => {
  const mean = (min + max) / 2;
  const stdDev = (max - min) / 6; // Covering 99% of sample space
  return gaussianDelay(mean, stdDev);
};

/**
 * Short delay — use between quick successive sends
 */
const shortDelay = () => gaussianDelay(500, 120);

/**
 * Medium delay — use before replying to commands
 */
const mediumDelay = () => gaussianDelay(1200, 250);

/**
 * Long delay — use before heavy actions (kick, promote, demote, etc.)
 */
const longDelay = () => gaussianDelay(2400, 450);

/**
 * Cooldown manager — prevents the same user from spamming a command
 */
const cooldowns = new Map();

/**
 * Check if a user is on cooldown for a specific command.
 * @param {string} userId - The user's JID
 * @param {string} commandName - The command name
 * @param {number} seconds - Cooldown duration in seconds (default: 5)
 * @returns {boolean} true if on cooldown, false if allowed
 */
function isOnCooldown(userId, commandName, seconds = 5) {
  const key = `${userId}_${commandName}`;
  const last = cooldowns.get(key) || 0;
  if (Date.now() - last < seconds * 1000) return true;
  cooldowns.set(key, Date.now());
  return false;
}

/**
 * Get remaining cooldown time in seconds.
 * @param {string} userId
 * @param {string} commandName
 * @param {number} seconds
 * @returns {number} remaining seconds
 */
function getCooldownRemaining(userId, commandName, seconds = 5) {
  const key = `${userId}_${commandName}`;
  const last = cooldowns.get(key) || 0;
  const remaining = Math.ceil((seconds * 1000 - (Date.now() - last)) / 1000);
  return remaining > 0 ? remaining : 0;
}

module.exports = {
  randomDelay,
  shortDelay,
  mediumDelay,
  longDelay,
  isOnCooldown,
  getCooldownRemaining
};
