import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, Database, Gauge, Globe, Pause, Play, Trash2, Zap } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";

/**
 * 9.18jjjj (audit design v4 — onglet Système) — DIAGNOSTICS RÉELS.
 *
 * Avant : CPU/RAM/réseau simulés (Math.random), « pics » et PIDs codés en
 * dur, actions factices (« Speed Test Burst », « RAM Cache Flush ») — le
 * tout présenté comme un « real-time resource monitor ». Contraire au
 * principe produit : jamais de chiffre inventé.
 *
 * Désormais : polling de /api/system/metrics (CPU du processus Node en
 * delta process.cpuUsage, mémoire système os.*, débit réseau /proc/net/dev).
 * Ce qui n'est pas mesuré s'affiche « — », jamais 0.
 */

interface DiagnosticDataPoint {
  time: string;
  cpu: number | null; // % d'UN cœur — processus Node (bot + panneau)
  memory: number | null; // % mémoire système utilisée
  network: number | null; // Mbps rx+tx (null = compteurs indisponibles)
}

interface MetricsResponse {
  process?: {
    pid?: number;
    cpuPercent?: number;
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
    uptimeSeconds?: number;
    nodeVersion?: string;
  };
  system?: {
    totalMb?: number;
    usedMb?: number;
    usedPercent?: number | null;
    loadAvg1?: number | null;
    loadAvg5?: number | null;
    uptimeSeconds?: number;
    platform?: string;
    cores?: number;
  };
  network?: { rxBps?: number | null; txBps?: number | null };
}

const POLL_MS = 2500;
const MAX_POINTS = 20;

function fmtUptime(s?: number | null): string {
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SystemDiagnostics() {
  const [data, setData] = useState<DiagnosticDataPoint[]>([]);
  const [latest, setLatest] = useState<MetricsResponse>({});
  const [isPaused, setIsPaused] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [cpuPeak, setCpuPeak] = useState<number | null>(null);
  const [netPeak, setNetPeak] = useState<number | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/system/metrics", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const m: MetricsResponse = await res.json();
      setLatest(m);
      setFetchFailed(false);
      const point: DiagnosticDataPoint = {
        time: nowTime(),
        cpu: typeof m.process?.cpuPercent === "number" ? Math.max(0, m.process.cpuPercent) : null,
        memory: typeof m.system?.usedPercent === "number" ? m.system.usedPercent : null,
        network:
          m.network?.rxBps != null || m.network?.txBps != null
            ? Math.round((((m.network?.rxBps ?? 0) + (m.network?.txBps ?? 0)) * 8) / 1e6 * 100) / 100
            : null,
      };
      setData((prev) => {
        const next = [...prev, point];
        if (next.length > MAX_POINTS) next.shift();
        return next;
      });
      if (point.cpu != null) setCpuPeak((p) => (p == null ? point.cpu : Math.max(p, point.cpu ?? 0)));
      if (point.network != null)
        setNetPeak((p) => (p == null ? point.network : Math.max(p, point.network ?? 0)));
    } catch {
      // Métriques injoignables : on garde les dernières valeurs affichées et
      // on le dit — jamais de 0 inventé pour faire joli.
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    if (isPaused) return;
    fetchMetrics();
    const t = setInterval(fetchMetrics, POLL_MS);
    return () => clearInterval(t);
  }, [isPaused, fetchMetrics]);

  const handleResetStats = () => {
    setData([]);
    setCpuPeak(null);
    setNetPeak(null);
  };

  const last = data.length > 0 ? data[data.length - 1] : null;
  const proc = latest.process ?? {};
  const sys = latest.system ?? {};
  const net = latest.network ?? {};
  const netMbps =
    net.rxBps != null || net.txBps != null ? Math.round(((net.rxBps ?? 0) + (net.txBps ?? 0)) * 8 / 1e6 * 100) / 100 : null;
  const heapPercent =
    proc.heapTotalMb && proc.heapTotalMb > 0 && proc.heapUsedMb != null
      ? Math.round((proc.heapUsedMb / proc.heapTotalMb) * 100)
      : null;

  return (
    <div className="space-y-6" data-testid="system-diagnostics">
      {/* En-tête */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Activity className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                Mesures réelles
              </span>
              <span className="text-xs text-zinc-400 font-mono">{POLL_MS / 1000} s / point · {MAX_POINTS} points</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Diagnostics système &amp; ressources</h2>
            <p className="text-xs text-zinc-400 max-w-xl">
              CPU du processus Node (bot + panneau), mémoire système et débit réseau du serveur, mesurés en direct.
              Rien n'est simulé.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused((prev) => !prev)}
            data-testid="diagnostics-pause"
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm ${
              isPaused
                ? "bg-emerald-500 hover:bg-emerald-400 text-black"
                : "bg-white/5 border border-white/10 text-zinc-200 hover:bg-white/10"
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
            <span>{isPaused ? "Reprendre" : "Pause"}</span>
          </button>
          <button
            onClick={handleResetStats}
            title="Effacer l'historique affiché (les mesures repartent de zéro)"
            aria-label="Effacer l'historique affiché"
            className="p-2.5 bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {fetchFailed && (
        <p className="text-xs text-amber-300" data-testid="diagnostics-error">
          Métriques momentanément indisponibles — dernier relevé affiché.
        </p>
      )}

      {/* Trois mesures en direct */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CPU processus */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-amber-500/20 transition">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">CPU processus</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white" data-testid="diagnostics-cpu">
                {last?.cpu != null ? `${Math.round(last.cpu)}%` : "—"}
              </span>
              <span className="text-[11px] text-zinc-400">
                Pic : <strong className="text-zinc-300 font-mono">{cpuPeak != null ? `${Math.round(cpuPeak)}%` : "—"}</strong>
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Charge système : <strong className="text-zinc-300 font-mono">{sys.loadAvg1 ?? "—"}</strong> (1 min)
            </p>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2 border border-white/5">
              <div
                className="bg-amber-500 h-full rounded-full transition-[width] duration-700"
                style={{ width: `${last?.cpu != null ? Math.min(100, last.cpu) : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Mémoire */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-amber-500/20 transition">
          <div className="p-3 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20 shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Mémoire système</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white" data-testid="diagnostics-mem">
                {last?.memory != null ? `${Math.round(last.memory)}%` : "—"}
              </span>
              <span className="text-[11px] text-zinc-400">
                {sys.usedMb != null && sys.totalMb != null
                  ? `${(sys.usedMb / 1024).toFixed(1)} / ${(sys.totalMb / 1024).toFixed(1)} Go`
                  : "—"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Processus Node : <strong className="text-zinc-300 font-mono">{proc.rssMb != null ? `${proc.rssMb.toFixed(1)} Mo` : "—"}</strong>
            </p>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2 border border-white/5">
              <div
                className="bg-sky-400 h-full rounded-full transition-[width] duration-700"
                style={{ width: `${last?.memory != null ? Math.min(100, last.memory) : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Réseau */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-amber-500/20 transition">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Réseau</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white" data-testid="diagnostics-net">
                {netMbps != null ? netMbps : "—"}
                {netMbps != null && <span className="text-xs font-semibold font-sans text-zinc-400"> Mbps</span>}
              </span>
              <span className="text-[11px] text-zinc-400">
                Pic : <strong className="text-zinc-300 font-mono">{netPeak != null ? `${netPeak} Mbps` : "—"}</strong>
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              ↓ {net.rxBps != null ? `${(net.rxBps / 125).toFixed(0)} Kb/s` : "—"} ·{" "}
              ↑ {net.txBps != null ? `${(net.txBps / 125).toFixed(0)} Kb/s` : "—"}
            </p>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2 border border-white/5">
              {/* Barre relative au pic observé — pas d'échelle arbitraire inventée. */}
              <div
                className="bg-emerald-400 h-full rounded-full transition-[width] duration-700"
                style={{ width: `${netPeak != null && netPeak > 0 && netMbps != null ? Math.min(100, (netMbps / netPeak) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Courbes */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-amber-500" />
            <h3 className="font-bold text-sm text-white">Courbes d'utilisation</h3>
            {isPaused && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 text-[11px] font-bold uppercase tracking-wider">
                En pause
              </span>
            )}
          </div>
        </div>

        <div className="p-6">
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#a1a1aa", fontSize: 10, fontWeight: "600" }}
                  stroke="rgba(255,255,255,0.1)"
                />
                {/* Axe gauche : pourcentages (CPU, mémoire) */}
                <YAxis
                  yAxisId="left"
                  domain={[0, 100]}
                  tick={{ fill: "#a1a1aa", fontSize: 10, fontWeight: "600" }}
                  stroke="rgba(255,255,255,0.1)"
                />
                {/* Axe droit : Mbps (le réseau n'est pas un pourcentage) */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, "auto"]}
                  tick={{ fill: "#a1a1aa", fontSize: 10, fontWeight: "600" }}
                  stroke="rgba(255,255,255,0.1)"
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "#0e0e11",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: "#ffffff",
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px", fontWeight: "600" }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="cpu"
                  name="CPU processus (%)"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#f59e0b", strokeWidth: 2 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="memory"
                  name="Mémoire système (%)"
                  stroke="#0ea5e9"
                  strokeWidth={2.5}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#0ea5e9", strokeWidth: 2 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="network"
                  name="Réseau (Mbps)"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#10b981", strokeWidth: 2 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Processus — table réelle */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="font-bold text-sm text-white">Processus</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 text-zinc-400">
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[11px]">Composant</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[11px]">Moteur</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[11px]">PID</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[11px]">Ressources</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[11px] text-right">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="py-3 font-semibold text-zinc-300">Bot + Panneau</td>
                <td className="py-3 text-zinc-400 font-mono">Node {proc.nodeVersion ?? "—"}</td>
                <td className="py-3 text-zinc-400 font-mono">{proc.pid ?? "—"}</td>
                <td className="py-3 font-mono text-amber-400">
                  {proc.cpuPercent != null ? `${proc.cpuPercent}% CPU` : "—"} / {proc.rssMb != null ? `${proc.rssMb.toFixed(1)} Mo` : "—"}
                </td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                    Actif
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-zinc-300">Heap V8</td>
                <td className="py-3 text-zinc-400 font-mono">Garbage collector</td>
                <td className="py-3 text-zinc-400 font-mono">—</td>
                <td className="py-3 font-mono text-amber-400">
                  {proc.heapUsedMb != null ? `${proc.heapUsedMb.toFixed(1)}` : "—"} /{" "}
                  {proc.heapTotalMb != null ? `${proc.heapTotalMb.toFixed(1)} Mo` : "—"}
                </td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/5 border border-white/10 text-zinc-300 font-semibold font-mono">
                    {heapPercent != null ? `${heapPercent}%` : "—"}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-zinc-300">Système</td>
                <td className="py-3 text-zinc-400 font-mono">{sys.platform ?? "—"}</td>
                <td className="py-3 text-zinc-400 font-mono">{sys.cores != null ? `${sys.cores} cœur(s)` : "—"}</td>
                <td className="py-3 font-mono text-amber-400">
                  charge {sys.loadAvg1 ?? "—"} / {sys.loadAvg5 ?? "—"}
                </td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/5 border border-white/10 text-zinc-300 font-semibold font-mono">
                    {fmtUptime(sys.uptimeSeconds)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-400">
          Processus Node lancé depuis {fmtUptime(proc.uptimeSeconds)} — le bot et le panneau partagent le même processus.
        </p>
      </div>
    </div>
  );
}
