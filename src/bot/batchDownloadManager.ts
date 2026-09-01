import {
  BatchZipManager,
  formatBatchEpisodeFilename,
  padEpisodeNumber,
  sanitizeAndFormatEpisodeFilename,
  sanitizeFilename
} from "./services/batchZipManager.js";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export {
  BatchZipManager,
  formatBatchEpisodeFilename,
  padEpisodeNumber,
  sanitizeAndFormatEpisodeFilename,
  sanitizeFilename
};

export interface BatchEpisodeItem {
  epNum: number;
  filename: string;
  status: "pending" | "downloading" | "completed" | "failed";
  progressPercent: number;
  sizeMB: number;
  downloadUrl?: string;
  error?: string;
}

export interface BatchDownloadJob {
  id: string;
  animeTitle: string;
  season: string;
  resolution: string;
  language: string;
  totalEpisodes: number;
  completedEpisodes: number;
  currentEpisode: number;
  progressPercent: number;
  status: "queued" | "downloading" | "packaging" | "completed" | "failed" | "cancelled";
  currentStatusText: string;
  episodes: BatchEpisodeItem[];
  zipDownloadUrl?: string;
  zipFilename?: string;
  zipSizeMB?: number;
  zipToken?: string;
  expiresAt?: number;
  ttlMinutes?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  /** True for panel-simulator jobs (driven by the simulation timer). Real
   *  WhatsApp-driven jobs cannot be retried from the panel — the download
   *  pipeline lives in the command session (R11 honesty fix, 2026-09-01). */
  simulated?: boolean;
}

// In-memory store of batch download jobs (max 20 most recent)
const batchJobs = new Map<string, BatchDownloadJob>();
let activeSimulationTimer: NodeJS.Timeout | null = null;

/**
 * Creates a new tracked batch download job.
 */
export function createBatchJob(params: {
  animeTitle: string;
  season: string;
  resolution?: string;
  language?: string;
  totalEpisodes: number;
  episodeNumbers?: number[];
}): BatchDownloadJob {
  const id = "batch_" + crypto.randomBytes(8).toString("hex");
  const now = Date.now();
  const epNumbers = params.episodeNumbers || Array.from({ length: params.totalEpisodes }, (_, i) => i + 1);

  const episodes: BatchEpisodeItem[] = epNumbers.map((epNum) => ({
    epNum,
    filename: formatBatchEpisodeFilename({
      title: params.animeTitle,
      season: params.season,
      episodeNumber: epNum,
      totalEpisodes: epNumbers.length,
      resolution: params.resolution || "720p",
      style: "full"
    }),
    status: "pending",
    progressPercent: 0,
    sizeMB: 0,
  }));

  const job: BatchDownloadJob = {
    id,
    animeTitle: params.animeTitle,
    season: params.season,
    resolution: params.resolution || "720p",
    language: params.language || "VF",
    totalEpisodes: episodes.length,
    completedEpisodes: 0,
    currentEpisode: episodes[0]?.epNum || 1,
    progressPercent: 0,
    status: "queued",
    currentStatusText: `Queued ${episodes.length} episodes for batch download`,
    episodes,
    createdAt: now,
    updatedAt: now,
  };

  batchJobs.set(id, job);
  pruneOldJobs();
  return job;
}

/**
 * Update episode progress inside a batch job.
 */
export function updateEpisodeProgress(
  jobId: string,
  epNum: number,
  updates: Partial<BatchEpisodeItem>
) {
  const job = batchJobs.get(jobId);
  if (!job) return;

  const ep = job.episodes.find((e) => e.epNum === epNum);
  if (ep) {
    Object.assign(ep, updates);
  }

  // Recalculate total job progress
  const completed = job.episodes.filter((e) => e.status === "completed").length;
  const totalEpProgress = job.episodes.reduce((sum, e) => sum + (e.progressPercent || 0), 0);
  job.completedEpisodes = completed;
  
  // 90% allocated to downloading, 10% allocated to packaging ZIP archive
  const dlProgress = Math.round((totalEpProgress / (job.totalEpisodes * 100)) * 90);
  if (job.status === "downloading" || job.status === "queued") {
    job.progressPercent = Math.min(90, dlProgress);
    job.currentEpisode = epNum;
  }
  job.updatedAt = Date.now();
}

/**
 * Update overall batch job status.
 */
export function updateJobStatus(
  jobId: string,
  status: BatchDownloadJob["status"],
  statusText?: string,
  error?: string
) {
  const job = batchJobs.get(jobId);
  if (!job) return;

  job.status = status;
  if (statusText) job.currentStatusText = statusText;
  if (error) job.error = error;
  if (status === "packaging") {
    job.progressPercent = 92;
  }
  job.updatedAt = Date.now();
}

/**
 * Mark a batch job as fully completed with generated ZIP archive download link.
 */
export function completeBatchJob(
  jobId: string,
  zipInfo: {
    zipDownloadUrl: string;
    zipFilename: string;
    zipSizeMB: number;
    zipToken: string;
    expiresAt: number;
  }
) {
  const job = batchJobs.get(jobId);
  if (!job) return;

  job.status = "completed";
  job.progressPercent = 100;
  job.currentStatusText = `Batch download complete! ZIP Archive (${zipInfo.zipSizeMB} MB) is ready.`;
  job.zipDownloadUrl = zipInfo.zipDownloadUrl;
  job.zipFilename = zipInfo.zipFilename;
  job.zipSizeMB = zipInfo.zipSizeMB;
  job.zipToken = zipInfo.zipToken;
  job.expiresAt = zipInfo.expiresAt;
  job.ttlMinutes = 60;
  job.completedEpisodes = job.totalEpisodes;
  job.episodes.forEach((ep) => {
    ep.status = "completed";
    ep.progressPercent = 100;
  });
  job.updatedAt = Date.now();
}

/**
 * Get active and recent batch download jobs.
 */
export function getAllBatchJobs(): BatchDownloadJob[] {
  return Array.from(batchJobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get a specific batch download job by ID.
 */
export function getBatchJob(id: string): BatchDownloadJob | null {
  return batchJobs.get(id) || null;
}

/**
 * Cancel a batch download job.
 */
export function cancelBatchJob(id: string): boolean {
  const job = batchJobs.get(id);
  if (!job) return false;
  job.status = "cancelled";
  job.currentStatusText = "Batch download cancelled by user.";
  job.updatedAt = Date.now();
  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }
  return true;
}

/**
 * Retry a failed or incomplete batch download job.
 */
export function retryBatchJob(id: string): { success: boolean; job?: BatchDownloadJob; error?: string } {
  const job = batchJobs.get(id);
  if (!job) {
    return { success: false, error: "Batch job not found" };
  }

  // R11 honesty fix: real (WhatsApp-driven) jobs have no panel-side worker —
  // flipping statuses here would fake progress forever. Refuse explicitly.
  if (!job.simulated) {
    return {
      success: false,
      error: "Ce téléchargement a été lancé depuis WhatsApp : relance-le là-bas (`.a <titre> s1 <épisodes> r1`). Le panneau ne peut re-jouer que les jobs du simulateur."
    };
  }

  // Clear previous top-level errors
  job.error = undefined;
  job.status = "downloading";
  job.currentStatusText = "Retrying batch download streams...";
  job.updatedAt = Date.now();

  // Reset any failed or incomplete episodes to downloading
  const uncompleted = job.episodes.filter((e) => e.status !== "completed");
  if (uncompleted.length === 0) {
    // If all were completed, re-trigger packaging
    job.status = "packaging";
    job.currentStatusText = `Re-packaging ${job.totalEpisodes} episodes into ZIP archive...`;
  } else {
    uncompleted.forEach((ep) => {
      ep.status = "downloading";
      ep.error = undefined;
      ep.progressPercent = Math.max(15, ep.progressPercent || 0);
    });
  }

  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }

  // Trigger retry resolution stream
  let retryStep = 0;
  activeSimulationTimer = setInterval(async () => {
    retryStep++;
    const currentJob = batchJobs.get(job.id);
    if (!currentJob || currentJob.status === "cancelled") {
      if (activeSimulationTimer) clearInterval(activeSimulationTimer);
      return;
    }

    if (retryStep <= 6) {
      currentJob.status = "downloading";
      const progressDelta = (retryStep / 6) * 100;
      currentJob.episodes.forEach((ep) => {
        if (ep.status !== "completed") {
          const newPct = Math.min(100, Math.round(progressDelta));
          ep.progressPercent = newPct;
          ep.sizeMB = Number(((newPct / 100) * 44.2).toFixed(1));
          if (newPct >= 100) {
            ep.status = "completed";
          }
        }
      });

      const completedCount = currentJob.episodes.filter((e) => e.status === "completed").length;
      currentJob.completedEpisodes = completedCount;
      currentJob.progressPercent = Math.min(90, Math.round((completedCount / currentJob.totalEpisodes) * 90));
      currentJob.currentStatusText = `Retrying: Downloaded ${completedCount}/${currentJob.totalEpisodes} episodes (${currentJob.progressPercent}%)`;
      currentJob.updatedAt = Date.now();
    } else {
      if (activeSimulationTimer) {
        clearInterval(activeSimulationTimer);
        activeSimulationTimer = null;
      }
      finalizeJobZip(currentJob);
    }
  }, 600);

  return { success: true, job };
}

/**
 * Retry an individual failed episode.
 */
export function retryEpisode(jobId: string, epNum: number): { success: boolean; job?: BatchDownloadJob; error?: string } {
  const job = batchJobs.get(jobId);
  if (!job) {
    return { success: false, error: "Batch job not found" };
  }

  const ep = job.episodes.find((e) => e.epNum === epNum);
  if (!ep) {
    return { success: false, error: `Episode ${epNum} not found in batch job` };
  }

  // R11 honesty fix: see retryBatchJob.
  if (!job.simulated) {
    return {
      success: false,
      error: `L'épisode ${epNum} fait partie d'un téléchargement lancé depuis WhatsApp : relance la commande là-bas (\`.a <titre> s1 ${epNum} r1\`).`
    };
  }

  ep.status = "downloading";
  ep.error = undefined;
  ep.progressPercent = 25;
  job.updatedAt = Date.now();

  // If overall job was marked failed because of this episode, restore downloading status
  if (job.status === "failed") {
    const hasOtherFailed = job.episodes.some((e) => e.epNum !== epNum && e.status === "failed");
    if (!hasOtherFailed) {
      job.status = "downloading";
      job.error = undefined;
      job.currentStatusText = `Retrying Episode ${epNum}...`;
    }
  }

  // Simulate fast retry stream for this single episode
  let step = 0;
  const singleTimer = setInterval(() => {
    step++;
    const currentJob = batchJobs.get(jobId);
    if (!currentJob) {
      clearInterval(singleTimer);
      return;
    }
    const targetEp = currentJob.episodes.find((e) => e.epNum === epNum);
    if (!targetEp) {
      clearInterval(singleTimer);
      return;
    }

    if (step < 4) {
      targetEp.progressPercent = Math.min(95, 25 + step * 25);
      targetEp.sizeMB = Number(((targetEp.progressPercent / 100) * 44.5).toFixed(1));
      currentJob.updatedAt = Date.now();
    } else {
      clearInterval(singleTimer);
      targetEp.status = "completed";
      targetEp.progressPercent = 100;
      targetEp.sizeMB = 44.5;
      targetEp.error = undefined;

      const completedCount = currentJob.episodes.filter((e) => e.status === "completed").length;
      currentJob.completedEpisodes = completedCount;
      currentJob.updatedAt = Date.now();

      // If all episodes are now complete, finalize ZIP archive
      if (completedCount >= currentJob.totalEpisodes) {
        finalizeJobZip(currentJob);
      } else {
        currentJob.currentStatusText = `Episode ${epNum} recovered and completed! (${completedCount}/${currentJob.totalEpisodes})`;
      }
    }
  }, 400);

  return { success: true, job };
}

/**
 * Inject a simulated error (Network failure or episode stream error) for demonstration / testing.
 */
export function injectSimulatedError(jobId: string, errorType: "network" | "episode", epNum?: number): { success: boolean; job?: BatchDownloadJob; error?: string } {
  const job = batchJobs.get(jobId);
  if (!job) {
    return { success: false, error: "Batch job not found" };
  }

  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }

  if (errorType === "network") {
    job.status = "failed";
    job.error = "Connection reset by peer (HLS stream CDN timeout after 30s).";
    job.currentStatusText = "Network failure: Connection to streaming CDN timed out.";
    // Mark in-progress episodes as failed
    job.episodes.forEach((ep) => {
      if (ep.status === "downloading") {
        ep.status = "failed";
        ep.error = "Socket closed unexpectedly (EAI_AGAIN)";
      }
    });
  } else {
    // Episode-specific error
    const targetEp = epNum ? job.episodes.find((e) => e.epNum === epNum) : job.episodes.find((e) => e.status !== "completed") || job.episodes[0];
    if (targetEp) {
      targetEp.status = "failed";
      targetEp.error = "HTTP 403: Forbidden stream segment token expired.";
      job.currentStatusText = `Episode ${targetEp.epNum} encountered a stream download error.`;
    }
  }

  job.updatedAt = Date.now();
  return { success: true, job };
}

/**
 * Finalize and create the ZIP archive for a completed batch job.
 */
async function finalizeJobZip(job: BatchDownloadJob) {
  try {
    const dummyZipDir = path.join(os.tmpdir(), `batch_sim_${Date.now()}`);
    fs.mkdirSync(dummyZipDir, { recursive: true });

    const episodeInputs = [];
    for (let i = 1; i <= job.totalEpisodes; i++) {
      const epFile = path.join(dummyZipDir, `ep_${i}.mp4`);
      fs.writeFileSync(
        epFile,
        `Simulated video payload for ${job.animeTitle} S02E${padEpisodeNumber(i, 2)} (${job.resolution} ${job.language}).\nStream source validated & processed successfully.`,
        "utf-8"
      );
      episodeInputs.push({
        filePath: epFile,
        episodeNumber: i
      });
    }

    const zipResult = await BatchZipManager.packageEpisodes({
      episodes: episodeInputs,
      animeTitle: job.animeTitle,
      season: job.season,
      resolution: job.resolution,
      language: job.language,
      ttlMinutes: 60,
      cleanupSourceFiles: true,
      namingStyle: "simple",
      batchJobId: job.id
    });

    try {
      fs.rmSync(dummyZipDir, { recursive: true, force: true });
    } catch {}

    if (zipResult.success) {
      completeBatchJob(job.id, {
        zipDownloadUrl: zipResult.downloadUrl,
        zipFilename: zipResult.zipFilename,
        zipSizeMB: zipResult.sizeMB,
        zipToken: zipResult.token,
        expiresAt: zipResult.expiresAt,
      });
    }
  } catch (err: any) {
    console.error("Error finalizing retry batch download:", err);
    job.status = "completed";
    job.progressPercent = 100;
    job.currentStatusText = `Batch download complete!`;
    job.zipDownloadUrl = `/api/media/download/sample_zip_${job.id}`;
    job.zipFilename = `${job.animeTitle}_Complete_${job.resolution}.zip`;
    job.zipSizeMB = 214.8;
    job.expiresAt = Date.now() + 60 * 60 * 1000;
    job.ttlMinutes = 60;
    job.updatedAt = Date.now();
  }
}

/**
 * Prune old jobs to prevent memory leaks (keep max 15).
 */
function pruneOldJobs() {
  if (batchJobs.size > 15) {
    const sorted = Array.from(batchJobs.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toDelete = sorted.slice(0, batchJobs.size - 15);
    for (const [k] of toDelete) {
      batchJobs.delete(k);
    }
  }
}

/**
 * Triggers a full simulated concurrent batch download for testing & interactive demo in the Simulator.
 * Simulates real-time chunk downloading, progress updates, concurrent streams, and ZIP generation with a valid download token!
 */
export function simulateBatchDownload(options?: {
  animeTitle?: string;
  season?: string;
  totalEpisodes?: number;
  resolution?: string;
  language?: string;
}): BatchDownloadJob {
  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }

  const animeTitle = options?.animeTitle || "Solo Leveling";
  const season = options?.season || "Saison 2";
  const totalEpisodes = options?.totalEpisodes || 5;
  const resolution = options?.resolution || "720p";
  const language = options?.language || "VF";

  const job = createBatchJob({
    animeTitle,
    season,
    totalEpisodes,
    resolution,
    language,
  });
  job.simulated = true;

  job.status = "downloading";
  job.currentStatusText = `Initializing ${totalEpisodes} concurrent download streams...`;

  let currentStep = 0;

  activeSimulationTimer = setInterval(async () => {
    currentStep++;
    const currentJob = batchJobs.get(job.id);
    if (!currentJob || currentJob.status === "cancelled") {
      if (activeSimulationTimer) clearInterval(activeSimulationTimer);
      return;
    }

    if (currentStep <= 18) {
      // Downloading concurrent episodes
      currentJob.status = "downloading";
      const baseProgress = (currentStep / 18) * 100;

      currentJob.episodes.forEach((ep, idx) => {
        // Stagger episode progress slightly for realistic concurrent streams
        const epOffset = (idx * 6);
        const epPct = Math.min(100, Math.max(0, Math.round(baseProgress * 1.1 - epOffset)));
        
        if (epPct >= 100) {
          ep.status = "completed";
          ep.progressPercent = 100;
          ep.sizeMB = 42.5 + (idx * 2.1);
        } else if (epPct > 0) {
          ep.status = "downloading";
          ep.progressPercent = epPct;
          ep.sizeMB = Number(((epPct / 100) * (42.5 + (idx * 2.1))).toFixed(1));
        } else {
          ep.status = "pending";
          ep.progressPercent = 0;
        }
      });

      const completedCount = currentJob.episodes.filter((e) => e.status === "completed").length;
      currentJob.completedEpisodes = completedCount;
      currentJob.progressPercent = Math.min(88, Math.round((currentStep / 18) * 88));
      currentJob.currentStatusText = `Downloading ${completedCount}/${totalEpisodes} episodes concurrently (${currentJob.progressPercent}%)`;
      currentJob.updatedAt = Date.now();
    } else if (currentStep <= 22) {
      // Packaging ZIP archive stage
      currentJob.status = "packaging";
      currentJob.progressPercent = 88 + ((currentStep - 18) * 2.5);
      currentJob.currentStatusText = `📦 Compressing ${totalEpisodes} video files into ZIP archive...`;
      currentJob.episodes.forEach((ep) => {
        ep.status = "completed";
        ep.progressPercent = 100;
      });
      currentJob.completedEpisodes = totalEpisodes;
      currentJob.updatedAt = Date.now();
    } else {
      // Complete! Generate a real downloadable ZIP file with sample contents for testing
      if (activeSimulationTimer) {
        clearInterval(activeSimulationTimer);
        activeSimulationTimer = null;
      }

      try {
        const dummyZipDir = path.join(os.tmpdir(), `batch_sim_${Date.now()}`);
        fs.mkdirSync(dummyZipDir, { recursive: true });

        const episodeInputs = [];
        for (let i = 1; i <= totalEpisodes; i++) {
          const epFile = path.join(dummyZipDir, `ep_${i}.mp4`);
          fs.writeFileSync(
            epFile,
            `Simulated video payload for ${animeTitle} S02E${padEpisodeNumber(i, 2)} (${resolution} ${language}).\nStream source validated & processed successfully.`,
            "utf-8"
          );
          episodeInputs.push({
            filePath: epFile,
            episodeNumber: i
          });
        }

        const zipResult = await BatchZipManager.packageEpisodes({
          episodes: episodeInputs,
          animeTitle,
          season,
          resolution,
          language,
          ttlMinutes: 60,
          cleanupSourceFiles: true,
          namingStyle: "simple",
          batchJobId: currentJob.id
        });

        try {
          fs.rmSync(dummyZipDir, { recursive: true, force: true });
        } catch {}

        if (zipResult.success) {
          completeBatchJob(currentJob.id, {
            zipDownloadUrl: zipResult.downloadUrl,
            zipFilename: zipResult.zipFilename,
            zipSizeMB: zipResult.sizeMB,
            zipToken: zipResult.token,
            expiresAt: zipResult.expiresAt,
          });
        }
      } catch (err: any) {
        console.error("Error finalizing simulated batch download:", err);
        currentJob.status = "completed";
        currentJob.progressPercent = 100;
        currentJob.currentStatusText = `Batch download complete! (Simulation fallback)`;
        currentJob.zipDownloadUrl = `/api/media/download/sample_zip_${job.id}`;
        currentJob.zipFilename = `${animeTitle}_Complete_${resolution}.zip`;
        currentJob.zipSizeMB = 214.8;
        currentJob.expiresAt = Date.now() + 60 * 60 * 1000;
        currentJob.ttlMinutes = 60;
        currentJob.updatedAt = Date.now();
      }
    }
  }, 500);

  return job;
}
