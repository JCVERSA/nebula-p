import { motion, AnimatePresence } from "motion/react";
import {
  Home,
  QrCode,
  Terminal,
  Cpu,
  Package,
  Users,
  ShieldAlert,
  BarChart2,
  Settings,
  KeyRound,
  FileText,
  BookOpen,
  FileDown,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Zap,
  Activity,
} from "lucide-react";
import { ConnectionStatus } from "../lib/types";

export type NavTab =
  | "overview"
  | "connect"
  | "commands"
  | "simulator"
  | "gemini"
  | "plugins"
  | "groups"
  | "security"
  | "analytics"
  | "diagnostics"
  | "secrets"
  | "logs"
  | "settings"
  | "docs"
  | "export";

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
          ? "bg-[#18181b]/85 border border-white/5 shadow-inner"
          : "text-zinc-400 hover:bg-[#18181b]/50 hover:text-zinc-100 border border-transparent"
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
              className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-mono shrink-0 bg-white/5 border border-white/10"
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
      className="px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black font-black text-sm shadow-md transition-transform hover:rotate-12 duration-200">
          <Zap className="h-4 w-4 fill-black text-black" />
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
                <span className="font-bold text-sm text-white tracking-tight whitespace-nowrap">Nebula</span>
                <span className="rounded-md bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono font-semibold text-amber-400">v1.1</span>
              </div>
              <p className="text-[10px] text-zinc-500 truncate whitespace-nowrap">WhatsApp Cloud Bot</p>
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
              icon={<Sparkles size={16} />}
              label="Gemini AI"
              active={activeTab === "gemini"}
              collapsed={collapsed}
              onClick={() => setActiveTab("gemini")}
            />
            <NavItem
              icon={<Package size={16} />}
              label="Plugins"
              active={activeTab === "plugins"}
              collapsed={collapsed}
              onClick={() => setActiveTab("plugins")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
          <div className="space-y-1">
            <NavItem
              icon={<Users size={16} />}
              label="Group Tools"
              active={activeTab === "groups"}
              collapsed={collapsed}
              onClick={() => setActiveTab("groups")}
            />
            <NavItem
              icon={<ShieldAlert size={16} />}
              label="Security & Antilink"
              active={activeTab === "security"}
              collapsed={collapsed}
              onClick={() => setActiveTab("security")}
            />
            <NavItem
              icon={<BarChart2 size={16} />}
              label="Analytics & AI"
              active={activeTab === "analytics"}
              collapsed={collapsed}
              onClick={() => setActiveTab("analytics")}
            />
            <NavItem
              icon={<Activity size={16} />}
              label="System Diagnostics"
              active={activeTab === "diagnostics"}
              collapsed={collapsed}
              onClick={() => setActiveTab("diagnostics")}
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
              icon={<KeyRound size={16} />}
              label="API Secrets"
              active={activeTab === "secrets"}
              collapsed={collapsed}
              onClick={() => setActiveTab("secrets")}
            />
            <NavItem
              icon={<FileText size={16} />}
              label="Console Logs"
              active={activeTab === "logs"}
              collapsed={collapsed}
              onClick={() => setActiveTab("logs")}
            />
            <NavItem
              icon={<BookOpen size={16} />}
              label="Documentation"
              active={activeTab === "docs"}
              collapsed={collapsed}
              onClick={() => setActiveTab("docs")}
            />
            <NavItem
              icon={<FileDown size={16} />}
              label="Export"
              active={activeTab === "export"}
              collapsed={collapsed}
              onClick={() => setActiveTab("export")}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status & Collapse Toggle */}
      <div className="border-t border-white/10 px-3 py-3 space-y-2 bg-[#0a0a0c] overflow-hidden">
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-between rounded-xl bg-[#141416] border border-white/5 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    botStatus === "connected"
                      ? "bg-emerald-400 ring-4 ring-emerald-400/20 animate-pulse"
                      : botStatus === "connecting"
                      ? "bg-amber-400 ring-4 ring-amber-400/20 animate-pulse"
                      : botStatus === "qr_ready" || botStatus === "pair_code"
                      ? "bg-amber-400 ring-4 ring-amber-400/20 animate-pulse"
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
                <span className="text-[10px] font-mono text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded shrink-0">
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
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
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
