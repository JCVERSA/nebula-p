import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import HeroChip from "./HeroChip";
import {
  Download,
  FolderArchive,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Play,
  FileArchive,
  HardDrive,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Radio,
  XCircle,
  AlertTriangle,
  RotateCcw,
  WifiOff,
  Bug,
} from "lucide-react";

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
}

interface StorageStats {
  totalFiles: number;
  zipCount: number;
  otherCount: number;
  totalMB: number;
  oldestZipAgeMinutes: number;
  zipRetentionLimitMinutes: number;
  activeTokensCount: number;
}

export interface BatchDownloadStatusProps {
  onSimulateCommand?: (cmd: string) => void;
  className?: string;
}

export const BatchDownloadStatus: React.FC<BatchDownloadStatusProps> = ({
  className = "",
}) => {
  const [jobs, setJobs] = useState<BatchDownloadJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isSimulatingBatch, setIsSimulatingBatch] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isRetryingJob, setIsRetryingJob] = useState<string | null>(null);
  const [retryingEpisode, setRetryingEpisode] = useState<{ jobId: string; epNum: number } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Test simulation params
  const [simAnime, setSimAnime] = useState("Solo Leveling");
  const [simSeason, setSimSeason] = useState("Saison 2");
  const [simCount, setSimCount] = useState(5);
  const [simResolution, setSimResolution] = useState("720p");
  const [simLang, setSimLang] = useState("VF");
  const [simTriggerError, setSimTriggerError] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchBatchJobs = async () => {
    try {
      const res = await fetch("/api/batch-downloads");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.jobs)) {
        setJobs(data.jobs);
        if (!selectedJobId && data.jobs.length > 0) {
          setSelectedJobId(data.jobs[0].id);
        }
      }
      if (data.storage) {
        setStorageStats(data.storage);
      }
    } catch {
      // Silent error for polling
    }
  };

  useEffect(() => {
    fetchBatchJobs();

    // Check if any job is currently active (queued, downloading, or packaging)
    const hasActiveJob = jobs.some(
      (j) => j.status === "downloading" || j.status === "packaging" || j.status === "queued"
    );

    const intervalTime = hasActiveJob ? 1500 : 5000;
    pollIntervalRef.current = setInterval(fetchBatchJobs, intervalTime);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [jobs]);

  const activeJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null;

  const handleStartSimulatedBatch = async () => {
    setIsSimulatingBatch(true);
    try {
      const res = await fetch("/api/batch-downloads/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animeTitle: simAnime,
          season: simSeason,
          totalEpisodes: simCount,
          resolution: simResolution,
          language: simLang,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.job) {
          setSelectedJobId(data.job.id);
          fetchBatchJobs();

          if (simTriggerError) {
            setTimeout(async () => {
              await fetch(`/api/batch-downloads/simulate-error/${data.job.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ errorType: "network" }),
              });
              fetchBatchJobs();
            }, 2500);
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to start simulated batch:", err);
    } finally {
      setIsSimulatingBatch(false);
      setShowConfigModal(false);
    }
  };

  const handleRetryBatch = async (jobId: string) => {
    setIsRetryingJob(jobId);
    setActionFeedback("Retrying batch download streams...");
    try {
      const res = await fetch(`/api/batch-downloads/retry/${jobId}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setActionFeedback("Batch retry initiated successfully!");
        if (data.job) {
          setJobs((prev) => prev.map((j) => (j.id === jobId ? data.job : j)));
        }
        await fetchBatchJobs();
      } else {
        const err = await res.json();
        setActionFeedback(`Retry failed: ${err.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setActionFeedback(`Network error during retry: ${err.message}`);
    } finally {
      setIsRetryingJob(null);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };

  const handleRetryEpisode = async (jobId: string, epNum: number) => {
    setRetryingEpisode({ jobId, epNum });
    try {
      const res = await fetch(`/api/batch-downloads/retry-episode/${jobId}/${epNum}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.job) {
          setJobs((prev) => prev.map((j) => (j.id === jobId ? data.job : j)));
        }
        await fetchBatchJobs();
      }
    } catch (err: any) {
      console.error("Episode retry error:", err);
    } finally {
      setRetryingEpisode(null);
    }
  };

  const handleInjectError = async (jobId: string, errorType: "network" | "episode", epNum?: number) => {
    try {
      await fetch(`/api/batch-downloads/simulate-error/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errorType, epNum }),
      });
      await fetchBatchJobs();
    } catch (err: any) {
      console.error("Failed to inject error:", err);
    }
  };

  const handleTriggerCleanup = async () => {
    setIsCleaning(true);
    setCleanupMessage(null);
    try {
      const res = await fetch("/api/batch-downloads/cleanup", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const cleaned = data.result?.cleanedFiles || 0;
        const freedMB = data.result?.freedMB || 0;
        setCleanupMessage(`Cleaned ${cleaned} file(s), freed ${freedMB} MB (60m TTL enforced)`);
        if (data.storage) {
          setStorageStats(data.storage);
        }
        fetchBatchJobs();
      }
    } catch (err: any) {
      setCleanupMessage("Cleanup failed: " + err.message);
    } finally {
      setIsCleaning(false);
      setTimeout(() => setCleanupMessage(null), 5000);
    }
  };

  const copyZipLink = (url: string, id: string) => {
    const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedToken(id);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const calculateTimeRemaining = (expiresAt?: number) => {
    if (!expiresAt) return "60m";
    const diffMs = expiresAt - Date.now();
    if (diffMs <= 0) return "Expired";
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const failedEpisodesCount = activeJob?.episodes.filter((e) => e.status === "failed").length || 0;

  return (
    <div
      id="batch-download-status-container"
      className={`bg-[#0e161c] border border-white/10 rounded-2xl overflow-hidden shadow-xl ${className}`}
    >
      {/* Header Bar */}
      <div className="bg-[#18232c] border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <FolderArchive className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-xs text-white tracking-tight">Batch Download Monitor</h3>
              {activeJob && (
                <HeroChip
                  variant="dot"
                  size="sm"
                  color={
                    activeJob.status === "completed"
                      ? "success"
                      : activeJob.status === "failed"
                      ? "danger"
                      : activeJob.status === "packaging"
                      ? "secondary"
                      : activeJob.status === "downloading"
                      ? "warning"
                      : "default"
                  }
                >
                  {activeJob.status.toUpperCase()}
                </HeroChip>
              )}
            </div>
            <p className="text-[10px] text-zinc-400">
              Concurrent stream engine with automatic retry &amp; 60m ZIP cleanup
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowConfigModal(true)}
            className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] rounded-lg transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Start a simulated concurrent batch download"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Simulate Batch</span>
          </button>

          <button
            onClick={fetchBatchJobs}
            className="p-1.5 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition border border-white/5 cursor-pointer"
            title="Refresh Status"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-1.5 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition border border-white/5 cursor-pointer"
            title={showDetails ? "Collapse View" : "Expand View"}
          >
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-4 space-y-4">
        {actionFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3 py-2 rounded-xl flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>{actionFeedback}</span>
          </motion.div>
        )}

        {/* Job selector tabs if multiple batches exist */}
        {jobs.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 dark-scroll">
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setSelectedJobId(j.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition shrink-0 flex items-center gap-1.5 cursor-pointer border ${
                  selectedJobId === j.id
                    ? j.status === "failed"
                      ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                      : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    j.status === "completed"
                      ? "bg-emerald-400"
                      : j.status === "failed"
                      ? "bg-rose-500 animate-pulse"
                      : j.status === "downloading"
                      ? "bg-amber-400 animate-pulse"
                      : "bg-zinc-500"
                  }`}
                />
                <span>
                  {j.animeTitle.slice(0, 14)} ({j.season})
                </span>
                <span className="text-[10px] text-zinc-500">[{j.progressPercent}%]</span>
              </button>
            ))}
          </div>
        )}

        {/* Active Job Display Card */}
        {activeJob ? (
          <div className="space-y-4">
            {/* Top metadata row */}
            <div className={`bg-[#121c23] border ${activeJob.status === "failed" ? "border-rose-500/30" : "border-white/10"} rounded-xl p-3.5 space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{activeJob.animeTitle}</span>
                    <span className="text-xs font-normal text-amber-400 font-mono">
                      {activeJob.season}
                    </span>
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-0.5">
                    <span>
                      Language: <b className="text-zinc-200">{activeJob.language}</b>
                    </span>
                    <span>•</span>
                    <span>
                      Quality: <b className="text-zinc-200">{activeJob.resolution}</b>
                    </span>
                    <span>•</span>
                    <span>
                      Streams:{" "}
                      <b className="text-zinc-200">
                        {activeJob.completedEpisodes}/{activeJob.totalEpisodes} done
                      </b>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Quick simulation error test controls */}
                  <div className="hidden sm:flex items-center gap-1">
                    {activeJob.status === "downloading" && (
                      <button
                        onClick={() => handleInjectError(activeJob.id, "network")}
                        className="px-2 py-1 bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-white/5 rounded-lg text-[10px] transition flex items-center gap-1 cursor-pointer"
                        title="Simulate network failure"
                      >
                        <Bug className="w-3 h-3 text-rose-400" />
                        <span>Sim Error</span>
                      </button>
                    )}
                  </div>

                  <div className="text-right">
                    <span className={`text-lg font-black font-mono ${activeJob.status === "failed" ? "text-rose-400" : "text-amber-400"}`}>
                      {Math.round(activeJob.progressPercent)}%
                    </span>
                    <p className="text-[10px] text-zinc-500 font-mono">
                      {activeJob.status === "completed"
                        ? "All files ready"
                        : activeJob.status === "failed"
                        ? "Stream halted"
                        : "Real-time sync"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Network / Stream Failure Visual Alert Banner with Retry Button */}
              {(activeJob.status === "failed" || activeJob.error) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-3.5 space-y-2.5 shadow-lg shadow-rose-950/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
                        <WifiOff className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                          <span>Download Stream Failure</span>
                          <span className="px-1.5 py-0.2 bg-rose-500/20 border border-rose-500/30 rounded text-[10px] font-mono text-rose-400">
                            Network / CDN Error
                          </span>
                        </h5>
                        <p className="text-[11px] text-zinc-300 mt-0.5 max-w-lg">
                          {activeJob.error || activeJob.currentStatusText || "Connection timed out while fetching episode stream chunks."}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRetryBatch(activeJob.id)}
                        disabled={isRetryingJob === activeJob.id}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs rounded-xl transition flex items-center gap-2 shadow-lg shadow-rose-950/50 cursor-pointer disabled:opacity-50"
                        title="Retry all failed streams in this batch"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${isRetryingJob === activeJob.id ? "animate-spin" : ""}`} />
                        <span>{isRetryingJob === activeJob.id ? "Retrying..." : "Retry Batch"}</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Completed Episodes Animated Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                    {activeJob.status === "failed" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>Episodes Completed</span>
                  </span>
                  <span className="font-mono text-xs font-bold text-amber-400">
                    {activeJob.completedEpisodes} / {activeJob.totalEpisodes}{" "}
                    <span className="text-[11px] font-normal text-zinc-400 font-sans">
                      ({activeJob.totalEpisodes > 0 ? Math.round((activeJob.completedEpisodes / activeJob.totalEpisodes) * 100) : 0}%)
                    </span>
                  </span>
                </div>

                {/* Animated Master Completed Episodes Progress Bar */}
                <div className="relative w-full h-3.5 bg-black/60 rounded-full overflow-hidden border border-white/10 p-0.5 shadow-inner">
                  <motion.div
                    className={`h-full rounded-full ${
                      activeJob.status === "failed"
                        ? "bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                        : activeJob.completedEpisodes >= activeJob.totalEpisodes && activeJob.totalEpisodes > 0
                        ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                        : "bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400 shadow-[0_0_10px_rgba(245,158,11,0.4)]"
                    }`}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${
                        activeJob.totalEpisodes > 0
                          ? Math.max(activeJob.completedEpisodes > 0 ? 4 : 0, (activeJob.completedEpisodes / activeJob.totalEpisodes) * 100)
                          : 0
                      }%`,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 85,
                      damping: 18,
                    }}
                  />
                </div>

                {/* Segmented Episode Dots / Blocks Indicator */}
                {activeJob.totalEpisodes > 0 && activeJob.totalEpisodes <= 16 && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {activeJob.episodes.map((ep, idx) => {
                      const isCompleted = ep.status === "completed";
                      const isFailed = ep.status === "failed";
                      const isCurrent = ep.status === "downloading";
                      return (
                        <div
                          key={idx}
                          className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5 border border-white/5 relative"
                          title={`Episode ${idx + 1}: ${isFailed ? "Failed" : isCompleted ? "Completed" : isCurrent ? "In progress" : "Pending"}`}
                        >
                          <motion.div
                            initial={false}
                            animate={{
                              width: isCompleted || isFailed ? "100%" : isCurrent ? "50%" : "0%",
                              opacity: isCompleted || isFailed ? 1 : isCurrent ? 0.8 : 0.2,
                            }}
                            transition={{ duration: 0.35 }}
                            className={`h-full rounded-full ${
                              isFailed
                                ? "bg-rose-500"
                                : isCompleted
                                ? "bg-emerald-400"
                                : isCurrent
                                ? "bg-amber-400 animate-pulse"
                                : "bg-transparent"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    {activeJob.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    ) : activeJob.status === "downloading" ? (
                      <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                    ) : activeJob.status === "completed" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Clock className="w-3 h-3 text-zinc-400" />
                    )}
                    <span className={activeJob.status === "failed" ? "text-rose-300 font-medium" : ""}>
                      {activeJob.currentStatusText}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {activeJob.totalEpisodes - activeJob.completedEpisodes === 0
                      ? "All episodes ready"
                      : `${activeJob.totalEpisodes - activeJob.completedEpisodes} remaining`}
                  </span>
                </div>
              </div>

              {/* Completed ZIP Action Box */}
              {activeJob.status === "completed" && activeJob.zipDownloadUrl && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3.5 space-y-2.5 mt-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                        <FileArchive className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <span>ZIP Archive Generated &amp; Ready</span>
                          <span className="px-1.5 py-0.2 bg-emerald-500/20 rounded text-[10px] font-mono text-emerald-400">
                            {activeJob.zipSizeMB || "214.8"} MB
                          </span>
                        </h5>
                        <p className="text-[10px] text-zinc-400 truncate max-w-xs font-mono">
                          {activeJob.zipFilename || "Season_Complete.zip"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyZipLink(activeJob.zipDownloadUrl!, activeJob.id)}
                        className="px-3 py-2 bg-white/10 hover:bg-white/20 text-zinc-200 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10 cursor-pointer"
                        title="Copy direct download link"
                      >
                        {copiedToken === activeJob.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedToken === activeJob.id ? "Copied!" : "Copy Link"}</span>
                      </button>

                      <a
                        href={activeJob.zipDownloadUrl}
                        download={activeJob.zipFilename || "season.zip"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
                        id="retrieve-zip-download-btn"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download ZIP Archive</span>
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-emerald-500/20 text-[10px] text-emerald-400/80 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>
                        Automatic Cleanup in:{" "}
                        <strong className="text-emerald-300">
                          {calculateTimeRemaining(activeJob.expiresAt)}
                        </strong>
                      </span>
                    </span>
                    <span>Server storage policy: 60 min TTL</span>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Concurrent Episode Stream List */}
            {showDetails && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                  <span className="font-bold text-zinc-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-amber-400" />
                    <span>Concurrent Stream Progress ({activeJob.episodes.length} episodes)</span>
                  </span>

                  {failedEpisodesCount > 0 && activeJob.status !== "failed" && (
                    <button
                      onClick={() => handleRetryBatch(activeJob.id)}
                      disabled={isRetryingJob === activeJob.id}
                      className="px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3 h-3 ${isRetryingJob === activeJob.id ? "animate-spin" : ""}`} />
                      <span>Retry Failed ({failedEpisodesCount})</span>
                    </button>
                  )}
                </div>

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 dark-scroll">
                  {activeJob.episodes.map((ep) => (
                    <div
                      key={ep.epNum}
                      className={`border rounded-xl p-2.5 flex items-center justify-between gap-3 transition text-xs ${
                        ep.status === "failed"
                          ? "bg-rose-950/25 border-rose-500/30"
                          : "bg-[#11191f] border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-[130px]">
                        <span
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center font-mono font-bold text-[10px] ${
                            ep.status === "failed"
                              ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                              : "bg-white/5 border-white/10 text-amber-400"
                          }`}
                        >
                          {ep.epNum < 10 ? `0${ep.epNum}` : ep.epNum}
                        </span>
                        <div className="truncate max-w-[160px]">
                          <span className={`font-semibold ${ep.status === "failed" ? "text-rose-200" : "text-zinc-200"}`}>
                            Episode {ep.epNum}
                          </span>
                          {ep.sizeMB > 0 && (
                            <span className="text-[10px] text-zinc-400 font-mono ml-1.5">
                              ({ep.sizeMB} MB)
                            </span>
                          )}
                          {ep.error && (
                            <p className="text-[10px] text-rose-400 truncate mt-0.5 font-mono" title={ep.error}>
                              {ep.error}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Stream Progress */}
                      <div className="flex-1 max-w-[180px] hidden sm:block">
                        <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-white/5">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              ep.status === "completed"
                                ? "bg-emerald-400"
                                : ep.status === "downloading"
                                ? "bg-amber-400"
                                : ep.status === "failed"
                                ? "bg-rose-500"
                                : "bg-zinc-700"
                            }`}
                            style={{ width: `${ep.progressPercent || 0}%` }}
                          />
                        </div>
                      </div>

                      {/* Status indicator & Episode Retry Button */}
                      <div className="flex items-center gap-2 shrink-0">
                        {ep.status === "completed" ? (
                          <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>100%</span>
                            {ep.downloadUrl && (
                              <a
                                href={ep.downloadUrl}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1 p-1 bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white rounded transition"
                                title="Download single episode"
                              >
                                <Download className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : ep.status === "downloading" ? (
                          <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-mono">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>{ep.progressPercent}%</span>
                          </div>
                        ) : ep.status === "failed" ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-rose-400 text-[11px] font-medium" title={ep.error}>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                              <span>Failed</span>
                            </div>
                            <button
                              onClick={() => handleRetryEpisode(activeJob.id, ep.epNum)}
                              disabled={retryingEpisode?.jobId === activeJob.id && retryingEpisode?.epNum === ep.epNum}
                              className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 hover:text-white border border-rose-500/40 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-sm"
                              title={`Retry stream for Episode ${ep.epNum}`}
                            >
                              <RotateCcw
                                className={`w-3 h-3 ${
                                  retryingEpisode?.jobId === activeJob.id && retryingEpisode?.epNum === ep.epNum
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              <span>
                                {retryingEpisode?.jobId === activeJob.id && retryingEpisode?.epNum === ep.epNum
                                  ? "Retrying..."
                                  : "Retry"}
                              </span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-zinc-500 text-[11px] font-mono">
                            <Clock className="w-3 h-3" />
                            <span>Queued</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[#121c23] border border-white/10 rounded-xl p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500 mx-auto">
              <FolderArchive className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-white">No Active Batch Downloads</h4>
              <p className="text-[11px] text-zinc-400 max-w-sm mx-auto">
                Trigger a batch download by typing <code className="text-amber-400 font-mono">.a s1 all</code> in the WhatsApp simulator, or click below to simulate a concurrent batch.
              </p>
            </div>
            <button
              onClick={() => setShowConfigModal(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition inline-flex items-center gap-2 cursor-pointer shadow-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Simulate Batch Download</span>
            </button>
          </div>
        )}

        {/* Server Storage & 60-Minute Cleanup Telemetry Card */}
        <div className="bg-[#121c23] border border-white/10 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-zinc-400" />
            <div>
              <span className="font-bold text-zinc-200">Temp Storage Optimization</span>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                <span>Stored: {storageStats?.totalMB || "0.00"} MB</span>
                <span>•</span>
                <span>Active ZIPs: {storageStats?.zipCount || 0}</span>
                <span>•</span>
                <span className="text-amber-400 font-semibold">60m Retention TTL</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cleanupMessage && (
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
                {cleanupMessage}
              </span>
            )}
            <button
              onClick={handleTriggerCleanup}
              disabled={isCleaning}
              className="px-3 py-1.5 bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/30 text-zinc-300 hover:text-rose-300 border border-white/10 rounded-lg text-[11px] font-medium transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Manually trigger cleanup task for files older than 60 minutes"
            >
              {isCleaning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              <span>Purge Expired</span>
            </button>
          </div>
        </div>
      </div>

      {/* Simulation Configuration Modal */}
      <AnimatePresence>
        {showConfigModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#141f27] border border-white/20 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Configure Batch Simulation</span>
                </h3>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-zinc-300 font-bold block mb-1">Anime Series</label>
                  <select
                    value={simAnime}
                    onChange={(e) => setSimAnime(e.target.value)}
                    className="w-full bg-[#0b1216] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400 font-medium"
                  >
                    <option value="Solo Leveling">Solo Leveling (Ore dake Level Up)</option>
                    <option value="Demon Slayer">Demon Slayer: Kimetsu no Yaiba</option>
                    <option value="Jujutsu Kaisen">Jujutsu Kaisen Season 2</option>
                    <option value="Attack on Titan">Attack on Titan (Shingeki no Kyojin)</option>
                    <option value="Chainsaw Man">Chainsaw Man</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-zinc-300 font-bold block mb-1">Season</label>
                    <select
                      value={simSeason}
                      onChange={(e) => setSimSeason(e.target.value)}
                      className="w-full bg-[#0b1216] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                    >
                      <option value="Saison 1">Saison 1</option>
                      <option value="Saison 2">Saison 2</option>
                      <option value="Saison 3">Saison 3</option>
                      <option value="Saison 4">Saison 4</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-300 font-bold block mb-1">Episode Count</label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={simCount}
                      onChange={(e) => setSimCount(Math.min(12, Math.max(2, parseInt(e.target.value) || 2)))}
                      className="w-full bg-[#0b1216] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-zinc-300 font-bold block mb-1">Quality</label>
                    <select
                      value={simResolution}
                      onChange={(e) => setSimResolution(e.target.value)}
                      className="w-full bg-[#0b1216] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                    >
                      <option value="720p">720p (HD)</option>
                      <option value="1080p">1080p (Full HD)</option>
                      <option value="480p">480p (SD)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-300 font-bold block mb-1">Language</label>
                    <select
                      value={simLang}
                      onChange={(e) => setSimLang(e.target.value)}
                      className="w-full bg-[#0b1216] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                    >
                      <option value="VF">VF (French Audio)</option>
                      <option value="VOSTFR">VOSTFR (Subbed)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="sim-trigger-error-checkbox"
                    checked={simTriggerError}
                    onChange={(e) => setSimTriggerError(e.target.checked)}
                    className="rounded bg-[#0b1216] border-white/20 text-rose-500 focus:ring-rose-500"
                  />
                  <label htmlFor="sim-trigger-error-checkbox" className="text-zinc-300 text-xs cursor-pointer">
                    Simulate network interruption mid-stream (to test visual retry flow)
                  </label>
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-300 space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    <span>⚡ Concurrent Batch Download Test:</span>
                  </p>
                  <p className="text-zinc-300">
                    This will spawn {simCount} parallel download threads, simulate live chunk streaming, and package a valid downloadable ZIP archive with automatic 60-minute storage expiration.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStartSimulatedBatch}
                  disabled={isSimulatingBatch}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-md"
                >
                  {isSimulatingBatch ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                  <span>Launch Batch Process</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};