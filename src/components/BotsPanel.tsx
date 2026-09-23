import { useCallback, useEffect, useState } from "react";
import {
  Bot as BotIcon,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  Circle,
  Terminal as TerminalIcon,
} from "lucide-react";

/**
 * Multi-bots (8.77) — vue de supervision des bots du déploiement.
 *
 * Consomme GET /api/bots (panneau superviseur) : état process + état WhatsApp
 * fusionnés par bot, actions start/stop/restart (POST /api/bots/:id/…) et
 * sélection du bot que le reste du panneau pilote (le sélecteur remonte à
 * App.tsx qui route toutes les requêtes par-bot avec ?bot=<id>).
 *
 * Défensif par construction : toute charge inattendue (champs manquants,
 * réponse vide) dégrade l'affichage sans faire planter le tableau de bord.
 */

export interface BotCardData {
  id: string;
  name: string;
  enabled: boolean;
  process: "stopped" | "starting" | "running" | "backoff";
  pid: number | null;
  enginePort: number;
  uptimeSeconds: number;
  restarts: number;
  ready: boolean;
  whatsapp: { status?: string; pairingCode?: string } | null;
  isDefault: boolean;
}

interface BotsApiResponse {
  bots?: BotCardData[];
  config?: { source?: string; file?: string; error?: string; total?: number; enabled?: number };
}

interface BotsPanelProps {
  activeBotId: string | null;
  onSelectBot: (botId: string | null) => void;
}

type BotAction = "start" | "stop" | "restart";

const POLL_INTERVAL_MS = 4000;

function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const PROCESS_META: Record<BotCardData["process"], { label: string; classes: string }> = {
  running: { label: "Running", classes: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  starting: { label: "Starting", classes: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  backoff: { label: "Restart scheduled", classes: "text-orange-300 border-orange-500/40 bg-orange-500/10" },
  stopped: { label: "Stopped", classes: "text-zinc-400 border-white/10 bg-white/5" },
};

function whatsappMeta(bot: BotCardData): { label: string; classes: string; code?: string } {
  const status = bot.whatsapp?.status;
  if (!bot.enabled) return { label: "Disabled in bots.json", classes: "text-zinc-500 border-white/10 bg-white/5" };
  if (!status) {
    return {
      label: bot.process === "running" ? "Engine up — no session state" : "No session state",
      classes: "text-zinc-400 border-white/10 bg-white/5",
    };
  }
  switch (status) {
    case "connected":
      return { label: "WhatsApp connected", classes: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" };
    case "connecting":
      return { label: "Connecting…", classes: "text-amber-300 border-amber-500/40 bg-amber-500/10" };
    case "qr_ready":
      return { label: "QR code ready", classes: "text-amber-300 border-amber-500/40 bg-amber-500/10" };
    case "pairing_code_ready":
      return {
        label: "Pairing code ready",
        classes: "text-violet-300 border-violet-500/40 bg-violet-500/10",
        code: bot.whatsapp?.pairingCode,
      };
    case "error":
      return { label: "Connection error", classes: "text-rose-300 border-rose-500/40 bg-rose-500/10" };
    default:
      return { label: "WhatsApp disconnected", classes: "text-zinc-400 border-white/10 bg-white/5" };
  }
}

export default function BotsPanel({ activeBotId, onSelectBot }: BotsPanelProps) {
  const [bots, setBots] = useState<BotCardData[] | null>(null);
  const [config, setConfig] = useState<BotsApiResponse["config"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, BotAction | undefined>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/bots", { credentials: "same-origin" });
      if (!res.ok) {
        setLoadError(`Panel returned HTTP ${res.status}`);
        return;
      }
      const data: BotsApiResponse = await res.json();
      setLoadError(null);
      setConfig(data.config ?? null);
      setBots(Array.isArray(data.bots) ? data.bots : []);
    } catch {
      setLoadError("Network error while contacting the panel");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const runAction = useCallback(
    async (botId: string, action: BotAction) => {
      setBusy((prev) => ({ ...prev, [botId]: action }));
      try {
        await fetch(`/api/bots/${encodeURIComponent(botId)}/${action}`, {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        // The next poll refreshes the real state; surface nothing noisy.
      } finally {
        setBusy((prev) => ({ ...prev, [botId]: undefined }));
        refresh();
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2.5">
            <BotIcon className="w-5 h-5 text-cyan-300" />
            Multi-Bots
          </h2>
          <p className="text-[13px] text-zinc-400 mt-1">
            Every bot runs in its own engine process — a crash never takes the others down.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeBotId && (
            <button
              onClick={() => onSelectBot(null)}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-zinc-300 transition cursor-pointer"
              title="Route panel requests to the default bot"
            >
              Use default bot
            </button>
          )}
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-zinc-300 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ------------------------------------------------- configuration state */}
      {config?.error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-4">
          <p className="text-[13px] font-bold text-rose-300">bots.json is invalid — no bot is running</p>
          <p className="text-xs text-rose-200/80 mt-1 font-mono break-words">{config.error}</p>
          <p className="text-[11px] text-zinc-400 mt-2">
            Fix bots.json on the server, then run <code className="text-zinc-200">./manage.sh restart</code>.
          </p>
        </div>
      )}
      {!config?.error && config?.source === "default" && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[13px] font-semibold text-zinc-200">Single default bot</p>
          <p className="text-xs text-zinc-400 mt-1">
            No bots.json found — the deployment runs one default bot on the legacy paths. Copy{" "}
            <code className="text-zinc-200">bots.example.json</code> to <code className="text-zinc-200">bots.json</code>{" "}
            on the server to run up to 8 bots (see docs/MULTI_BOTS.md).
          </p>
        </div>
      )}
      {loadError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          Could not load the bots overview: {loadError}
        </div>
      )}
      {bots !== null && bots.length === 0 && !loadError && !config?.error && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-[13px] text-zinc-400">
          No bot is configured. {config?.source === "file" ? "Check bots.json — its bots list is empty." : ""}
        </div>
      )}

      {/* ------------------------------------------------------------- cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {(bots ?? []).map((bot) => {
          const process = PROCESS_META[bot.process] ?? PROCESS_META.stopped;
          const whatsapp = whatsappMeta(bot);
          const isActive = activeBotId === bot.id;
          const isDefaultSelection = activeBotId === null && bot.isDefault;
          const actionBusy = busy[bot.id];
          const startable = bot.enabled && bot.process !== "running" && bot.process !== "starting";
          const stoppable = bot.process === "running" || bot.process === "starting" || bot.process === "backoff";
          return (
            <div
              key={bot.id}
              className={`rounded-2xl border p-4 sm:p-5 backdrop-blur-sm transition ${
                isActive
                  ? "border-cyan-400/50 bg-cyan-500/5 shadow-[0_0_24px_-6px_rgba(34,211,238,0.35)]"
                  : "border-white/10 bg-[#18181b]/60 hover:border-white/20"
              } ${bot.enabled ? "" : "opacity-60"}`}
            >
              {/* title row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[15px] font-bold text-zinc-100 truncate">{bot.name || bot.id}</h3>
                    {bot.isDefault && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-300 border border-cyan-500/40 bg-cyan-500/10 rounded-full px-2 py-0.5">
                        default
                      </span>
                    )}
                    {!bot.enabled && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 border border-white/10 bg-white/5 rounded-full px-2 py-0.5">
                        disabled
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                    {bot.id} · port {bot.enginePort}
                    {bot.pid != null ? ` · PID ${bot.pid}` : ""}
                  </p>
                </div>
                {/* selection control */}
                <button
                  onClick={() => onSelectBot(isDefaultSelection ? null : isActive ? null : bot.id)}
                  disabled={!bot.enabled}
                  title={
                    isActive || isDefaultSelection
                      ? "The panel is currently controlling this bot"
                      : `Route the whole panel to ${bot.name || bot.id}`
                  }
                  className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    isActive || isDefaultSelection
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                      : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  {isActive || isDefaultSelection ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      In panel
                    </>
                  ) : (
                    <>
                      <Circle className="w-3.5 h-3.5" />
                      Control
                    </>
                  )}
                </button>
              </div>

              {/* state chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${process.classes}`}
                >
                  <TerminalIcon className="w-3 h-3" />
                  {process.label}
                  {bot.process === "running" ? ` · ${formatUptime(bot.uptimeSeconds)}` : ""}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${whatsapp.classes}`}
                >
                  {whatsapp.label}
                </span>
                {bot.restarts > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                    {bot.restarts} restart{bot.restarts > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* pairing code */}
              {whatsapp.code && (
                <div className="mt-3 rounded-xl border border-violet-500/40 bg-violet-950/30 px-4 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-violet-300/80 font-bold">
                    Pairing code — {bot.name || bot.id}
                  </p>
                  <p className="text-xl font-mono font-bold tracking-[0.2em] text-violet-100 mt-1">{whatsapp.code}</p>
                  <p className="text-[10px] text-zinc-400 mt-1">
                    WhatsApp → Settings → Linked devices → Link with phone number instead
                  </p>
                </div>
              )}

              {/* actions */}
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => runAction(bot.id, "start")}
                  disabled={!startable || actionBusy !== undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-bold text-emerald-300 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="w-3.5 h-3.5" />
                  {actionBusy === "start" ? "Starting…" : "Start"}
                </button>
                <button
                  onClick={() => runAction(bot.id, "stop")}
                  disabled={!stoppable || actionBusy !== undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-bold text-rose-300 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Square className="w-3.5 h-3.5" />
                  {actionBusy === "stop" ? "Stopping…" : "Stop"}
                </button>
                <button
                  onClick={() => runAction(bot.id, "restart")}
                  disabled={!bot.enabled || actionBusy !== undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${actionBusy === "restart" ? "animate-spin" : ""}`} />
                  {actionBusy === "restart" ? "Restarting…" : "Restart"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-500">
        Pair a number from the terminal: <code className="text-zinc-300">nebula pair [bot] &lt;number&gt;</code> · CLI
        control: <code className="text-zinc-300">nebula bot &lt;id&gt; start|stop|restart|status</code>
      </p>
    </div>
  );
}
