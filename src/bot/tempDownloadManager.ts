import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export interface TempDownloadRecord {
  token: string;
  filePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sizeMB: number;
  createdAt: number;
  expiresAt: number;
  downloadCount: number;
  meta?: Record<string, any>;
}

const TEMP_DOWNLOAD_DIR = path.join(os.tmpdir(), "nebula_temp_downloads");
const ZIP_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes maximum retention for generated ZIP files

// Storage safety ceilings — an untrusted WhatsApp user must not be able to
// fill the host disk via temp downloads.
const TEMP_MAX_TOTAL_BYTES = Number(process.env.NEBULA_TEMP_MAX_BYTES || 4 * 1024 * 1024 * 1024); // 4 GB
const TEMP_MAX_RECORDS = 200;
const ORPHAN_MAX_AGE_MS = 3 * 60 * 60 * 1000; // hard sweep for any orphan > 3h

// Ensure base temp directory exists
try {
  fs.mkdirSync(TEMP_DOWNLOAD_DIR, { recursive: true });
} catch (err: any) {
  console.warn("[TempDownload] Warning creating temp download directory:", err.message);
}

// In-memory registry of active download tokens
const activeDownloads = new Map<string, TempDownloadRecord>();

let detectedServerBaseUrl = process.env.APP_URL || process.env.PUBLIC_URL || "";

/**
 * Update the runtime server base URL if detected from an incoming request.
 */
export function updateServerBaseUrl(url: string) {
  if (!url) return;
  const cleanUrl = url.replace(/\/+$/, "");
  const isLocal = cleanUrl.includes("localhost") || cleanUrl.includes("127.0.0.1") || cleanUrl.includes("0.0.0.0");

  // If we haven't set any URL, or if we currently have localhost but received a real external public host, update it
  if (!detectedServerBaseUrl || (detectedServerBaseUrl.includes("localhost") && !isLocal)) {
    detectedServerBaseUrl = cleanUrl;
  }
}

/**
 * Get current public base URL for generating absolute links.
 */
export function getServerBaseUrl(): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/+$/, "");
  }
  if (detectedServerBaseUrl) {
    return detectedServerBaseUrl;
  }
  return "";
}

/**
 * Register a large file for time-limited secure public download.
 *
 * @param sourcePath Local filesystem path to the file
 * @param filename Friendly download filename (e.g., "Attack_on_Titan_S01E01_1080P.mp4")
 * @param options Custom options including TTL (default 60 minutes for ZIP, 120 minutes for video), mimeType, and metadata
 */
export function registerTempDownload(
  sourcePath: string,
  filename: string,
  options?: {
    mimeType?: string;
    ttlMinutes?: number;
    moveFile?: boolean;
    meta?: Record<string, any>;
  }
): {
  token: string;
  downloadUrl: string;
  expiresAt: number;
  ttlMinutes: number;
  sizeMB: number;
  sizeBytes: number;
  filename: string;
  filePath: string;
} {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file does not exist at: ${sourcePath}`);
  }

  const isZip = filename.toLowerCase().endsWith(".zip") || options?.mimeType === "application/zip";
  const stat = fs.statSync(sourcePath);
  const sizeBytes = stat.size;
  const sizeMB = Number((sizeBytes / (1024 * 1024)).toFixed(2));
  
  // Generated ZIP archives have a strict 60 minutes TTL to optimize server storage
  const defaultTtl = isZip ? 60 : 120;
  const ttlMinutes = options?.ttlMinutes !== undefined ? (isZip ? Math.min(options.ttlMinutes, 60) : options.ttlMinutes) : defaultTtl;
  const mimeType = options?.mimeType || (isZip ? "application/zip" : filename.endsWith(".mp4") ? "video/mp4" : "application/octet-stream");

  // Secure unguessable 48-char random token
  // Enforce global storage ceilings before copying anything to disk.
  const currentTotal = getTempStorageStats().totalMB * 1024 * 1024;
  if (activeDownloads.size >= TEMP_MAX_RECORDS) {
    throw new Error("Temporary download storage is full (record limit). Please try again later.");
  }
  if (currentTotal + sizeBytes > TEMP_MAX_TOTAL_BYTES) {
    throw new Error("Temporary download storage quota reached. Please try again later.");
  }

  const token = crypto.randomBytes(24).toString("hex");
  const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destinationPath = path.join(TEMP_DOWNLOAD_DIR, `${token}_${sanitizedName}`);

  // Move or copy file into dedicated temp store
  if (options?.moveFile) {
    try {
      fs.renameSync(sourcePath, destinationPath);
    } catch {
      fs.copyFileSync(sourcePath, destinationPath);
      try {
        fs.unlinkSync(sourcePath);
      } catch {}
    }
  } else {
    fs.copyFileSync(sourcePath, destinationPath);
  }

  const now = Date.now();
  const expiresAt = now + ttlMinutes * 60 * 1000;

  const record: TempDownloadRecord = {
    token,
    filePath: destinationPath,
    filename: sanitizedName,
    mimeType,
    sizeBytes,
    sizeMB,
    createdAt: now,
    expiresAt,
    downloadCount: 0,
    meta: options?.meta
  };

  activeDownloads.set(token, record);

  const baseUrl = getServerBaseUrl();
  const downloadUrl = baseUrl ? `${baseUrl}/api/media/download/${token}` : `/api/media/download/${token}`;

  console.log(`[TempDownload] Registered temporary download: ${sanitizedName} (${sizeMB} MB), Token: ${token}, TTL: ${ttlMinutes}m (Expires at ${new Date(expiresAt).toLocaleTimeString()})`);

  return {
    token,
    downloadUrl,
    expiresAt,
    ttlMinutes,
    sizeMB,
    sizeBytes,
    filename: sanitizedName,
    filePath: destinationPath
  };
}

/**
 * Retrieve active download record by token, verifying TTL and file presence.
 */
export function getTempDownload(token: string): TempDownloadRecord | null {
  const record = activeDownloads.get(token);
  if (!record) return null;

  const now = Date.now();
  if (now > record.expiresAt) {
    // Expired - clean up immediately
    try {
      if (fs.existsSync(record.filePath)) {
        fs.unlinkSync(record.filePath);
      }
    } catch {}
    activeDownloads.delete(token);
    return null;
  }

  if (!fs.existsSync(record.filePath)) {
    activeDownloads.delete(token);
    return null;
  }

  record.downloadCount++;
  return record;
}

/**
 * Automatically delete generated ZIP files from the temporary directory after 60 minutes
 * to ensure server storage remains optimized.
 */
export function cleanupExpiredZipFiles(): { cleanedFiles: number; freedBytes: number; freedMB: number } {
  const now = Date.now();
  let cleanedFiles = 0;
  let freedBytes = 0;

  // 1. Sweep expired in-memory active download records
  for (const [token, record] of activeDownloads) {
    const isZip = record.filename.toLowerCase().endsWith(".zip") || record.mimeType === "application/zip";
    const isExpired = now > record.expiresAt || (isZip && (now - record.createdAt) >= ZIP_MAX_AGE_MS);

    if (isExpired) {
      try {
        if (fs.existsSync(record.filePath)) {
          const stats = fs.statSync(record.filePath);
          freedBytes += stats.size;
          fs.unlinkSync(record.filePath);
          cleanedFiles++;
        }
      } catch (err: any) {
        console.warn(`[TempDownload] Error removing expired file ${record.filePath}:`, err.message);
      }
      activeDownloads.delete(token);
    }
  }

  // 2. Scan TEMP_DOWNLOAD_DIR for orphaned files: ZIPs older than 60 min,
  // any other file older than 3h (safety net for records that were never
  // accessed after their TTL expired).
  try {
    if (fs.existsSync(TEMP_DOWNLOAD_DIR)) {
      const files = fs.readdirSync(TEMP_DOWNLOAD_DIR);
      for (const file of files) {
        const fullPath = path.join(TEMP_DOWNLOAD_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          const ageMs = now - stats.mtimeMs;
          const isZip = file.toLowerCase().endsWith(".zip");
          const maxAge = isZip ? ZIP_MAX_AGE_MS : ORPHAN_MAX_AGE_MS;
          if (ageMs >= maxAge) {
            freedBytes += stats.size;
            fs.unlinkSync(fullPath);
            cleanedFiles++;
            console.log(`[TempDownload] 🧹 Purged orphaned file from temp storage: ${file} (Age: ${Math.round(ageMs / 60000)}m)`);
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn("[TempDownload] Error scanning TEMP_DOWNLOAD_DIR:", err.message);
  }

  // 3. Scan os.tmpdir() for any temporary batch_*.zip or Novabox zip leftovers older than 60 minutes
  try {
    const tmpFiles = fs.readdirSync(os.tmpdir());
    for (const file of tmpFiles) {
      if (file.toLowerCase().endsWith(".zip") && (file.includes("batch") || file.includes("Complete") || file.includes("nebula") || file.includes("Novabox"))) {
        const fullPath = path.join(os.tmpdir(), file);
        try {
          const stats = fs.statSync(fullPath);
          const ageMs = now - stats.mtimeMs;
          if (ageMs >= ZIP_MAX_AGE_MS) {
            freedBytes += stats.size;
            fs.unlinkSync(fullPath);
            cleanedFiles++;
            console.log(`[TempDownload] 🧹 Purged batch ZIP from system tmpdir: ${file} (Age: ${Math.round(ageMs / 60000)}m)`);
          }
        } catch {}
      }
    }
  } catch {}

  const freedMB = Number((freedBytes / (1024 * 1024)).toFixed(2));
  if (cleanedFiles > 0) {
    console.log(`[TempDownload] 🧹 Automated Cleanup Completed: ${cleanedFiles} ZIP file(s) deleted, ${freedMB} MB freed from server storage.`);
  }

  return { cleanedFiles, freedBytes, freedMB };
}

/**
 * Periodically purge expired files from memory and disk.
 */
export function sweepExpiredDownloads() {
  cleanupExpiredZipFiles();
}

/**
 * Get current temporary storage usage statistics.
 */
export function getTempStorageStats() {
  let totalBytes = 0;
  let zipCount = 0;
  let otherCount = 0;
  let oldestZipAgeMinutes = 0;
  const now = Date.now();

  try {
    if (fs.existsSync(TEMP_DOWNLOAD_DIR)) {
      const files = fs.readdirSync(TEMP_DOWNLOAD_DIR);
      for (const file of files) {
        const fullPath = path.join(TEMP_DOWNLOAD_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          totalBytes += stats.size;
          if (file.toLowerCase().endsWith(".zip")) {
            zipCount++;
            const ageMin = Math.round((now - stats.mtimeMs) / 60000);
            if (ageMin > oldestZipAgeMinutes) oldestZipAgeMinutes = ageMin;
          } else {
            otherCount++;
          }
        } catch {}
      }
    }
  } catch {}

  return {
    totalFiles: zipCount + otherCount,
    zipCount,
    otherCount,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    oldestZipAgeMinutes,
    zipRetentionLimitMinutes: 60,
    activeTokensCount: activeDownloads.size,
    tempDirectory: TEMP_DOWNLOAD_DIR,
  };
}

/**
 * Startup purge (audit 8.16). The token registry lives in memory, so after a
 * restart EVERY file in TEMP_DOWNLOAD_DIR is unreachable — including debris
 * from OOM-killed runs (kernel kills bypass `finally` cleanup) that otherwise
 * lingers up to 3h and saturates the 4 GB quota: a fresh batch then fails
 * with "Temporary download storage quota reached" even though nothing valid
 * is stored. Also removes cat_catch_* HLS staging dirs and batch_zip_* dirs
 * from os.tmpdir(), which no other sweep covers. Safe with a single bot
 * instance (the documented deployment); tokens of the previous process died
 * with it, so the files are already unreachable.
 */
export function purgeStartupOrphans(): { cleanedItems: number; freedBytes: number } {
  let cleanedItems = 0;
  let freedBytes = 0;

  try {
    if (fs.existsSync(TEMP_DOWNLOAD_DIR)) {
      for (const file of fs.readdirSync(TEMP_DOWNLOAD_DIR)) {
        const fullPath = path.join(TEMP_DOWNLOAD_DIR, file);
        try {
          freedBytes += fs.statSync(fullPath).size;
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleanedItems++;
        } catch {}
      }
    }
  } catch {}

  try {
    for (const entry of fs.readdirSync(os.tmpdir())) {
      if (entry.startsWith("cat_catch_") || entry.startsWith("batch_zip_")) {
        const fullPath = path.join(os.tmpdir(), entry);
        try {
          freedBytes += fs.statSync(fullPath).size;
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleanedItems++;
        } catch {}
      }
    }
  } catch {}

  if (cleanedItems > 0) {
    console.log(
      `[TempDownload] 🧹 Startup purge: ${cleanedItems} orphaned item(s) removed, ` +
        `${(freedBytes / 1048576).toFixed(2)} MB freed.`
    );
  }
  return { cleanedItems, freedBytes };
}

// Background cleanup task running every 5 minutes to guarantee ZIP files are cleaned up within 60 minutes
const cleanupTimer = setInterval(sweepExpiredDownloads, 5 * 60 * 1000);
cleanupTimer.unref();

// Startup: purge unreachable debris first (audit 8.16), then the regular sweep
purgeStartupOrphans();
sweepExpiredDownloads();
