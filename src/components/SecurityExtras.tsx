import { useEffect, useRef, useState } from "react";
import { History, Download, Upload, RefreshCw, Trash2 } from "lucide-react";

interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
}

/** M13-adjacent observability: audit trail + backup/restore + AI usage. */
export default function SecurityExtras() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [aiUsage, setAiUsage] = useState<{ todayCount: number; dailyLimit: number; maxConcurrent: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/bot/audit?limit=60", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setEvents(json.events || []);
    } catch {
      setMessage("⚠️ Could not load the audit trail.");
    } finally {
      setAuditLoading(false);
    }
  };

  const loadAiUsage = async () => {
    try {
      const res = await fetch("/api/bot/analytics", { credentials: "same-origin" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.aiUsage) setAiUsage(json.aiUsage);
    } catch {}
  };

  useEffect(() => {
    loadAudit();
    loadAiUsage();
  }, []);

  const downloadBackup = async () => {
    setMessage("");
    try {
      const res = await fetch("/api/bot/backup", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nebula-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("✅ Backup downloaded (config, sanitized — no secrets).");
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || "Backup failed."}`);
    }
  };

  const restoreBackup = async (file: File) => {
    setMessage("");
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/bot/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setMessage(`✅ Restored: ${(data.applied || []).join(", ")}`);
      loadAudit();
      loadAiUsage();
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || "Restore failed."}`);
    }
  };

  const clearAudit = async () => {
    if (!window.confirm("Clear the entire audit trail? This action is itself recorded.")) return;
    try {
      const res = await fetch("/api/bot/audit", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage("🧹 Audit trail cleared.");
      loadAudit();
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || "Could not clear audit trail."}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Backup / restore */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-white/5 text-amber-400 border border-white/5">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Backup &amp; Restore</h3>
            <p className="text-[10px] text-zinc-400">Exports config, group settings, warnings, stats, access policies and panel commands. Secrets and session material are never included.</p>
          </div>
        </div>
        {aiUsage && (
          <div className="grid grid-cols-3 gap-2 max-w-md">
            <div className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-center">
              <div className="text-[10px] text-zinc-400">AI used today</div>
              <div className="text-sm font-bold text-amber-400">{aiUsage.todayCount}/{aiUsage.dailyLimit}</div>
            </div>
            <div className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-center">
              <div className="text-[10px] text-zinc-400">AI concurrency cap</div>
              <div className="text-sm font-bold text-zinc-200">{aiUsage.maxConcurrent}</div>
            </div>
            <div className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-center">
              <div className="text-[10px] text-zinc-400">Audit events</div>
              <div className="text-sm font-bold text-zinc-200">{events.length}</div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadBackup} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Export Backup
          </button>
          <button onClick={() => fileInput.current?.click()} className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Import Backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) restoreBackup(f);
              e.target.value = "";
            }}
          />
        </div>
        {message && <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300">{message}</div>}
      </div>

      {/* Audit trail */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/5 text-amber-400 border border-white/5">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Security Audit Trail</h3>
              <p className="text-[10px] text-zinc-400">Login/logout, RoleGuard policy changes, ACL denials, panel command saves, restores.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={loadAudit} disabled={auditLoading} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-zinc-300 transition flex items-center gap-1.5 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button onClick={clearAudit} className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-950/70 border border-rose-800/50 rounded-lg text-xs text-rose-300 transition flex items-center gap-1.5 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto space-y-1.5">
          {events.length === 0 && (
            <div className="p-3 bg-black/40 border border-white/5 rounded-xl text-xs text-zinc-500">No audit events yet.</div>
          )}
          {events.map((e) => (
            <div key={e.id} className="p-2.5 bg-black/40 border border-white/5 rounded-lg flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-amber-300">{e.action}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{e.at.slice(0, 19).replace("T", " ")}</span>
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-zinc-500">actor:</span> {e.actor} · <span className="text-zinc-500">target:</span> {e.target || "—"}
              </div>
              {e.detail && <div className="text-[10px] text-zinc-500 truncate">{e.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
