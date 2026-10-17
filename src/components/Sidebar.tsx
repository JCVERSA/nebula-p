import { motion, AnimatePresence } from "motion/react";
import {
  Home,
  Bot,
  Sparkles,
  QrCode,
  Terminal,
  Cpu,
  Users,
  Megaphone,
  ShieldAlert,
  Server,
  BarChart2,
  Settings,
  FileText,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
// 9.18tt — imports PAR FICHIER (cf. SystemPanel) : perf build.
import PanelLeftData from "lucide/dist/esm/icons/panel-left";
import PanelLeftCloseData from "lucide/dist/esm/icons/panel-left-close";
import { ConnectionStatus } from "../lib/types";
import NebulaMark from "./NebulaMark";

/**
 * 9.16 — sidebar épurée sur décision owner : Plugins, Gemini AI (→ fusionné
 * dans Analytics), Documentation, Export (→ bouton dans Système), Group
 * Tools (→ absorbé par Annonces) et System Diagnostics (→ fusionné dans
 * Système) retirés ; Utilisateurs et Annonces ajoutés. 16 → 11 onglets.
 */
export type NavTab =
  | "overview"
  | "bots"
  | "agent"
  | "connect"
  | "simulator"
  | "commands"
  | "users"
  | "announcements"
  | "security"
  | "system"
  | "analytics"
  | "logs"
  | "settings";

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  botStatus: ConnectionStatus | "pair_code";
  reconnectCount: number;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: string | number;
  active?: boolean;
  collapsed?: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, badge, active, collapsed, onClick }: NavItemProps) {
  return (
    <motion.button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      initial="rest"
      whileHover="hover"
      whileTap="tap"
      variants={{
        rest: { scale: 1, x: 0 },
        hover: { scale: 1.015, x: collapsed ? 0 : 3 },
        tap: { scale: 0.985 }
      }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-150 cursor-pointer ${
        active
          ? "bg-[#0e0e11]/85 border border-white/5 shadow-inner"
          : "text-zinc-400 hover:bg-[#0e0e11]/50 hover:text-zinc-100 border border-transparent"
      } ${collapsed ? "justify-center px-2" : ""}`}
      style={active ? { color: "var(--theme-primary, #f59e0b)" } : undefined}
    >
      {/* Dynamic backdrop highlights for active state */}
      {active && !collapsed && (
        <span className="absolute inset-0 rounded-xl bg-white/[0.02] pointer-events-none" />
      )}
      <motion.span
        variants={{
          rest: { scale: 1, rotate: 0, y: 0 },
          hover: { scale: 1.15, rotate: 12, y: -0.5 },
          tap: { scale: 0.92, rotate: -4 }
        }}
        transition={{ type: "spring", stiffness: 400, damping: 14 }}
        className="h-4.5 w-4.5 shrink-0 flex items-center justify-center transition-colors duration-150"
        style={active ? { color: "var(--theme-primary, #f59e0b)" } : { color: "var(--color-zinc-400)" }}
      >
        {icon}
      </motion.span>
      {!collapsed && (
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: 0.15 }}
          className="flex flex-1 items-center justify-between min-w-0"
        >
          <span className="truncate text-white">{label}</span>
          {badge !== undefined && (
            <span 
              className="ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-mono shrink-0 bg-white/5 border border-white/10"
              style={{ color: "var(--theme-primary, #f59e0b)" }}
            >
              {badge}
            </span>
          )}
        </motion.div>
      )}
    </motion.button>
  );
}

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) {
    return <div className="my-2 border-t border-white/5" />;
  }
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="px-3 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-wider text-zinc-500"
    >
      {children}
    </motion.p>
  );
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  botStatus,
  reconnectCount,
}: SidebarProps) {
  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 256 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
      className="hidden md:flex h-full shrink-0 flex-col justify-between border-r border-white/10 bg-[#0e0e11] overflow-hidden"
    >
      {/* Top Header / Branding */}
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md transition-transform hover:rotate-12 duration-200">
          <NebulaMark size={18} className="text-indigo-100" />
        </div>
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col overflow-hidden"
            >
              <div className="flex items-center gap-1.5">
                <NebulaMark size={16} className="text-zinc-300 shrink-0" />
                <span className="font-bold text-sm text-white tracking-tight whitespace-nowrap">Nebula</span>
              </div>
              <p className="text-[11px] text-zinc-500 truncate whitespace-nowrap">WhatsApp Multi-Device Bot</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation List */}
      <div className="flex flex-1 flex-col overflow-y-auto px-2.5 py-3 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        <div>
          <SectionLabel collapsed={collapsed}>Getting Started</SectionLabel>
          <div className="space-y-1">
            <NavItem
              icon={<Home size={16} />}
              label="Overview"
              active={activeTab === "overview"}
              collapsed={collapsed}
              onClick={() => setActiveTab("overview")}
            />
            <NavItem
              icon={<Bot size={16} />}
              label="Multi-Bots"
              active={activeTab === "bots"}
              collapsed={collapsed}
              onClick={() => setActiveTab("bots")}
            />
            <NavItem
              icon={<QrCode size={16} />}
              label="WhatsApp Connect"
              active={activeTab === "connect"}
              collapsed={collapsed}
              badge={botStatus === "connected" ? "Live" : undefined}
              onClick={() => setActiveTab("connect")}
            />
            <NavItem
              icon={<Terminal size={16} />}
              label="Simulator"
              active={activeTab === "simulator"}
              collapsed={collapsed}
              onClick={() => setActiveTab("simulator")}
            />
            <NavItem
              icon={<Sparkles size={16} />}
              label="Agent IA"
              active={activeTab === "agent"}
              collapsed={collapsed}
              onClick={() => setActiveTab("agent")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Manage</SectionLabel>
          <div className="space-y-1">
            <NavItem
              icon={<Cpu size={16} />}
              label="Commands"
              active={activeTab === "commands"}
              collapsed={collapsed}
              onClick={() => setActiveTab("commands")}
            />
            <NavItem
              icon={<Users size={16} />}
              label="Utilisateurs"
              active={activeTab === "users"}
              collapsed={collapsed}
              onClick={() => setActiveTab("users")}
            />
            <NavItem
              icon={<Megaphone size={16} />}
              label="Annonces"
              active={activeTab === "announcements"}
              collapsed={collapsed}
              onClick={() => setActiveTab("announcements")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
          <div className="space-y-1">
            <NavItem
              icon={<ShieldAlert size={16} />}
              label="Security & Antilink"
              active={activeTab === "security"}
              collapsed={collapsed}
              onClick={() => setActiveTab("security")}
            />
            <NavItem
              icon={<Server size={16} />}
              label="Système"
              active={activeTab === "system"}
              collapsed={collapsed}
              onClick={() => setActiveTab("system")}
            />
            <NavItem
              icon={<BarChart2 size={16} />}
              label="Analytics & AI"
              active={activeTab === "analytics"}
              collapsed={collapsed}
              onClick={() => setActiveTab("analytics")}
            />
            <NavItem
              icon={<Settings size={16} />}
              label="Settings"
              active={activeTab === "settings"}
              collapsed={collapsed}
              onClick={() => setActiveTab("settings")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Developer</SectionLabel>
          <div className="space-y-1">
            <NavItem
              icon={<FileText size={16} />}
              label="Console Logs"
              active={activeTab === "logs"}
              collapsed={collapsed}
              onClick={() => setActiveTab("logs")}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status & Collapse Toggle */}
      <div className="border-t border-white/10 px-3 py-3 space-y-2 bg-[#0b0b0c] overflow-hidden">
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-between rounded-xl bg-[#0e0e11] border border-white/5 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    botStatus === "connected"
                      ? "bg-emerald-400 ring-4 ring-emerald-400/20"
                      : botStatus === "connecting"
                      ? "bg-amber-400 ring-4 ring-amber-400/20"
                      : botStatus === "qr_ready" || botStatus === "pair_code"
                      ? "bg-amber-400 ring-4 ring-amber-400/20"
                      : "bg-rose-500"
                  }`}
                />
                <span className="text-xs font-semibold text-zinc-300 capitalize truncate whitespace-nowrap">
                  {botStatus === "qr_ready"
                    ? "Scan QR"
                    : botStatus === "pair_code"
                    ? "Pair Code"
                    : botStatus}
                </span>
              </div>
              {reconnectCount > 0 && (
                <span className="text-[11px] font-mono text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded shrink-0">
                  #{reconnectCount}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100 transition-colors cursor-pointer"
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center">
            {/* 9.18ss — morph universel : repli↔dépli de la sidebar. */}
            <MorphIcon icon={collapsed ? PanelLeftData : PanelLeftCloseData} size={16} spring="snappy" reducedMotion="user" />
          </div>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="truncate whitespace-nowrap"
            >
              Collapse Sidebar
            </motion.span>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
