import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { writeZipArchiveStream, StreamingZipEntry } from "./streamingZipWriter.js";
import { registerTempDownload, TempDownloadRecord } from "../tempDownloadManager.js";
import { updateJobStatus, completeBatchJob } from "../batchDownloadManager.js";

/**
 * Options for sanitizing and formatting episode filenames.
 */
export interface FormatEpisodeFilenameOptions {
  /** Optional series / anime title */
  title?: string;
  /** Optional season label or number (e.g., '01', 'S02', 1) */
  season?: string | number;
  /** Numeric episode number */
  episodeNumber: number;
  /** Total episode count in batch, used to automatically calculate padding digits (e.g. >= 100 -> 3 digits) */
  totalEpisodes?: number;
  /** Minimum zero padding digits (default: 2 -> '01', '10') */
  minPaddingDigits?: number;
  /** Format style: 'simple' ('Episode 01.mp4'), 'short' ('Ep01.mp4'), or 'full' ('Title_S01E01_720p.mp4') */
  style?: "simple" | "short" | "full";
  /** Video/file extension (default: 'mp4') */
  extension?: string;
  /** Optional resolution tag (e.g., '720p', '1080P') */
  resolution?: string;
  /** Optional language / audio tag (e.g., 'VF', 'VOSTFR') */
  language?: string;
}

/**
 * Episode input for creating a ZIP package.
 */
export interface BatchZipEpisodeInput {
  /** Local filesystem path to the downloaded episode video/file */
  filePath: string;
  /** Episode number for ordering and zero-padded renaming */
  episodeNumber: number;
  /** Optional explicit override filename inside the zip archive */
  entryName?: string;
  /** Optional file size in bytes */
  sizeBytes?: number;
  /** Optional episode title/subtitle */
  episodeTitle?: string;
}

/**
 * Options for packaging a batch of downloaded episodes into a single ZIP archive.
 */
export interface PackageBatchZipOptions {
  /** List of episode files with their episode numbers */
  episodes: BatchZipEpisodeInput[];
  /** Series/Anime title */
  animeTitle?: string;
  /** Season name or number */
  season?: string | number;
  /** Video resolution */
  resolution?: string;
  /** Audio/subtitles language */
  language?: string;
  /** Custom ZIP archive filename */
  zipFilename?: string;
  /** Time-to-live for temporary download link in minutes (default: 60) */
  ttlMinutes?: number;
  /** Whether to delete the input episode files after adding to the ZIP (default: false) */
  cleanupSourceFiles?: boolean;
  /** Whether to include a README.txt metadata manifest inside the ZIP (default: true) */
  includeManifest?: boolean;
  /** Style for renaming files inside the ZIP (default: 'simple' -> 'Episode 01.mp4') */
  namingStyle?: "simple" | "short" | "full";
  /** Associated batch download job ID for automatic status tracking */
  batchJobId?: string;
  /** Custom metadata to attach to the temp download record */
  meta?: Record<string, any>;
}

/**
 * Result returned after packaging a batch ZIP archive.
 */
export interface BatchZipResult {
  /** Whether the packaging succeeded */
  success: boolean;
  /** Friendly ZIP filename */
  zipFilename: string;
  /** Local filesystem path of the created ZIP archive */
  zipFilePath: string;
  /** Unguessable secure token for downloading */
  token: string;
  /** Public / absolute download URL */
  downloadUrl: string;
  /** File size in megabytes */
  sizeMB: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Timestamp when the temporary download link will expire */
  expiresAt: number;
  /** Number of episodes successfully archived inside the ZIP */
  episodesCount: number;
  /** Manifest list of archived file names */
  archivedFiles: string[];
  /** Error message if packaging failed */
  error?: string;
}

/**
 * Sanitizes a string for use in filesystem paths and archive entries.
 * Removes forbidden characters (`/\:*?"<>|`), control characters, and collapses repetitive underscores.
 */
export function sanitizeFilename(name: string): string {
  if (!name) return "unnamed_file";
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // Windows & Unix illegal chars
    .replace(/\.\.+/g, ".")                // Prevent path traversal dots
    .replace(/__+/g, "_")                  // Collapse multiple underscores
    .replace(/^[\s._-]+|[\s._-]+$/g, "")   // Trim leading/trailing separators
    || "file";
}

/**
 * Pads an episode number with leading zeros to guarantee correct alphabetical sorting.
 *
 * @param epNum The episode number (e.g. 1, 10, 105)
 * @param minDigits Minimum number of digits (default: 2). If totalEpisodes >= 100, passes 3.
 * @returns Padded string (e.g., '01', '10', '005')
 */
export function padEpisodeNumber(epNum: number, minDigits = 2): string {
  const safeNum = Math.max(0, Math.floor(epNum || 0));
  return String(safeNum).padStart(minDigits, "0");
}

/**
 * Determines appropriate zero-padding width based on total episodes.
 */
export function calculatePaddingDigits(totalEpisodes?: number, minDigits = 2): number {
  if (!totalEpisodes || totalEpisodes < 100) {
    return Math.max(2, minDigits);
  }
  return Math.max(String(totalEpisodes).length, minDigits);
}

/**
 * Helper function to sanitize and format filenames for batch downloads.
 * Ensures episode numbers are consistently padded with zeros (e.g. 'Ep01', 'Ep10', 'Episode 01.mp4')
 * to maintain strict alphabetical sorting across media players and target destination devices.
 *
 * @example
 * formatBatchEpisodeFilename({ episodeNumber: 1 }) // "Episode 01.mp4"
 * formatBatchEpisodeFilename({ episodeNumber: 5, style: "short" }) // "Ep05.mp4"
 * formatBatchEpisodeFilename({ title: "Solo Leveling", season: 2, episodeNumber: 3, resolution: "720p", style: "full" })
 * // "Solo_Leveling_S02Ep03_720p.mp4"
 */
export function formatBatchEpisodeFilename(options: FormatEpisodeFilenameOptions): string {
  const {
    title,
    season,
    episodeNumber,
    totalEpisodes,
    minPaddingDigits = 2,
    style = "simple",
    extension = "mp4",
    resolution,
    language
  } = options;

  const ext = (extension || "mp4").replace(/^\./, "");
  const paddingWidth = calculatePaddingDigits(totalEpisodes, minPaddingDigits);
  const paddedEp = padEpisodeNumber(episodeNumber, paddingWidth);

  if (style === "short") {
    // e.g. "Ep01.mp4", "Ep10.mp4"
    return `Ep${paddedEp}.${ext}`;
  }

  if (style === "simple") {
    // e.g. "Episode 01.mp4", "Episode 10.mp4"
    return `Episode ${paddedEp}.${ext}`;
  }

  // Full descriptive format: Title_S01Ep01_720p.mp4
  const parts: string[] = [];

  if (title) {
    parts.push(sanitizeFilename(title).replace(/\s+/g, "_"));
  }

  if (season !== undefined && season !== null) {
    const rawSeason = String(season);
    const seasonNumMatch = rawSeason.match(/\d+/);
    const seasonDigits = seasonNumMatch ? padEpisodeNumber(parseInt(seasonNumMatch[0], 10), 2) : "01";
    parts.push(`S${seasonDigits}`);
  }

  parts.push(`Ep${paddedEp}`);

  if (resolution) {
    parts.push(sanitizeFilename(resolution).replace(/\s+/g, ""));
  }

  if (language) {
    parts.push(sanitizeFilename(language).replace(/\s+/g, ""));
  }

  const baseName = parts.length > 0 ? parts.join("_") : `Episode_${paddedEp}`;
  return `${sanitizeFilename(baseName)}.${ext}`;
}

/**
 * Convenient alias wrapper for sanitizing and formatting batch episode filenames.
 */
export function sanitizeAndFormatEpisodeFilename(
  episodeNumber: number,
  options?: Partial<FormatEpisodeFilenameOptions>
): string {
  return formatBatchEpisodeFilename({
    episodeNumber,
    ...options
  });
}

/**
 * BatchZipManager is responsible for aggregating downloaded episodes into a structured ZIP archive,
 * applying zero-padded alphabetical file renaming, generating optional manifests, and creating
 * secure, time-limited temporary download links for end users.
 */
export class BatchZipManager {
  /**
   * Packages downloaded episode files into a single ZIP archive, ensuring properly padded
   * episode numbering in entry filenames, registering the output in the temp download manager,
   * and returning the temporary download link details.
   */
  public static async packageEpisodes(options: PackageBatchZipOptions): Promise<BatchZipResult> {
    const {
      episodes,
      animeTitle = "Batch_Download",
      season = "S01",
      resolution = "720p",
      language = "VF",
      ttlMinutes = 60,
      cleanupSourceFiles = false,
      includeManifest = true,
      namingStyle = "simple",
      batchJobId,
      meta = {}
    } = options;

    if (!episodes || episodes.length === 0) {
      if (batchJobId) {
        updateJobStatus(batchJobId, "failed", "Cannot create ZIP archive: No episodes provided");
      }
      return {
        success: false,
        zipFilename: "",
        zipFilePath: "",
        token: "",
        downloadUrl: "",
        sizeMB: 0,
        sizeBytes: 0,
        expiresAt: 0,
        episodesCount: 0,
        archivedFiles: [],
        error: "No episodes provided for packaging"
      };
    }

    if (batchJobId) {
      updateJobStatus(batchJobId, "packaging", `📦 Compressing ${episodes.length} episodes into ZIP archive...`);
    }

    // Sort episodes in ascending numerical order
    const sortedEpisodes = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const totalEpisodes = sortedEpisodes.length;
    const paddingWidth = calculatePaddingDigits(
      Math.max(totalEpisodes, sortedEpisodes[sortedEpisodes.length - 1]?.episodeNumber || 1)
    );

    const safeTitle = sanitizeFilename(animeTitle).replace(/\s+/g, "_");
    const rawSeasonStr = String(season);
    const seasonMatch = rawSeasonStr.match(/\d+/);
    const seasonFormatted = seasonMatch ? `S${padEpisodeNumber(parseInt(seasonMatch[0], 10), 2)}` : "S01";
    const safeResolution = sanitizeFilename(resolution).replace(/\s+/g, "");

    const finalZipFilename = options.zipFilename
      ? sanitizeFilename(options.zipFilename.replace(/\.zip$/i, "")) + ".zip"
      : `${safeTitle}_${seasonFormatted}_Complete_${safeResolution}.zip`;

    const zipTempDir = path.join(os.tmpdir(), `batch_zip_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`);
    const zipLocalPath = path.join(os.tmpdir(), `${Date.now()}_${finalZipFilename}`);

    const archivedFiles: string[] = [];

    try {
      fs.mkdirSync(zipTempDir, { recursive: true });
      const entries: StreamingZipEntry[] = [];

      // 1. Add README manifest if requested
      if (includeManifest) {
        const manifestText =
          `# ${animeTitle} - ${seasonFormatted} (${language})\n` +
          `==================================================\n` +
          `Quality / Resolution : ${resolution}\n` +
          `Total Episodes       : ${totalEpisodes}\n` +
          `Archive Created      : ${new Date().toISOString()}\n` +
          `Package Name         : ${finalZipFilename}\n\n` +
          `Contents:\n` +
          sortedEpisodes
            .map((ep) => {
              const ext = ep.filePath ? path.extname(ep.filePath).replace(/^\./, "") || "mp4" : "mp4";
              const entry = ep.entryName || formatBatchEpisodeFilename({
                title: animeTitle,
                season,
                episodeNumber: ep.episodeNumber,
                totalEpisodes,
                minPaddingDigits: paddingWidth,
                style: namingStyle,
                extension: ext,
                resolution
              });
              return `  • ${entry}`;
            })
            .join("\n") +
          `\n\nDownloaded via Nebula WhatsApp Bot Media Center.`;

        entries.push({ entryName: "README.txt", data: Buffer.from(manifestText, "utf-8") });
        archivedFiles.push("README.txt");
      }

      // 2. Add each episode file with sanitized, zero-padded numbering
      for (const ep of sortedEpisodes) {
        if (!fs.existsSync(ep.filePath)) {
          console.warn(`[BatchZipManager] Episode file not found on disk: ${ep.filePath}`);
          continue;
        }

        const ext = path.extname(ep.filePath).replace(/^\./, "") || "mp4";
        const entryName = ep.entryName || formatBatchEpisodeFilename({
          title: animeTitle,
          season,
          episodeNumber: ep.episodeNumber,
          totalEpisodes,
          minPaddingDigits: paddingWidth,
          style: namingStyle,
          extension: ext,
          resolution
        });

        // Stage for the streaming writer (constant memory; audit 8.15 - adm-zip
        // used to build the whole archive in RAM and OOM-kill the container).
        entries.push({ entryName, filePath: ep.filePath });
        archivedFiles.push(entryName);
      }

      // 3. Stream the final zip archive to disk (STORE method: MP4 payloads do
      // not compress, so we archive at disk-copy speed with flat memory usage).
      const startedAt = Date.now();
      const writeResult = await writeZipArchiveStream(zipLocalPath, entries, (entryName, bytes) => {
        console.log(`[BatchZipManager] Archived ${entryName} (${(bytes / 1048576).toFixed(2)} MB)`);
      });
      console.log(
        `[BatchZipManager] Streaming zip complete: ${writeResult.entryCount} entries, ` +
          `${(writeResult.totalBytes / 1048576).toFixed(2)} MB in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`
      );

      // Clean staging dir if created
      try {
        fs.rmSync(zipTempDir, { recursive: true, force: true });
      } catch {}

      // Clean source episode files if requested
      if (cleanupSourceFiles) {
        for (const ep of sortedEpisodes) {
          try {
            if (fs.existsSync(ep.filePath)) {
              fs.unlinkSync(ep.filePath);
            }
          } catch {}
        }
      }

      // 4. Register with TempDownloadManager
      const tempRecord: TempDownloadRecord & { token: string; downloadUrl: string } = registerTempDownload(
        zipLocalPath,
        finalZipFilename,
        {
          ttlMinutes,
          moveFile: true,
          mimeType: "application/zip",
          meta: {
            batchId: batchJobId,
            animeTitle,
            season: seasonFormatted,
            totalEpisodes: archivedFiles.length - (includeManifest ? 1 : 0),
            archivedFiles,
            ...meta
          }
        }
      ) as any;

      // 5. Update batch download manager if job ID is given
      if (batchJobId) {
        completeBatchJob(batchJobId, {
          zipDownloadUrl: tempRecord.downloadUrl,
          zipFilename: tempRecord.filename,
          zipSizeMB: tempRecord.sizeMB,
          zipToken: tempRecord.token,
          expiresAt: tempRecord.expiresAt
        });
      }

      console.log(
        `[BatchZipManager] Successfully packaged ${archivedFiles.length} files into ${tempRecord.filename} (${tempRecord.sizeMB} MB). Expiry: ${new Date(tempRecord.expiresAt).toLocaleTimeString()}`
      );

      return {
        success: true,
        zipFilename: tempRecord.filename,
        zipFilePath: tempRecord.filePath,
        token: tempRecord.token,
        downloadUrl: tempRecord.downloadUrl,
        sizeMB: tempRecord.sizeMB,
        sizeBytes: tempRecord.sizeBytes,
        expiresAt: tempRecord.expiresAt,
        episodesCount: archivedFiles.length - (includeManifest ? 1 : 0),
        archivedFiles
      };
    } catch (err: any) {
      console.error("[BatchZipManager] Error packaging batch ZIP archive:", err);
      try {
        if (fs.existsSync(zipTempDir)) fs.rmSync(zipTempDir, { recursive: true, force: true });
        if (fs.existsSync(zipLocalPath)) fs.unlinkSync(zipLocalPath);
      } catch {}

      if (batchJobId) {
        updateJobStatus(batchJobId, "failed", "ZIP packaging failed", err.message);
      }

      return {
        success: false,
        zipFilename: finalZipFilename,
        zipFilePath: "",
        token: "",
        downloadUrl: "",
        sizeMB: 0,
        sizeBytes: 0,
        expiresAt: 0,
        episodesCount: 0,
        archivedFiles: [],
        error: err.message || "Failed to package ZIP archive"
      };
    }
  }

  /**
   * Helper method to generate a list of properly padded episode filenames for a range of episodes.
   */
  public static generateFilenameList(
    totalEpisodes: number,
    options?: Partial<FormatEpisodeFilenameOptions>
  ): string[] {
    const list: string[] = [];
    for (let i = 1; i <= totalEpisodes; i++) {
      list.push(
        formatBatchEpisodeFilename({
          episodeNumber: i,
          totalEpisodes,
          ...options
        })
      );
    }
    return list;
  }
}

export default BatchZipManager;
