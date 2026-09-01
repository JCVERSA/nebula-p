import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Zap, RotateCcw, Power, Activity, Palette, X as CloseIcon } from "lucide-react";
import { NavTab } from "./Sidebar";
import { ConnectionStatus } from "../lib/types";
import ShinyText from "./ShinyText";

interface TopbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  botStatus: ConnectionStatus | "pair_code";
  onResetSession: () => void;
  isResetting: boolean;
  onToggleBot: () => void;
  isStarting: boolean;
  onOpenCheckup?: () => void;
}

const THEMES = [
  { id: "amber", name: "Cyber Amber", color: "#f59e0b" },
  { id: "sapphire", name: "Sapphire Ocean", color: "#3b82f6" },
  { id: "emerald", name: "Emerald Matrix", color: "#10b981" },
  { id: "amethyst", name: "Amethyst Void", color: "#a855f7" },
  { id: "rose", name: "Rose Catalyst", color: "#ef4444" },
];

const TAB_TITLES: Record<NavTab, string> = {
  overview: "Overview",
  connect: "WhatsApp Connect",
  commands: "Commands Registry",
  simulator: "Bot Simulator",
  gemini: "Gemini AI",
  plugins: "Plugins",
  groups: "Group Tools",
  security: "Security & Antilink",
  analytics: "Usage & Analytics",
  diagnostics: "System Diagnostics",
  secrets: "API Keys & Secrets",
  logs: "System Logs",
  settings: "Settings",
  docs: "Documentation",
  export: "Export Package",
};

export default function Topbar({
  activeTab,
  setActiveTab,
  botStatus,
  onResetSession,
  isResetting,
  onToggleBot,
  isStarting,
  onOpenCheckup,
}: TopbarProps) {
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem("app-theme") || "amber");
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  // Initialize and load saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("app-theme") || "amber";
    setCurrentTheme(savedTheme);
    document.documentElement.classList.remove("theme-sapphire", "theme-emerald", "theme-amethyst", "theme-rose");
    if (savedTheme !== "amber") {
      document.documentElement.classList.add(`theme-${savedTheme}`);
    }
  }, []);

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    localStorage.setItem("app-theme", theme);
    document.documentElement.classList.remove("theme-sapphire", "theme-emerald", "theme-amethyst", "theme-rose");
    if (theme !== "amber") {
      document.documentElement.classList.add(`theme-${theme}`);
    }
  };

  const searchItems = [
    { label: "Overview Dashboard", desc: "View bot connection status, server metrics and summaries", tab: "overview", keys: ["overview", "status", "dashboard", "home", "stats"] },
    { label: "WhatsApp Connect", desc: "Link WhatsApp via QR Code or Pair Code", tab: "connect", keys: ["qr", "pair", "connect", "link", "whatsapp", "phone"] },
    { label: "Commands Registry", desc: "Browse, configure, and sandbox bot commands", tab: "commands", keys: ["command", "prefix", "list", "registry", "sandbox", "trigger"] },
    { label: "Bot Simulator", desc: "Simulate and test incoming messages in the chat console", tab: "simulator", keys: ["chat", "simulator", "sandbox", "test", "incoming"] },
    { label: "Gemini AI Assistant", desc: "Configure server-side AI model, context, and prompts", tab: "gemini", keys: ["ai", "gemini", "google", "intelligence", "prompt"] },
    { label: "Plugins Engine", desc: "Enable community-authored add-on scripts and features", tab: "plugins", keys: ["plugin", "add-on", "extension", "market", "npm"] },
    { label: "Group Tools & Management", desc: "Configure broadcast tools, auto-welcome, and anti-spam", tab: "groups", keys: ["group", "broadcast", "welcome", "admin", "kick", "promote"] },
    { label: "Security & Antilink", desc: "Protect groups with links filter and automated antibot", tab: "security", keys: ["security", "antilink", "antibot", "spam", "ban", "protection"] },
    { label: "Usage & Analytics", desc: "Real-time message volume and system load analytics", tab: "analytics", keys: ["analytics", "chart", "graph", "metric", "volume", "cpu"] },
    { label: "System Diagnostics", desc: "Real-time CPU, RAM and Network resource line charts with Light/Dark themes", tab: "diagnostics", keys: ["diagnostics", "resource", "cpu", "memory", "ram", "network", "speed", "theme"] },
    { label: "API Keys & Secrets", desc: "Manage Gemini keys, environment variables and configuration", tab: "secrets", keys: ["key", "secret", "env", "token", "api", "gemini_api_key"] },
    { label: "System Logs", desc: "Real-time server terminal and backend stderr/stdout streams", tab: "logs", keys: ["log", "terminal", "console", "stderr", "stdout", "stream"] },
    { label: "Settings", desc: "Adjust layout density, theme, and local session preferences", tab: "settings", keys: ["setting", "config", "layout", "pref", "theme"] },
    { label: "Documentation", desc: "Browse complete guide on commands, flags, and installation", tab: "docs", keys: ["doc", "help", "guide", "readme", "instruction"] },
    { label: "Run System Checkup", desc: "Perform deep diagnosis checkup", action: onOpenCheckup, keys: ["checkup", "diagnostic", "test", "fix", "error"] },
    { label: "Reset Session Engine", desc: "Purge active session data and trigger handshake", action: onResetSession, keys: ["reset", "purge", "clear", "cookie", "reconnect"] },
    { label: "Toggle Bot Engine", desc: "Start or stop active WhatsApp bot loop", action: onToggleBot, keys: ["start", "stop", "toggle", "run", "offline", "online"] },
  ];

  const filteredItems = searchQuery.trim() === "" 
    ? [] 
    : searchItems.filter(item => 
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.keys.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
      );

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0e0e11] px-4 select-none">
      {/* Left section: Brand/Breadcrumb & Preline-style Search */}
      <div className="flex items-center gap-4 text-sm text-zinc-300 min-w-0 flex-1">
        <div className="flex items-center px-1">
          {/* Waveform SVG brand icon from reference template */}
          <svg
            onClick={() => setIsAboutOpen(true)}
            viewBox="0 0 32 24"
            className="h-5 w-8 text-amber-400 cursor-pointer hover:text-amber-300 hover:scale-105 active:scale-95 transition-all duration-200"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <title>About Nebula Project</title>
            <path d="M2 6 Q 10 2, 16 6 T 30 6" />
            <path d="M2 12 Q 10 8, 16 12 T 30 12" />
            <path d="M2 18 Q 10 14, 16 18 T 30 18" />
          </svg>
        </div>

        {/* Separator & Breadcrumb */}
        <span className="text-zinc-600 hidden sm:inline">/</span>
        <button
          onClick={() => setActiveTab("overview")}
          className="hidden sm:flex items-center gap-1.5 rounded-lg px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-all cursor-pointer"
        >
          <Zap size={13} className="text-amber-400" />
          <span className="font-semibold text-xs tracking-wide">
            <ShinyText text="NEBULA" speed={4} />
          </span>
          <ChevronDown size={12} className="text-zinc-500" />
        </button>
        <span className="text-zinc-600">/</span>
        <span className="font-bold text-xs text-white tracking-wide uppercase px-2 py-0.5 rounded bg-white/5 border border-white/5 truncate max-w-[120px] sm:max-w-none">
          {TAB_TITLES[activeTab] || "Dashboard"}
        </span>

        {/* Search Input bar from Preline Admin Layout, placed after breadcrumbs */}
        <div className="hidden lg:block relative max-w-xs w-full ml-6">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 220)}
            placeholder="Search commands, logs, features..."
            className="w-full bg-[#141416] border border-white/5 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
          />

          {/* Real-time Search overlay dropdown */}
          {isSearchFocused && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#0e0e11] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 py-1.5 min-w-[280px]">
              {filteredItems.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {filteredItems.map((item, idx) => (
                    <button
                      key={idx}
                      onMouseDown={() => {
                        if (item.tab) {
                          setActiveTab(item.tab as any);
                        } else if (item.action) {
                          item.action();
                        }
                        setSearchQuery("");
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-white/5 transition-colors flex flex-col cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-zinc-100">{item.label}</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</span>
                    </button>
                  ))}
                </div>
              ) : searchQuery.trim() !== "" ? (
                <div className="px-3.5 py-3 text-center">
                  <p className="text-xs text-zinc-400">No matching features found.</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Try searching 'gemini', 'reset' or 'logs'</p>
                </div>
              ) : (
                <div className="px-3.5 py-2">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">Quick Actions</p>
                  <div className="grid grid-cols-2 gap-1">
                    {searchItems.slice(0, 4).map((item, idx) => (
                      <button
                        key={idx}
                        onMouseDown={() => {
                          if (item.tab) setActiveTab(item.tab as any);
                          setSearchQuery("");
                        }}
                        className="text-left px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-[10px] font-semibold text-zinc-300 truncate cursor-pointer"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        {/* Status Indicator */}
        <div
          onClick={() => setActiveTab("connect")}
          className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-all ${
            botStatus === "connected"
              ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300 hover:bg-emerald-900/60"
              : botStatus === "connecting"
              ? "bg-amber-950/60 border-amber-800/80 text-amber-300 hover:bg-amber-900/60"
              : botStatus === "qr_ready" || botStatus === "pair_code"
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
              : "bg-black border-zinc-700 text-zinc-400 hover:bg-zinc-900"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              botStatus === "connected"
                ? "bg-emerald-400 animate-pulse"
                : botStatus === "connecting"
                ? "bg-amber-400 animate-pulse"
                : botStatus === "qr_ready" || botStatus === "pair_code"
                ? "bg-amber-400 animate-pulse"
                : "bg-zinc-500"
            }`}
          />
          <span>
            {botStatus === "connected"
              ? "WhatsApp Linked"
              : botStatus === "connecting"
              ? "Connecting..."
              : botStatus === "qr_ready"
              ? "QR Code Ready"
              : botStatus === "pair_code"
              ? "Pairing Active"
              : "Disconnected"}
          </span>
        </div>

        {/* Checkup Diagnostic Button */}
        {onOpenCheckup && (
          <button
            onClick={onOpenCheckup}
            title="Run complete commands and backend diagnostic checkup"
            className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/5 bg-[#141416] hover:bg-[#18181b] px-3 py-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Checkup</span>
          </button>
        )}

        {/* Reset Session Quick Button */}
        <button
          onClick={onResetSession}
          disabled={isResetting}
          title="Purge session directory & initiate fresh handshake"
          className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/5 bg-[#141416] hover:bg-[#18181b] px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? "animate-spin text-amber-400" : ""}`} />
          <span>{isResetting ? "Resetting..." : "Reset"}</span>
        </button>

        {/* Primary Amber Action Button from template */}
        {botStatus === "connected" ? (
          <button
            onClick={onToggleBot}
            disabled={isStarting}
            className="flex items-center gap-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/30 transition cursor-pointer"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Stop Bot</span>
          </button>
        ) : (
          <button
            onClick={() => setActiveTab("connect")}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-amber-400 transition cursor-pointer shadow-sm"
          >
            <Zap className="w-3.5 h-3.5 fill-black" />
            <span>Connect</span>
          </button>
        )}

        {/* Real-time Theme Palette Selector */}
        <div className="relative">
          <button
            onClick={() => setIsThemeOpen((prev) => !prev)}
            title="Switch color palette themes"
            className="flex items-center justify-center p-2 rounded-xl border border-white/5 bg-[#141416]/90 hover:bg-[#1c1c1e] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <Palette className="w-4 h-4" />
          </button>

          {isThemeOpen && (
            <>
              {/* Backing dismiss overlay */}
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setIsThemeOpen(false)} 
              />
              
              {/* Theme Dropdown Pane */}
              <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-[#0a0a0c]/95 border border-white/10 shadow-2xl z-50 p-2.5 backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 px-2 pb-2 border-b border-white/5">
                  Select Theme
                </p>
                <div className="space-y-1 mt-1.5">
                  {THEMES.map((theme) => {
                    const isSelected = currentTheme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => {
                          handleThemeChange(theme.id);
                          setIsThemeOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          isSelected
                            ? "bg-white/5 text-white"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-2.5 h-2.5 rounded-full shadow-inner" 
                            style={{ backgroundColor: theme.color }}
                          />
                          <span>{theme.name}</span>
                        </div>
                        {isSelected && (
                          <span 
                            className="w-1.5 h-1.5 rounded-full animate-pulse" 
                            style={{ backgroundColor: theme.color }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Profile Avatar / Bot Identity */}
        <div
          onClick={() => setActiveTab("settings")}
          className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-black font-extrabold ring-2 ring-white/10 flex items-center justify-center text-xs cursor-pointer hover:ring-amber-400 transition"
          title="Bot Settings & Profile"
        >
          NB
        </div>
      </div>

      {/* Luminous Design About Project Popup */}
      {isAboutOpen && createPortal(
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAboutOpen(false);
          }}
        >
          {/* Custom style block to inject exact user Luminous styles */}
          <style dangerouslySetInnerHTML={{__html: `
            .luminous-card-wrapper {
              --sz: 20px;
              font-size: var(--sz);
              display: grid;
              place-items: center;
              font-family: "Aeonik Pro Regular", "Consolas", sans-serif;
              position: relative;
            }

            .luminous-card-wrapper * {
              box-sizing: border-box;
            }

            .luminous-card {
              position: relative;
              background: linear-gradient(135deg, rgba(20, 20, 23, 0.4) 0%, rgba(5, 5, 5, 0.7) 100%);
              backdrop-filter: blur(25px) saturate(220%);
              -webkit-backdrop-filter: blur(25px) saturate(220%);
              border: 1px solid rgba(255, 255, 255, 0.15);
              box-shadow:
                inset 0 15px 25px 0 rgba(255, 255, 255, 0.12),
                inset 0 1px 0 0 rgba(255, 255, 255, 0.35),
                inset 0 -8px 15px 0 rgba(0, 0, 0, 0.5),
                0 25px 50px -12px rgba(0, 0, 0, 0.85),
                0 0 0 1px rgba(255, 255, 255, 0.03);
              width: 16rem;
              height: 22rem;
              border-radius: 1.8rem;
              color: #fff;
              padding: 1.2rem;
              display: flex;
              flex-direction: column;
              justify-content: end;
              cursor: pointer;
              transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
              overflow: hidden;
            }

            /* Curved high-gloss top overlay (original liquid gel/glass bubble coat) */
            .luminous-card::after {
              content: "";
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 50%;
              background: linear-gradient(
                to bottom,
                rgba(255, 255, 255, 0.28) 0%,
                rgba(255, 255, 255, 0.08) 50%,
                rgba(255, 255, 255, 0) 100%
              );
              border-radius: 1.8rem 1.8rem 100% 100% / 1.8rem 1.8rem 35% 35%;
              pointer-events: none;
              transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
              transform-origin: top;
            }

            .luminous-card:hover::after {
              height: 52%;
              background: linear-gradient(
                to bottom,
                rgba(255, 255, 255, 0.38) 0%,
                rgba(255, 255, 255, 0.12) 50%,
                rgba(255, 255, 255, 0) 100%
              );
            }

            .luminous-toggle-input:checked ~ .luminous-card::after {
              background: linear-gradient(
                to bottom,
                rgba(0, 255, 235, 0.4) 0%,
                rgba(0, 255, 235, 0.1) 50%,
                rgba(255, 255, 255, 0) 100%
              );
              border-radius: 1.8rem 1.8rem 100% 100% / 1.8rem 1.8rem 35% 35%;
            }

            .luminous-card::before {
              content: "";
              display: block;
              --offset: 1rem;
              width: calc(100% + 2 * var(--offset));
              height: calc(100% + 2 * var(--offset));
              position: absolute;
              left: calc(-1 * var(--offset));
              right: calc(-1 * var(--offset));
              top: calc(-1 * var(--offset));
              bottom: calc(-1 * var(--offset));
              margin: auto;
              box-shadow: inset 0 0 0px 0.06rem rgba(255, 255, 255, 0.08);
              border-radius: 2.6rem;
              --ax: 4rem;
              clip-path: polygon(
                var(--ax) 0,
                0 0,
                0 var(--ax),
                var(--ax) var(--ax),
                var(--ax) calc(100% - var(--ax)),
                0 calc(100% - var(--ax)),
                0 100%,
                var(--ax) 100%,
                var(--ax) calc(100% - var(--ax)),
                calc(100% - var(--ax)) calc(100% - var(--ax)),
                calc(100% - var(--ax)) 100%,
                100% 100%,
                100% calc(100% - var(--ax)),
                calc(100% - var(--ax)) calc(100% - var(--ax)),
                calc(100% - var(--ax)) var(--ax),
                100% var(--ax),
                100% 0,
                calc(100% - var(--ax)) 0,
                calc(100% - var(--ax)) var(--ax),
                var(--ax) var(--ax)
              );
              transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
              pointer-events: none;
            }

            .luminous-card:hover {
              transform: scale(1.02) translateY(-0.25rem);
              box-shadow:
                inset 0 1px 0 0 rgba(255, 255, 255, 0.25),
                inset 0 -1px 0 0 rgba(0, 0, 0, 0.7),
                inset 0 15px 30px -5px rgba(255, 255, 255, 0.08),
                0 30px 60px -10px rgba(0, 0, 0, 0.95),
                0 0 0 1px rgba(255, 255, 255, 0.05);
            }

            .luminous-card:hover::before {
              --offset: 0.5rem;
              --ax: 8rem;
              border-radius: 2.2rem;
              box-shadow: inset 0 0 0 0.08rem rgba(255, 255, 255, 0.1);
            }

            .luminous-light-layer {
              position: absolute;
              left: 0;
              top: 0;
              height: 100%;
              width: 100%;
              transform-style: preserve-3d;
              perspective: 400px;
              pointer-events: none;
            }

            .luminous-slit {
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 0;
              margin: auto;
              width: 64%;
              height: 1.2rem;
              transform: rotateX(-76deg);
              background: #121212;
              box-shadow: 0 0 4px 0 rgba(255, 255, 255, 0);
              transition: all 0.4s ease-in-out;
            }

            .luminous-lumen {
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 0;
              margin: auto;
              width: 100%;
              height: 100%;
              pointer-events: none;
              perspective: 400px;
              opacity: 0;
              transition: opacity 0.4s ease-in-out;
            }

            .luminous-lumen .min {
              width: 70%;
              height: 3rem;
              background: linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.67));
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 2.5rem;
              margin: auto;
              transform: rotateX(-42deg);
              opacity: 0.4;
            }

            .luminous-lumen .mid {
              width: 74%;
              height: 13rem;
              background: linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.67));
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 10rem;
              margin: auto;
              transform: rotateX(-42deg);
              filter: blur(1rem);
              opacity: 0.8;
              border-radius: 100% 100% 0 0;
            }

            .luminous-lumen .hi {
              width: 50%;
              height: 13rem;
              background: linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.67));
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 12rem;
              margin: auto;
              transform: rotateX(22deg);
              filter: blur(1rem);
              opacity: 0.6;
              border-radius: 100% 100% 0 0;
            }

            .luminous-darken {
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 0;
              margin: auto;
              width: 100%;
              height: 100%;
              pointer-events: none;
              perspective: 400px;
              transition: opacity 0.4s ease-in-out;
              opacity: 0.5;
            }

            .luminous-darken > * {
              transition: opacity 0.4s ease-in-out;
            }

            .luminous-darken .sl {
              width: 64%;
              height: 10rem;
              background: linear-gradient(#000, rgba(0, 0, 0, 0));
              position: absolute;
              left: 0;
              right: 0;
              top: 9.6rem;
              bottom: 0;
              margin: auto;
              filter: blur(0.2rem);
              opacity: 0.1;
              border-radius: 0 0 100% 100%;
              transform: rotateX(-22deg);
            }

            .luminous-darken .ll {
              width: 62%;
              height: 10rem;
              background: linear-gradient(rgba(0,0,0,0.67), rgba(0, 0, 0, 0));
              position: absolute;
              left: 0;
              right: 0;
              top: 11rem;
              bottom: 0;
              margin: auto;
              filter: blur(0.8rem);
              opacity: 0.4;
              border-radius: 0 0 100% 100%;
              transform: rotateX(22deg);
            }

            .luminous-darken .slt {
              width: 0.5rem;
              height: 4rem;
              background: linear-gradient(rgba(0,0,0,0.33), rgba(0, 0, 0, 0));
              position: absolute;
              left: 0;
              right: 11.5rem;
              top: 3.9rem;
              bottom: 0;
              margin: auto;
              opacity: 0.6;
              border-radius: 0 0 100% 100%;
              transform: skewY(42deg);
            }

            .luminous-darken .srt {
              width: 0.5rem;
              height: 4rem;
              background: linear-gradient(rgba(0,0,0,0.33), rgba(0, 0, 0, 0));
              position: absolute;
              right: 0;
              left: 11.5rem;
              top: 3.9rem;
              bottom: 0;
              margin: auto;
              opacity: 0.6;
              border-radius: 0 0 100% 100%;
              transform: skewY(-42deg);
            }

            .luminous-content {
              position: relative;
              z-index: 10;
              height: 100%;
              display: flex;
              flex-direction: column;
              justify-content: flex-end;
            }

            /* GitHub Icon shows ONLY when checked (Lumen ON) */
            .luminous-icon {
              position: absolute;
              top: 3.5rem;
              left: 0;
              right: 0;
              margin: auto;
              width: fit-content;
              opacity: 0;
              transform: translateY(1.5rem) scale(0.85);
              filter: drop-shadow(0 0 0px transparent);
              transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
              pointer-events: none;
            }

            .luminous-bottom {
              position: relative;
            }

            .luminous-title {
              margin: 0;
              margin-bottom: 0.5rem;
              font-size: 1.25rem;
              color: #fff;
              font-weight: 800;
              letter-spacing: -0.025em;
            }

            .luminous-description {
              margin: 0;
              padding-bottom: 0.6rem;
              color: #ccc;
              font-size: 0.65rem;
              font-weight: 300;
              line-height: 1.5;
              border-bottom: 1px solid rgba(255, 255, 255, 0.08);
              max-width: 72%;
            }

            .luminous-toggle-input {
              display: none;
            }

            .luminous-toggle {
              position: absolute;
              right: 0;
              bottom: 0;
              height: 2rem;
              width: 4.8rem;
              border-radius: 0.6rem;
              background: #000;
              box-shadow:
                inset 0 -8px 8px 0.3rem rgba(0,0,0,0.25),
                inset 0 0 1px 0.3rem #ddd,
                inset 0 -2px 1px 0.3rem #fff,
                inset 0 1px 2px 0.3rem rgba(0,0,0,0.4),
                inset 0 0 1px 0.8rem #aaa;
              cursor: pointer;
              transition: all 0.4s ease-in-out;
            }

            .luminous-toggle::before {
              content: "";
              display: block;
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              bottom: 0;
              margin: auto;
              width: 3.4rem;
              height: 0.68rem;
              border-radius: 0.2rem;
              background: #000;
              transition: all 0.4s ease-in-out;
            }

            .luminous-handle {
              position: absolute;
              top: 0;
              bottom: 0.04rem;
              margin: auto;
              left: 0.68rem;
              width: 40%;
              height: 30%;
              background: #aaa;
              border-radius: 0.2rem;
              box-shadow:
                inset 0 1px 4px 0 #fff,
                inset 0 -1px 1px 0 rgba(0,0,0,0.67),
                0 0 1px 1px rgba(0,0,0,0.2),
                1px 3px 6px 1px rgba(0,0,0,0.6);
              transition: all 0.4s ease-in-out;
              pointer-events: none;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-toggle .luminous-handle {
              transform: translateX(1.58rem);
            }

            .luminous-toggle-label {
              pointer-events: none;
              text-align: center;
              position: absolute;
              left: 0;
              right: 0;
              margin: auto;
              bottom: calc(100% + 0.4rem);
              font-size: 0.55rem;
              font-weight: 500;
              color: #999;
              opacity: 0;
              transition: opacity 0.4s ease-in-out;
              white-space: nowrap;
            }

            .luminous-toggle:hover .luminous-toggle-label {
              opacity: 1;
            }

            .luminous-toggle-input:checked ~ .luminous-card {
              box-shadow:
                inset 0 1.01rem 0.1rem -1rem rgba(255,255,255,0.67),
                inset 0 -4rem 3rem -3rem rgba(0,0,0,0.6),
                0 -1.02rem 0.2rem -1rem rgba(255,255,255,0.67),
                0 1rem 0.2rem -1rem #000,
                0 0 0 1px rgba(255,255,255,0.12),
                0 4px 4px 0 rgba(0,0,0,0.25),
                0 0 0 1px #333;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-slit {
              background: #fff;
              box-shadow: 0 0 4px 0 #fff;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-lumen {
              opacity: 0.5;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-darken {
              opacity: 0.8;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .sl {
              opacity: 0.2;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .ll {
              opacity: 1;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .slt {
              opacity: 1;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .srt {
              opacity: 1;
            }

            /* GitHub Icon fully animates, scales and glows ONLY on Active Checked State */
            .luminous-toggle-input:checked ~ .luminous-card .luminous-icon {
              opacity: 1;
              transform: translateY(0) scale(1.1);
              filter: drop-shadow(0 0 15px rgba(0, 255, 235, 0.75)) brightness(1.2);
              pointer-events: auto;
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-toggle::before {
              background: #fffc;
              box-shadow: 0 0 0.3rem 0.2rem rgba(255,255,255,0.45);
            }

            .luminous-toggle-input:checked ~ .luminous-card .luminous-handle {
              box-shadow:
                inset 0 1px 12px 0 #fff,
                inset 0 -1px 1px 0 rgba(255,255,255,0.6),
                0 0 2px 1px rgba(68,68,68,0.2),
                1px 3px 6px 1px rgba(0,0,0,0.25);
            }
          `}} />

          {/* Core modal popup */}
          <div className="relative animate-in zoom-in-95 duration-200">
            {/* Close button top right */}
            <button
              type="button"
              onClick={() => setIsAboutOpen(false)}
              className="absolute -top-12 right-0 p-2 text-zinc-400 hover:text-white bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition cursor-pointer"
            >
              <CloseIcon className="w-4 h-4" />
            </button>

            {/* Luminous Interactive Card Component */}
            <div className="luminous-card-wrapper">
              <div className="luminous-card">
                <div className="luminous-light-layer">
                  <div className="luminous-slit" />
                  <div className="luminous-lumen">
                    <div className="min" />
                    <div className="mid" />
                    <div className="hi" />
                  </div>
                  <div className="luminous-darken">
                    <div className="sl" />
                    <div className="ll" />
                    <div className="slt" />
                    <div className="srt" />
                  </div>
                </div>
                <div className="luminous-content">
                  {/* Glowing GitHub Icon */}
                  <div className="luminous-icon" style={{ opacity: 1, pointerEvents: 'auto', transform: 'none' }}>
                    <a
                      href="https://github.com/jcversa"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="GitHub Profile of Jcversa"
                      className="block transform hover:scale-110 active:scale-95 transition cursor-pointer bg-black/45 border border-[#00ffeb]/30 hover:border-[#00ffeb]/60 p-3 rounded-full shadow-2xl"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="2.4rem" height="2.4rem" viewBox="0 0 24 24" fill="none" stroke="#00ffeb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                        <path d="M9 18c-4.51 2-5-2-7-2" />
                      </svg>
                    </a>
                  </div>

                  {/* Text details containing By Jcversa in consolas */}
                  <div className="luminous-bottom">
                    <div 
                      className="luminous-title text-[#00ffeb]"
                      style={{ fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace' }}
                    >
                      By Jcversa
                    </div>
                    <p className="luminous-description" style={{ maxWidth: '100%' }}>
                      Advanced automated WhatsApp assistant bot and command engine.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
