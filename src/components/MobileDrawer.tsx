import type { ReactNode } from "react";
import {
  X,
  Home,
  QrCode,
  Terminal,
  Cpu,
  Sparkles,
  Package,
  Users,
  ShieldAlert,
  BarChart2,
  Settings,
  KeyRound,
  FileText,
  BookOpen,
  FileDown,
  Activity,
  RotateCcw,
  Power,
  Zap,
} from "lucide-react";
import { NavTab } from "./Sidebar";
import { ConnectionStatus } from "../lib/types";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  botStatus: ConnectionStatus | "pair_code";
  onRunCheckup: () => void;
  onResetSession: () => void;
  isResetting: boolean;
  onToggleBot: () => void;
  isStarting: boolean;
}

interface DrawerItem {
  id: NavTab;
  label: string;
  icon: ReactNode;
  badge?: string;
  category: "start" | "manage" | "admin" | "dev";
}

const ITEMS: DrawerItem[] = [
  // Getting started
  { id: "overview", label: "Overview", icon: <Home size={18} />, category: "start" },
  { id: "connect", label: "WhatsApp Connect", icon: <QrCode size={18} />, category: "start" },
  { id: "simulator", label: "Simulator", icon: <Terminal size={18} />, category: "start" },

  // Manage
  { id: "commands", label: "Commands Registry", icon: <Cpu size={18} />, category: "manage" },
  { id: "gemini", label: "Gemini AI Engine", icon: <Sparkles size={18} />, category: "manage" },
  { id: "plugins", label: "Plugins & Scrapers", icon: <Package size={18} />, category: "manage" },

  // Admin
  { id: "groups", label: "Group Tools", icon: <Users size={18} />, category: "admin" },
  { id: "security", label: "Security & Antilink", icon: <ShieldAlert size={18} />, category: "admin" },
  { id: "analytics", label: "Analytics & Usage", icon: <BarChart2 size={18} />, category: "admin" },
  { id: "settings", label: "Bot Settings", icon: <Settings size={18} />, category: "admin" },

  // Developer
  { id: "secrets", label: "API Secrets", icon: <KeyRound size={18} />, category: "dev" },
  { id: "logs", label: "Console Logs", icon: <FileText size={18} />, category: "dev" },
  { id: "docs", label: "Documentation", icon: <BookOpen size={18} />, category: "dev" },
  { id: "export", label: "Export Codebase", icon: <FileDown size={18} />, category: "dev" },
];

export default function MobileDrawer({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  botStatus,
  onRunCheckup,
  onResetSession,
  isResetting,
  onToggleBot,
  isStarting,
}: MobileDrawerProps) {
  if (!isOpen) return null;

  const handleSelect = (tab: NavTab) => {
    setActiveTab(tab);
    onClose();
  };

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none">
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Surface */}
      <div
        className="relative z-10 w-full max-h-[85vh] flex flex-col rounded-t-[32px] bg-[#0a0a0d]/98 border-t border-white/10 shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300"
        style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Drag handle & Header */}
        <div className="flex flex-col items-center pt-3 pb-3 px-6 border-b border-white/5 shrink-0">
          <div className="w-12 h-1 rounded-full bg-white/15 mb-3.5" />
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-md shadow-amber-500/10">
                <Zap className="h-4.5 w-4.5 fill-black text-black" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white tracking-wide">Nebula Navigation</h3>
                <p className="text-[11px] text-zinc-400 font-medium">WhatsApp Multi-Device Cloud Bot</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-white/5 hover:text-white transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="px-5 py-3.5 border-b border-white/5 bg-white/[0.01] flex items-center justify-between gap-2.5 shrink-0">
          <button
            onClick={() => {
              onClose();
              onRunCheckup();
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/15 transition-all cursor-pointer active:scale-95"
          >
            <Activity size={14} />
            <span>Checkup</span>
          </button>

          <button
            onClick={onResetSession}
            disabled={isResetting}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-white/5 border border-white/5 text-zinc-300 text-xs font-semibold hover:bg-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={14} className={isResetting ? "animate-spin text-amber-400" : ""} />
            <span>{isResetting ? "Resetting..." : "Reset"}</span>
          </button>

          {botStatus === "connected" ? (
            <button
              onClick={onToggleBot}
              disabled={isStarting}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-rose-500/15 border border-rose-500/25 text-rose-300 text-xs font-bold hover:bg-rose-500/20 transition-all cursor-pointer active:scale-95"
            >
              <Power size={14} />
              <span>Stop Bot</span>
            </button>
          ) : (
            <button
              onClick={() => handleSelect("connect")}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-all cursor-pointer active:scale-95 shadow-md shadow-amber-500/10"
            >
              <Zap size={14} className="fill-black" />
              <span>Connect</span>
            </button>
          )}
        </div>

        {/* Scrollable Navigation Grid */}
        <div className="overflow-y-auto p-5 space-y-5 dark-scroll">
          {/* Main sections */}
          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 px-1 mb-3">
              Management & Controls
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              {ITEMS.filter((i) => i.category === "manage" || i.category === "start").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer active:scale-95 ${
                      isActive
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-400 font-bold"
                        : "bg-white/[0.02] border-white/5 text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs font-semibold truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 px-1 mb-3">
              Administration
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              {ITEMS.filter((i) => i.category === "admin").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer active:scale-95 ${
                      isActive
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-400 font-bold"
                        : "bg-white/[0.02] border-white/5 text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs font-semibold truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 px-1 mb-3">
              Developer & Tools
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              {ITEMS.filter((i) => i.category === "dev").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer active:scale-95 ${
                      isActive
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-400 font-bold"
                        : "bg-white/[0.02] border-white/5 text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs font-semibold truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
