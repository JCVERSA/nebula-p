/**
 * Client Congestion Controller & Rate Limiter (Formerly Antiban Security System)
 * Version 3.0 — High-Reliability Flow-Control and Congestion Manager
 *
 * Implements industry-standard traffic shaping to keep the bot's network requests
 * smooth, steady, and resilient:
 *  1. Token Bucket Algorithm for global outbound flow rate shaping (throttling).
 *  2. Gaussian Noise Jittering to distribute outbound timings and reduce traffic storms.
 *  3. Progressive Sliding-Window Rate Limiting (user command monitoring).
 *  4. Client-side Circuit Breaker to suspend delivery if successive transport errors occur.
 *  5. Thread-Safe Priority Dispatch Queue for heavy bulk operations.
 */

// ─── 1. TRAFFIC SHAPING JITTER (GAUSSIAN NOISE) ──────────────────────────────

/**
 * Generates an elegant, randomized delay using Box-Muller transform for a Gaussian
 * (normal) distribution. This ensures delays mimic organic client interaction curves,
 * avoiding the predictable profile of flat random/uniform delays.
 * @param {number} mean - Center of the bell curve (in ms)
 * @param {number} stdDev - Spread/variance of the distribution
 */
function gaussianDelay(mean = 1200, stdDev = 300) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.5 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.max(150, Math.round(mean + z * stdDev));
  return new Promise(r => setTimeout(r, ms));
}

const shortDelay  = () => gaussianDelay(600, 150);
const mediumDelay = () => gaussianDelay(1400, 350);
const longDelay   = () => gaussianDelay(2500, 600);
const heavyDelay  = () => gaussianDelay(4500, 1000);

// ─── 2. ADAPTIVE TIMEZONE SCALE ────────────────────────────────────────────────

/**
 * Returns a scaling factor based on the hour of the day.
 * Slows down batch queues and schedules during off-peak hours (nighttime) to align
 * with normal localized usage profiles.
 */
function getTimeOfDayScale() {
  const h = new Date().getHours();
  if (h >= 0 && h < 6) return 2.5;  // Late night / Off-peak
  if (h >= 23 || h < 8) return 1.6; // Evening / Early morning
  return 1.0;                       // Working hours standard
}

const adaptiveDelay = (min, max) => {
  const scale = getTimeOfDayScale();
  const minWithJitter = min * scale;
  const maxWithJitter = max * scale;
  return new Promise(r => {
    const delay = Math.floor(Math.random() * (maxWithJitter - minWithJitter + 1)) + minWithJitter;
    setTimeout(r, delay);
  });
};

// ─── 3. OUTBOUND FLOW RATE SHAPER (TOKEN BUCKET ENGINE) ─────────────────────────

const tokenBucket = {
  tokens: 25,
  maxCapacity: 25,
  refillRate: 1, // Refills 1 token per 2.4 seconds (equivalent to max 25 messages per minute)
  refillIntervalMs: 2400,
  lastRefillTime: Date.now(),
};

/**
 * Refills tokens based on elapsed duration.
 */
function refillTokens() {
  const now = Date.now();
  const elapsed = now - tokenBucket.lastRefillTime;
  if (elapsed >= tokenBucket.refillIntervalMs) {
    const refillAmount = Math.floor(elapsed / tokenBucket.refillIntervalMs) * tokenBucket.refillRate;
    tokenBucket.tokens = Math.min(tokenBucket.maxCapacity, tokenBucket.tokens + refillAmount);
    tokenBucket.lastRefillTime = now - (elapsed % tokenBucket.refillIntervalMs);
  }
}

/**
 * Global outbound rate shaper. Blocks execution asynchronously if the client is 
 * exceeding the token bucket's capacity, distributing flow smoothly.
 */
async function throttleOutbound() {
  refillTokens();

  if (tokenBucket.tokens < 1) {
    // Calculate precise time to wait for the next token refill
    const now = Date.now();
    const timeUntilNextRefill = Math.max(100, tokenBucket.refillIntervalMs - (now - tokenBucket.lastRefillTime));
    console.warn(`[Congestion Shaper] Flow rate exceeded. Throttling outbound message for ${Math.round(timeUntilNextRefill)}ms...`);
    await new Promise(r => setTimeout(r, timeUntilNextRefill));
    
    // Recurse to re-check after wait
    return throttleOutbound();
  }

  tokenBucket.tokens--;
}

// ─── 4. SLIDING-WINDOW COMMAND RATE LIMITER ─────────────────────────────────────

const rateLimitMap = new Map();
const LIMITS = { MAX: 8, WINDOW_MS: 10000, BASE_COOLDOWN: 30000, MAX_COOLDOWN: 300000 };

/**
 * Monitors user command rates using sliding intervals with exponential backoff on violations.
 */
function isRateLimited(userId) {
  const now = Date.now();
  let status = rateLimitMap.get(userId) || { count: 0, windowStart: now, blockedUntil: null, strikes: 0 };

  if (status.blockedUntil) {
    if (now < status.blockedUntil) return true;
    status.blockedUntil = null;
    status.count = 0;
    status.windowStart = now;
  }

  if (now - status.windowStart > LIMITS.WINDOW_MS) {
    status.count = 1;
    status.windowStart = now;
    rateLimitMap.set(userId, status);
    return false;
  }

  status.count++;
  if (status.count > LIMITS.MAX) {
    status.strikes++;
    const cooldown = Math.min(LIMITS.BASE_COOLDOWN * Math.pow(2, status.strikes - 1), LIMITS.MAX_COOLDOWN);
    status.blockedUntil = now + cooldown;
    console.warn(`[Rate Limiter] User ${userId} violated command rate limit. Backoff cooldown applied: ${Math.round(cooldown / 1000)}s.`);
    rateLimitMap.set(userId, status);
    return true;
  }

  rateLimitMap.set(userId, status);
  return false;
}

function getRateLimitRemaining(userId) {
  const status = rateLimitMap.get(userId);
  if (!status || !status.blockedUntil) return 0;
  return Math.max(0, Math.ceil((status.blockedUntil - Date.now()) / 1000));
}

// Clean up stale rate limiting entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, status] of rateLimitMap.entries()) {
    if (now - status.windowStart > LIMITS.WINDOW_MS * 4 && (!status.blockedUntil || now > status.blockedUntil)) {
      rateLimitMap.delete(userId);
    }
  }
}, 3 * 60 * 1000).unref();

// ─── 5. COOLDOWNS PER COMMAND ──────────────────────────────────────────────────

const cooldownMap = new Map();

function isOnCooldown(userId, cmd, secs = 5) {
  const key = `${userId}_${cmd}`;
  const last = cooldownMap.get(key) || 0;
  if (Date.now() - last < secs * 1000) return true;
  cooldownMap.set(key, Date.now());
  return false;
}

function getCooldownRemaining(userId, cmd, secs = 5) {
  const key = `${userId}_${cmd}`;
  const last = cooldownMap.get(key) || 0;
  return Math.max(0, Math.ceil(secs - (Date.now() - last) / 1000));
}

// ─── 6. TRANSPORT CIRCUIT BREAKER ───────────────────────────────────────────────

const circuitBreaker = {
  failures: 0,
  lastFailureTime: null,
  suspendedUntil: null,
  THRESHOLD: 5,
  REFRESH_WINDOW_MS: 60000,
  SUSPEND_BASE_MS: 30000,
};

/**
 * Tracks transport failures (e.g. socket dropouts). Opens the circuit if threshold is hit.
 */
function recordError() {
  const now = Date.now();
  if (circuitBreaker.lastFailureTime && now - circuitBreaker.lastFailureTime > circuitBreaker.REFRESH_WINDOW_MS) {
    circuitBreaker.failures = 0;
  }
  
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = now;

  if (circuitBreaker.failures >= circuitBreaker.THRESHOLD) {
    const penalty = Math.min(circuitBreaker.SUSPEND_BASE_MS * Math.ceil(circuitBreaker.failures / circuitBreaker.THRESHOLD), 6 * 60 * 1000);
    circuitBreaker.suspendedUntil = now + penalty;
    console.error(`[Circuit Breaker] Multiple dispatch failures detected (${circuitBreaker.failures}). Pausing outgoing queue for ${Math.round(penalty / 1000)}s.`);
  }
}

/**
 * Resolves once the circuit breaker is closed (healthy).
 */
async function checkCircuitBreaker() {
  const now = Date.now();
  if (circuitBreaker.suspendedUntil && now < circuitBreaker.suspendedUntil) {
    const remainingWait = circuitBreaker.suspendedUntil - now;
    await new Promise(r => setTimeout(r, remainingWait));
    circuitBreaker.failures = 0;
    circuitBreaker.suspendedUntil = null;
  }
}

// ─── 7. HIGH-RELIABILITY priority DISPATCH QUEUE ─────────────────────────────────

/**
 * Executes a list of asynchronous messaging tasks sequentially with human-realistic 
 * distribution models to guarantee safe batch processing.
 */
async function executeQueue(tasks, options = {}) {
  const {
    minDelay = 1200,
    maxDelay = 3500,
    batchSize = 8,
    batchPauseMs = 12000
  } = options;

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < tasks.length; i++) {
    if (i > 0 && i % batchSize === 0) {
      console.log(`[Dispatch Queue] Batch boundary reached (${i}/${tasks.length}). Shifting flow. Pausing for ${batchPauseMs / 1000}s...`);
      await new Promise(r => setTimeout(r, batchPauseMs + Math.random() * 2000));
    }

    try {
      await checkCircuitBreaker();
      await throttleOutbound();
      
      // Execute messaging task
      await tasks[i]();
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(err.message || err);
      recordError();
      // Wait longer on failure before continuing
      await gaussianDelay(minDelay * 2, maxDelay * 1.5);
      continue;
    }

    const scale = getTimeOfDayScale();
    await gaussianDelay(minDelay * scale, (maxDelay - minDelay) * scale);
  }

  return results;
}

// ─── 8. CLIENT PRESENCE INFERENCE ────────────────────────────────────────────────

/**
 * Simulates human presence metrics like typing indicators to make interaction profiles standard and natural.
 */
async function simulateTyping(sock, jid, goOfflineAfter = true) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await gaussianDelay(1400, 300);
    if (goOfflineAfter) {
      await sock.sendPresenceUpdate('unavailable', jid);
    }
  } catch (e) {
    // Safe catch to ensure logging/network failures do not crash the pipeline
  }
}

async function goOffline(sock) {
  try {
    await sock.sendPresenceUpdate('unavailable');
  } catch (e) {}
}

// ─── 9. SHAPED BROADCAST DISPATCHER ──────────────────────────────────────────────

/**
 * Distributes a safe, heavily paced broadcast over multiple target destinations.
 */
async function safeBroadcast(sock, jids, content, minDelay = 4000, maxDelay = 9500) {
  const tasks = jids.map(jid => async () => {
    await sock.sendMessage(jid, content);
  });
  
  console.log(`[Flow Controller] Initializing safe broadcast queue to ${jids.length} recipients...`);
  const result = await executeQueue(tasks, {
    minDelay,
    maxDelay,
    batchSize: 6,
    batchPauseMs: 18000
  });
  
  console.log(`[Flow Controller] Safe broadcast dispatch complete. Success: ${result.success}, Failures: ${result.failed}.`);
  return result;
}

// ─── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  gaussianDelay,
  shortDelay,
  mediumDelay,
  longDelay,
  heavyDelay,
  adaptiveDelay,
  getTimeOfDayScale,
  throttleOutbound,
  isRateLimited,
  getRateLimitRemaining,
  isOnCooldown,
  getCooldownRemaining,
  recordError,
  checkCircuitBreaker,
  executeQueue,
  simulateTyping,
  goOffline,
  safeBroadcast
};
