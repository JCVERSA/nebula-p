import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Cpu,
  Terminal,
  Clock,
  PackageCheck,
  Copy,
  Check,
  X,
  Layers,
  Zap,
} from "lucide-react";
import { CheckupReport } from "../lib/types";

interface CheckupModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: CheckupReport | null;
  isLoading: boolean;
  onRunCheckup: () => void;
}

export default function CheckupModal({
  isOpen,
  onClose,
  report,
  isLoading,
  onRunCheckup,
}: CheckupModalProps) {
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyReport = () => {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredTests = report?.tests.filter((t) => {
    if (selectedFilter === "all") return true;
    if (selectedFilter === "pass") return t.status === "pass";
    if (selectedFilter === "warn") return t.status === "warn";
    if (selectedFilter === "fail") return t.status === "fail";
    if (selectedFilter === "simulation") return t.category === "simulation";
    return true;
  }) || [];

  const passCount = report?.tests.filter((t) => t.status === "pass").length || 0;
  const warnCount = report?.tests.filter((t) => t.status === "warn").length || 0;
  const failCount = report?.tests.filter((t) => t.status === "fail").length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0e0e11] border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">Full System & Commands Checkup</h2>
                {report && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                      report.overallStatus === "healthy"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : report.overallStatus === "warning"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    }`}
                  >
                    {report.overallStatus} ({report.healthScore}%)
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                End-to-end diagnostic verification of command registry, database, codecs, security sandbox, and simulation engine.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRunCheckup}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-amber-400 transition disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Running..." : "Re-Run Checkup"}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-xl p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 dark-scroll">
          
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-4 border-amber-500/20 border-t-amber-400 animate-spin" />
                <Activity className="absolute inset-0 m-auto h-6 w-6 text-amber-400" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-white">Running Full System Diagnostics</h3>
                <p className="text-xs text-zinc-400">Testing command registry, memory caches, codecs, SSRF sandbox, and simulating commands...</p>
              </div>
            </div>
          )}

          {!isLoading && report && (
            <>
              {/* Top Overview Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-zinc-400 text-xs">
                    <span>Health Score</span>
                    <Zap className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-white">{report.healthScore}%</span>
                    <span className="text-[11px] text-zinc-400">({report.durationMs}ms)</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        report.healthScore >= 90
                          ? "bg-emerald-400"
                          : report.healthScore >= 70
                          ? "bg-amber-400"
                          : "bg-rose-400"
                      }`}
                      style={{ width: `${report.healthScore}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-zinc-400 text-xs">
                    <span>Registered Commands</span>
                    <Layers className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-black text-white">{report.commands.totalRegistered}</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {Object.keys(report.commands.byCategory).length} categories, {report.commands.aliasesCount} aliases
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-zinc-400 text-xs">
                    <span>Memory Allocation</span>
                    <Cpu className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-black text-white">{report.system.memory.heapUsedMB} MB</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Heap: {report.system.memory.heapTotalMB} MB | RSS: {report.system.memory.rssMB} MB
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-zinc-400 text-xs">
                    <span>Test Suite Status</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs font-semibold text-emerald-400">{passCount} Pass</span>
                    <span className="text-xs font-semibold text-amber-400">{warnCount} Warn</span>
                    <span className="text-xs font-semibold text-rose-400">{failCount} Fail</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Uptime: {Math.floor(report.system.uptimeSeconds / 60)}m ({report.system.nodeVersion})
                  </p>
                </div>
              </div>

              {/* Subsystems Summary Banner */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-amber-400" />
                  Installed Native Codecs & Libraries ({report.dependencies.filter((d) => d.available).length}/{report.dependencies.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {report.dependencies.map((dep) => (
                    <div
                      key={dep.name}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs border ${
                        dep.available
                          ? "bg-white/[0.02] border-white/10 text-zinc-300"
                          : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                      }`}
                    >
                      <span className="truncate font-mono text-[11px]">{dep.name}</span>
                      {dep.available ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 ml-1.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 ml-1.5" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Individual Diagnostic Tests List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-amber-400" />
                    Automated Verification Suite ({filteredTests.length} tests)
                  </h4>
                  
                  {/* Filters */}
                  <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10 text-[11px]">
                    <button
                      onClick={() => setSelectedFilter("all")}
                      className={`px-2.5 py-0.5 rounded-md transition ${
                        selectedFilter === "all" ? "bg-amber-500 text-black font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      All ({report.tests.length})
                    </button>
                    <button
                      onClick={() => setSelectedFilter("simulation")}
                      className={`px-2.5 py-0.5 rounded-md transition ${
                        selectedFilter === "simulation" ? "bg-amber-500 text-black font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Commands
                    </button>
                    <button
                      onClick={() => setSelectedFilter("pass")}
                      className={`px-2.5 py-0.5 rounded-md transition ${
                        selectedFilter === "pass" ? "bg-emerald-500/30 text-emerald-300 font-bold" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Passed ({passCount})
                    </button>
                    {warnCount > 0 && (
                      <button
                        onClick={() => setSelectedFilter("warn")}
                        className={`px-2.5 py-0.5 rounded-md transition ${
                          selectedFilter === "warn" ? "bg-amber-500/30 text-amber-300 font-bold" : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        Warnings ({warnCount})
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {filteredTests.map((test, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.04] transition"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 shrink-0">
                          {test.status === "pass" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                          {test.status === "warn" && <AlertTriangle className="h-4 w-4 text-amber-400" />}
                          {test.status === "fail" && <XCircle className="h-4 w-4 text-rose-400" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">{test.name}</span>
                            <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400 uppercase">
                              {test.category}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 truncate mt-0.5">{test.message}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-500">
                          <Clock className="h-3 w-3" />
                          <span>{test.latencyMs}ms</span>
                        </div>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            test.status === "pass"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : test.status === "warn"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {test.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-3.5 bg-black/40 text-xs text-zinc-500">
          <div>
            {report && <span>Last verified: {new Date(report.timestamp).toLocaleTimeString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyReport}
              disabled={!report}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white transition disabled:opacity-50 cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied JSON" : "Copy Diagnostic JSON"}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
