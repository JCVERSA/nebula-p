/**
 * Atomic Database Operations
 * Provides atomic write/read with file locking to prevent data corruption
 *
 * Features:
 * - Atomic writes using temp file + rename
 * - File locking to prevent concurrent writes
 * - Automatic retry with backoff
 * - Backup before write (optional)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_TIMEOUT = 5000;      // Max 5 seconds to wait for lock
const LOCK_RETRY_DELAY = 50;    // Wait 50ms between lock attempts
const MAX_RETRIES = 3;          // Try up to 3 times
const BACKUP_ENABLED = true;    // Keep backup of previous version

/**
 * Atomic write to file
 * 1. Create lock file
 * 2. Write to temp file
 * 3. Verify write succeeded
 * 4. Rename temp to target (atomic on most filesystems)
 * 5. Release lock
 */
async function atomicWrite(filePath, data, options = {}) {
  const {
    retries = MAX_RETRIES,
    lockTimeout = LOCK_TIMEOUT,
    createBackup = BACKUP_ENABLED
  } = options;

  const lockFile = `${filePath}.lock`;
  const tempFile = `${filePath}.tmp`;
  const backupFile = `${filePath}.backup`;
  const dataJson = JSON.stringify(data, null, 2);

  let lockAcquired = false;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Try to create lock file (atomic operation)
      // 'wx' = write exclusive (fails if file exists)
      fs.writeFileSync(lockFile, process.pid.toString(), { flag: 'wx' });
      lockAcquired = true;

      try {
        // Create backup if file exists
        if (createBackup && fs.existsSync(filePath)) {
          fs.copyFileSync(filePath, backupFile);
        }

        // Write to temporary file
        fs.writeFileSync(tempFile, dataJson, { encoding: 'utf-8' });

        // Verify write by reading back
        const written = fs.readFileSync(tempFile, 'utf-8');
        if (written !== dataJson) {
          throw new Error('Write verification failed');
        }

        // Atomic rename (on POSIX, overwrites; on Windows, requires delete first)
        if (process.platform === 'win32' && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        fs.renameSync(tempFile, filePath);

        return {
          success: true,
          path: filePath,
          size: dataJson.length,
          backupPath: createBackup ? backupFile : null
        };

      } finally {
        // Always release lock
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }

        // Clean up temp file if it exists
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }

    } catch (error) {
      if (error.code === 'EEXIST') {
        // Lock file exists, wait and retry
        if (attempt < retries - 1) {
          await sleep(LOCK_RETRY_DELAY);
          continue;
        } else {
          throw new Error(`Could not acquire lock after ${retries} attempts`);
        }
      }

      // Other errors
      throw error;
    }
  }

  throw new Error(`Failed to write ${filePath} after ${retries} retries`);
}

/**
 * Atomic read from file with retry
 * Retries on lock conflicts
 */
async function atomicRead(filePath, options = {}) {
  const { retries = MAX_RETRIES } = options;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return null;
      }

      // Check if lock exists (another writer)
      const lockFile = `${filePath}.lock`;
      if (fs.existsSync(lockFile)) {
        // Wait for lock to be released
        if (attempt < retries - 1) {
          await sleep(LOCK_RETRY_DELAY);
          continue;
        }
      }

      // Read file
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);

    } catch (error) {
      if (error instanceof SyntaxError) {
        // JSON parse error — file is corrupted
        const backupFile = `${filePath}.backup`;
        if (fs.existsSync(backupFile)) {
          console.warn(`[Database] File corrupted, recovering from backup: ${filePath}`);
          try {
            const backupContent = fs.readFileSync(backupFile, 'utf-8');
            return JSON.parse(backupContent);
          } catch (backupError) {
            throw new Error(`File corrupted and backup invalid: ${filePath}`);
          }
        }
        throw new Error(`File corrupted with no valid backup: ${filePath}`);
      }

      // Retry on other errors
      if (attempt < retries - 1) {
        await sleep(LOCK_RETRY_DELAY);
        continue;
      }

      throw error;
    }
  }

  return null;
}

/**
 * Replace database.js implementation
 * Wraps atomic operations with in-memory cache
 */
class AtomicDatabase {
  constructor() {
    this.cache = new Map();
    this.dirty = new Set();
  }

  /**
   * Load data from file into cache
   */
  async load(filePath, defaultData = {}) {
    try {
      const data = await atomicRead(filePath);
      this.cache.set(filePath, data || defaultData);
      return data || defaultData;
    } catch (error) {
      console.warn(`[Database] Failed to load ${filePath}:`, error.message);
      this.cache.set(filePath, defaultData);
      return defaultData;
    }
  }

  /**
   * Get data from cache
   */
  get(filePath) {
    return this.cache.get(filePath) || {};
  }

  /**
   * Set data in cache and mark dirty
   */
  set(filePath, data) {
    this.cache.set(filePath, data);
    this.dirty.add(filePath);
  }

  /**
   * Flush dirty entries to disk
   */
  async flush() {
    const results = [];

    for (const filePath of this.dirty) {
      try {
        const data = this.cache.get(filePath);
        const result = await atomicWrite(filePath, data);
        results.push({ path: filePath, success: true });
        this.dirty.delete(filePath);
      } catch (error) {
        results.push({ path: filePath, success: false, error: error.message });
      }
    }

    return results;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify database file integrity
 * Returns checksum for comparison
 */
function getChecksum(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    return null;
  }
}

module.exports = {
  atomicWrite,
  atomicRead,
  AtomicDatabase,
  getChecksum
};
