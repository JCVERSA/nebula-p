import {
  Home,
  QrCode,
  Terminal,
  Cpu,
  Menu,
} from "lucide-react";
import { NavTab } from "./Sidebar";
import { ConnectionStatus } from "../lib/types";

interface MobileDockProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  botStatus: ConnectionStatus | "pair_code";
  onOpenDrawer: () => void;
  isDrawerOpen: boolean;
}

export default function MobileDock({
  activeTab,
  setActiveTab,
  botStatus,
  onOpenDrawer,
  isDrawerOpen,
}: MobileDockProps) {
  // Check if active tab is one of the secondary tabs
  const isSecondaryActive =
    isDrawerOpen ||
    [
      "gemini",
      "plugins",
      "groups",
      "security",
      "analytics",
      "secrets",
      "logs",
      "settings",
      "docs",
      "export",
    ].includes(activeTab);

  return (
    <nav
      aria-label="Mobile Navigation Dock"
      className="md:hidden fixed left-1/2 -translate-x-1/2 bottom-5 z-40 w-fit pointer-events-auto select-none px-4"
      style={{
        bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="relative flex items-center gap-4 p-2 rounded-2xl bg-[#121217]/80 backdrop-blur-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.15)]">
        {/* Core Apps Group */}
        <div className="flex items-center gap-1.5">
          {/* 1. Overview (Home) */}
          <button
            onClick={() => setActiveTab("overview")}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer active:scale-75 text-zinc-400 hover:text-white"
          >
            <div className={`transition-transform duration-250 ${activeTab === "overview" && !isDrawerOpen ? "scale-110 text-amber-400" : "scale-100 text-zinc-300"}`}>
              <Home className="w-5 h-5" />
            </div>
            {activeTab === "overview" && !isDrawerOpen && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
            )}
          </button>

          {/* 2. Connect */}
          <button
            onClick={() => setActiveTab("connect")}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer active:scale-75 text-zinc-400 hover:text-white"
          >
            <div className={`relative transition-transform duration-250 ${activeTab === "connect" && !isDrawerOpen ? "scale-110 text-amber-400" : "scale-100 text-zinc-300"}`}>
              <QrCode className="w-5 h-5" />
              <span
                className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-[#121217] ${
                  botStatus === "connected"
                    ? "bg-emerald-400 animate-pulse"
                    : botStatus === "connecting" || botStatus === "qr_ready" || botStatus === "pair_code"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-zinc-500"
                }`}
              />
            </div>
            {activeTab === "connect" && !isDrawerOpen && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
            )}
          </button>

          {/* 3. Simulator */}
          <button
            onClick={() => setActiveTab("simulator")}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer active:scale-75 text-zinc-400 hover:text-white"
          >
            <div className={`transition-transform duration-250 ${activeTab === "simulator" && !isDrawerOpen ? "scale-110 text-amber-400" : "scale-100 text-zinc-300"}`}>
              <Terminal className="w-5 h-5" />
            </div>
            {activeTab === "simulator" && !isDrawerOpen && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
            )}
          </button>

          {/* 4. Commands */}
          <button
            onClick={() => setActiveTab("commands")}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer active:scale-75 text-zinc-400 hover:text-white"
          >
            <div className={`transition-transform duration-250 ${activeTab === "commands" && !isDrawerOpen ? "scale-110 text-amber-400" : "scale-100 text-zinc-300"}`}>
              <Cpu className="w-5 h-5" />
            </div>
            {activeTab === "commands" && !isDrawerOpen && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
            )}
          </button>
        </div>

        {/* macOS Style Dock Divider */}
        <div className="w-[1px] h-8 bg-white/10 shrink-0" />

        {/* System Utilities Group */}
        <div className="flex items-center">
          {/* 5. More Menu Drawer */}
          <button
            onClick={onOpenDrawer}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 cursor-pointer active:scale-75 text-zinc-400 hover:text-white"
          >
            <div className={`transition-transform duration-250 ${isSecondaryActive ? "scale-110 text-amber-400" : "scale-100 text-zinc-300"}`}>
              <Menu className="w-5 h-5" />
            </div>
            {isSecondaryActive && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
