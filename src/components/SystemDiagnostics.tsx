import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Database,
  Globe,
  Sun,
  Moon,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Gauge,
  Wifi,
  Activity,
  Zap,
} from "lucide-react";
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

interface DiagnosticDataPoint {
  time: string;
  cpu: number;
  memory: number; // in %
  network: number; // in Mbps
}

export default function SystemDiagnostics() {
  const [data, setData] = useState<DiagnosticDataPoint[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [chartTheme, setChartTheme] = useState<"dark" | "light">("dark");
  const [activeNetworkBurst, setActiveNetworkBurst] = useState(false);
  const [isFlushingMemory, setIsFlushingMemory] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Stats averages
  const [cpuPeak, setCpuPeak] = useState(38);
  const [memoryCurrent, setMemoryCurrent] = useState(54);
  const [networkPeak, setNetworkPeak] = useState(18.4);

  // Use a ref to keep track of the simulation state to prevent re-renders breaking logic
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const activeNetworkBurstRef = useRef(activeNetworkBurst);
  activeNetworkBurstRef.current = activeNetworkBurst;

  // Initialize data with some realistic start coordinates
  useEffect(() => {
    const initialData: DiagnosticDataPoint[] = [];
    const now = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3000);
      const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      initialData.push({
        time: timeStr,
        cpu: Math.floor(15 + Math.random() * 20),
        memory: Math.floor(48 + Math.random() * 5),
        network: parseFloat((2 + Math.random() * 12).toFixed(1)),
      });
    }
    setData(initialData);
  }, []);

  // Set up periodic real-time updates every 2.5s
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPausedRef.current) return;

      setData((prev) => {
        const nextData = [...prev];
        if (nextData.length >= 20) {
          nextData.shift();
        }

        const d = new Date();
        const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        // Calculate next CPU
        const cpuBase = 18;
        const cpuNoise = Math.random() * 15;
        let cpuVal = Math.floor(cpuBase + cpuNoise);
        if (activeNetworkBurstRef.current) {
          cpuVal += Math.floor(25 + Math.random() * 15); // burst makes CPU spike too
        }
        cpuVal = Math.min(cpuVal, 100);

        // Calculate next Memory
        let memVal = memoryCurrent;
        if (isFlushingMemory) {
          // Drops memory down gracefully
          memVal = Math.max(28, memVal - Math.floor(8 + Math.random() * 6));
        } else {
          // memory slowly leaks or fluctuates
          memVal = Math.min(85, Math.max(30, memVal + (Math.random() > 0.45 ? 1 : -1)));
        }
        setMemoryCurrent(memVal);

        // Calculate next Network
        let netVal = parseFloat((1.5 + Math.random() * 8).toFixed(1));
        if (activeNetworkBurstRef.current) {
          netVal = parseFloat((120 + Math.random() * 85).toFixed(1));
        }

        // Update peaks
        if (cpuVal > cpuPeak) setCpuPeak(cpuVal);
        if (netVal > networkPeak) setNetworkPeak(netVal);

        nextData.push({
          time: timeStr,
          cpu: cpuVal,
          memory: memVal,
          network: netVal,
        });

        return nextData;
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [memoryCurrent, cpuPeak, networkPeak, isFlushingMemory]);

  const handleFlushMemory = () => {
    if (isFlushingMemory) return;
    setIsFlushingMemory(true);
    setLastAction("Memory optimization flush initiated...");
    
    setTimeout(() => {
      setIsFlushingMemory(false);
      setLastAction("Memory flush completed. Freed 24% allocation cache.");
    }, 6000);
  };

  const handleSpeedTest = () => {
    if (activeNetworkBurst) return;
    setActiveNetworkBurst(true);
    setLastAction("Network Speed Test burst launched!");
    
    setTimeout(() => {
      setActiveNetworkBurst(false);
      setLastAction("Network spike complete. Recorded peak: " + networkPeak + " Mbps.");
    }, 8000);
  };

  const handleResetStats = () => {
    const now = new Date();
    const cleanPoint: DiagnosticDataPoint = {
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      cpu: 12,
      memory: 45,
      network: 1.2,
    };
    setData([cleanPoint]);
    setCpuPeak(12);
    setMemoryCurrent(45);
    setNetworkPeak(1.2);
    setLastAction("Historical resource metrics reset.");
  };

  // Styles based on selected chart theme
  const isLight = chartTheme === "light";
  const themeBgClass = isLight ? "bg-[#f8fafc] border-[#e2e8f0]" : "bg-[#0b0b0c] border-white/10";
  const themeTextClass = isLight ? "text-[#1e293b]" : "text-white";
  const themeSubtextClass = isLight ? "text-[#64748b]" : "text-zinc-400";
  const themeGridColor = isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.05)";
  const themeAxisColor = isLight ? "#64748b" : "#71717a";

  return (
    <div className="space-y-6">
      {/* Visual Header */}
      <div className="bg-gradient-to-r from-[#141416] via-[#0e0e10] to-black border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Activity className="w-7 h-7 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                Core Diagnostics
              </span>
              <span className="text-xs text-zinc-500 font-mono">Real-time resource monitor</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">System & Resource Diagnostics</h2>
            <p className="text-xs text-zinc-400 max-w-xl">
              Inspect active performance, CPU load balancing, volatile RAM memory utilization, and network socket bandwidth spikes.
            </p>
          </div>
        </div>

        {/* Diagnostic state controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused((prev) => !prev)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm ${
              isPaused 
                ? "bg-emerald-500 hover:bg-emerald-400 text-black" 
                : "bg-white/5 border border-white/10 text-zinc-200 hover:bg-white/10"
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
            <span>{isPaused ? "Resume Monitor" : "Pause Monitor"}</span>
          </button>
          
          <button
            onClick={handleResetStats}
            title="Clear resource statistics history"
            className="p-2.5 bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid of Real-time Metric Overviews */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CPU overview card */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-amber-500/20 transition-all">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">CPU UTILIZATION</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {data.length > 0 ? data[data.length - 1].cpu : 0}%
              </span>
              <span className="text-[10px] text-zinc-500">
                Peak: <strong className="text-zinc-400 font-mono">{cpuPeak}%</strong>
              </span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2">
              <div 
                className="bg-amber-500 h-full rounded-full transition-all duration-700"
                style={{ width: `${data.length > 0 ? data[data.length - 1].cpu : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Memory overview card */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-sky-500/20 transition-all">
          <div className="p-3 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20 shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">MEMORY ALLOCATION</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {memoryCurrent}%
              </span>
              <span className="text-[10px] text-zinc-500">
                System: <strong className="text-zinc-400 font-mono">1.6 / 3.0 GB</strong>
              </span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2">
              <div 
                className={`h-full rounded-full transition-all duration-1000 ${isFlushingMemory ? "bg-emerald-400" : "bg-sky-400"}`}
                style={{ width: `${memoryCurrent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Network overview card */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-xl p-5 flex items-start gap-4 shadow-sm hover:border-emerald-500/20 transition-all">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">SOCKET BANDWIDTH</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {data.length > 0 ? data[data.length - 1].network : 0} <span className="text-xs font-semibold font-sans text-zinc-400">Mbps</span>
              </span>
              <span className="text-[10px] text-zinc-500">
                Peak: <strong className="text-zinc-400 font-mono">{networkPeak}M</strong>
              </span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2">
              <div 
                className="bg-emerald-400 h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, ((data.length > 0 ? data[data.length - 1].network : 0) / 250) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Interactive Charts Area with Light/Dark toggler */}
      <div className={`border rounded-2xl shadow-xl overflow-hidden transition-all duration-300 ${themeBgClass}`}>
        {/* Chart Card Toolbar */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/5 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-amber-500" />
            <h3 className={`font-bold text-sm ${themeTextClass}`}>Utilization Performance Chart</h3>
            {isPaused && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                Paused
              </span>
            )}
          </div>

          {/* LIGHT / DARK CHART THEME TOGGLER */}
          <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-1 shrink-0">
            <button
              onClick={() => setChartTheme("dark")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                chartTheme === "dark"
                  ? "bg-amber-500 text-black shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark Theme</span>
            </button>
            <button
              onClick={() => setChartTheme("light")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                chartTheme === "light"
                  ? "bg-amber-500 text-black shadow-sm"
                  : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light Theme</span>
            </button>
          </div>
        </div>

        {/* Dynamic Chart Container */}
        <div className="p-6">
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={themeGridColor} vertical={false} />
                <XAxis 
                  dataKey="time" 
                  tick={{ fill: themeAxisColor, fontSize: 10, fontWeight: "600" }} 
                  stroke={isLight ? "#cbd5e1" : "rgba(255,255,255,0.1)"}
                />
                <YAxis 
                  domain={[0, 100]}
                  tick={{ fill: themeAxisColor, fontSize: 10, fontWeight: "600" }} 
                  stroke={isLight ? "#cbd5e1" : "rgba(255,255,255,0.1)"}
                />
                <RechartsTooltip 
                  contentStyle={{ 
                    background: isLight ? "#ffffff" : "#0e0e11", 
                    borderRadius: "12px", 
                    border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.1)", 
                    fontSize: "11px", 
                    fontWeight: "600",
                    color: isLight ? "#1e293b" : "#ffffff",
                    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)"
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
                  type="monotone" 
                  dataKey="cpu" 
                  name="CPU Load (%)" 
                  stroke="#f59e0b" 
                  strokeWidth={2.5}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#f59e0b", strokeWidth: 2 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="memory" 
                  name="RAM Util (%)" 
                  stroke="#0ea5e9" 
                  strokeWidth={2.5}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#0ea5e9", strokeWidth: 2 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="network" 
                  name="Network Traffic (Mbps)" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, stroke: "#10b981", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Diagnostic Actions Tray */}
        <div className="px-6 py-4 bg-black/20 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />
            <p className={`text-xs ${themeSubtextClass}`}>
              {lastAction ? lastAction : "Diagnostic console ready. Simulated live poll running."}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Speed Test Spiker */}
            <button
              onClick={handleSpeedTest}
              disabled={activeNetworkBurst || isPaused}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:hover:bg-transparent border border-emerald-500/20 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Speed Test Burst</span>
            </button>

            {/* RAM Flush */}
            <button
              onClick={handleFlushMemory}
              disabled={isFlushingMemory || isPaused}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 disabled:opacity-40 disabled:hover:bg-transparent border border-sky-500/20 transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFlushingMemory ? "animate-spin" : ""}`} />
              <span>RAM Cache Flush</span>
            </button>
          </div>
        </div>
      </div>

      {/* Internal Processes / Codecs Table */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="font-bold text-sm text-white">Isolated Security Sandbox Allocations</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 text-zinc-500">
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Resource Channel</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Active Engine</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Virtual PID</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Load Allocation</th>
                <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px] text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="py-3 font-semibold text-zinc-300">WhatsApp Baileys Core</td>
                <td className="py-3 text-zinc-400 font-mono">WS Socket Handler</td>
                <td className="py-3 text-zinc-500 font-mono">PID 4110</td>
                <td className="py-3 font-mono text-amber-400">2.4% CPU / 142 MB</td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">Active</span>
                </td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-zinc-300">Gemini Cognition Agent</td>
                <td className="py-3 text-zinc-400 font-mono">@google/genai SDK</td>
                <td className="py-3 text-zinc-500 font-mono">PID 4112</td>
                <td className="py-3 font-mono text-amber-400">0.0% CPU / 85 MB</td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">Standby</span>
                </td>
              </tr>
              <tr>
                <td className="py-3 font-semibold text-zinc-300">Media Codecs Decoder</td>
                <td className="py-3 text-zinc-400 font-mono">FFmpeg Audio Decoder</td>
                <td className="py-3 text-zinc-500 font-mono">PID 4119</td>
                <td className="py-3 font-mono text-amber-400">0.0% CPU / 18 MB</td>
                <td className="py-3 text-right">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/5 border border-white/10 text-zinc-400 font-semibold">Idle</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
