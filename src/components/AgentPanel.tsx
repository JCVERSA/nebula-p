import { useCallback, useEffect, useState } from "react";
import { Bot as BotIcon, ShieldCheck, Gauge, Zap } from "lucide-react";

/**
 * 9.18y (P3) — page « Agent IA » du panneau : santé et activité de l'agent.
 *
 * Données : GET /api/bot/agent-metrics (bot actif, proxifié par le panneau) :
 *  - health   : agrégat 24 h (tours, actions, taux de JSON valide, latence) ;
 *  - timeline : buckets hornaires 48 h + répartition par moteur.
 * AUCUN contenu de message n'est collecté ni affiché — compteurs uniquement
 * (§ vie privée, agentMetrics.ts). Zéro nouvelle dépendance : graphique en
 * barres CSS pur.
 */

interface AgentHealthData {
  windowHours: number;
  turns: number;
  executes: number;
  asks: number;
  replies: number;
  degraded: number;
  denied: number;
  errors: number;
  parseOkRate: number;
  avgLatencyMs: number | null;
  argsSanitized: number;
  lastDegradedAt: number | null;
}

interface AgentBucket {
  tsHour: number;
  turns: number;
  execute: number;
  ask: number;
  reply: number;
  degraded: number;
  denied: number;
  error: number;
  parseOk: number;
  avgLatencyMs: number | null;
}

interface AgentMetricsData {
  health: AgentHealthData;
  timeline: {
    windowHours: number;
    buckets: AgentBucket[];
    engines: { gemini: number; nim: number };
  };
}

const POLL_INTERVAL_MS = 60_000;

/** Couleurs par action (mêmes teintes que le reste du panneau). */
const ACTION_COLORS: Array<{ key: keyof AgentBucket; label: string; color: string }> = [
  { key: "execute", label: "Exécutions", color: "bg-cyan-400" },
  { key: "reply", label: "Réponses", color: "bg-indigo-400" },
  { key: "ask", label: "Questions", color: "bg-violet-400" },
  { key: "degraded", label: "Dégradé", color: "bg-amber-400" },
  { key: "denied", label: "Refus", color: "bg-zinc-500" },
  { key: "error", label: "Erreurs", color: "bg-rose-400" },
];

function Kpi({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] border border-white/5 p-3 text-center" data-testid={`agent-kpi-${label}`}>
      <div className={`text-xl font-bold ${accent || "text-zinc-100"}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

export default function AgentPanel() {
  const [data, setData] = useState<AgentMetricsData | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/agent-metrics", { credentials: "same-origin" });
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const json: AgentMetricsData = await res.json();
      setData(json);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const health = data?.health;
  const timeline = data?.timeline;
  const maxTurns = timeline ? Math.max(1, ...timeline.buckets.map((b) => b.turns)) : 1;
  const engineTotal = timeline ? Math.max(1, timeline.engines.gemini + timeline.engines.nim) : 1;

  return (
    <div className="space-y-6 animate-fade-in" data-testid="agent-metrics-page">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2.5">
            <BotIcon className="w-5 h-5 text-cyan-300" />
            Agent IA — santé &amp; activité
          </h2>
          <p className="text-[13px] text-zinc-400 mt-1">
            Chaque tour de l'agent est compté (aucun contenu stocké) — bot actif uniquement.
          </p>
        </div>
        {health && (
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
              health.parseOkRate >= 0.9
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
                : "bg-amber-500/15 text-amber-300 border-amber-500/20"
            }`}
            data-testid="agent-parse-badge"
          >
            {Math.round(health.parseOkRate * 100)}% décisions JSON valides (24 h)
          </span>
        )}
      </div>

      {/* --------------------------------------------------------- unavailable */}
      {unavailable && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-zinc-400 text-sm" data-testid="agent-metrics-unavailable">
          Métriques agent indisponibles — le moteur du bot actif ne répond pas.
        </div>
      )}

      {/* ------------------------------------------------------- KPIs (24 h) */}
      {health && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi value={health.turns} label="tours" />
          <Kpi value={health.executes} label="exécutées" accent="text-cyan-300" />
          <Kpi value={health.asks + health.replies} label="dialogue" accent="text-indigo-300" />
          <Kpi value={health.degraded} label="dégradé" accent="text-amber-300" />
          <Kpi value={health.errors} label="erreurs" accent="text-rose-300" />
          <Kpi
            value={health.avgLatencyMs === null ? "—" : `${(health.avgLatencyMs / 1000).toFixed(1)}s`}
            label="latence moy."
            accent="text-emerald-300"
          />
        </div>
      )}

      {/* -------------------------------------------------- timeline (48 h) */}
      {timeline && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="agent-timeline">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold tracking-wide text-zinc-200 uppercase flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-cyan-300" />
              Activité horaire — dernières {timeline.windowHours} h
            </h3>
            <div className="flex flex-wrap gap-2">
              {ACTION_COLORS.map((a) => (
                <span key={a.key} className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <span className={`w-2 h-2 rounded-sm ${a.color}`} />
                  {a.label}
                </span>
              ))}
            </div>
          </div>
          {timeline.buckets.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center" data-testid="agent-timeline-empty">
              Aucun tour sur la fenêtre — l'agent n'a pas encore été sollicité.
            </p>
          ) : (
            <div className="flex items-end gap-[3px] h-28" data-testid="agent-timeline-bars">
              {timeline.buckets.map((b) => (
                <div
                  key={b.tsHour}
                  className="flex-1 min-w-[4px] flex flex-col justify-end rounded-sm overflow-hidden group relative"
                  style={{ height: `${Math.max(8, (b.turns / maxTurns) * 100)}%` }}
                  title={new Date(b.tsHour).toLocaleString() + ` — ${b.turns} tour(s), latence moy. ${
                    b.avgLatencyMs === null ? "—" : `${(b.avgLatencyMs / 1000).toFixed(1)}s`
                  }`}
                >
                  {ACTION_COLORS.map((a) => {
                    const v = Number(b[a.key] ?? 0);
                    if (!v) return null;
                    return <div key={a.key} className={a.color} style={{ height: `${(v / b.turns) * 100}%` }} />;
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-2">
            Survole une barre pour le détail de l'heure. Les heures sans activité ne sont pas affichées.
          </p>
        </div>
      )}

      {/* ------------------------------------------- moteurs + garde-fous */}
      {timeline && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-xs font-bold tracking-wide text-zinc-200 uppercase mb-3">Moteurs IA ({timeline.windowHours} h)</h3>
            <div className="space-y-2">
              {(
                [
                  { name: "Gemini", count: timeline.engines.gemini, bar: "bg-gradient-to-r from-indigo-500 to-violet-500" },
                  { name: "NIM", count: timeline.engines.nim, bar: "bg-gradient-to-r from-cyan-500 to-emerald-500" },
                ] as const
              ).map((e) => (
                <div key={e.name} data-testid={`agent-engine-${e.name.toLowerCase()}`}>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>{e.name}</span>
                    <span className="font-mono">
                      {e.count} tour(s) · {Math.round((e.count / engineTotal) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full ${e.bar}`} style={{ width: `${(e.count / engineTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-xs font-bold tracking-wide text-zinc-200 uppercase mb-3 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              Garde-fous (24 h)
            </h3>
            <ul className="text-[12px] text-zinc-400 space-y-1.5">
              <li className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>
                  <strong className="text-zinc-200">{health?.argsSanitized ?? 0}</strong> exécution(s) avec args nettoyés par le guardrail
                </span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                <span>
                  <strong className="text-zinc-200">{health?.denied ?? 0}</strong> commande(s) refusée(s) (denylist/inconnue)
                </span>
              </li>
              <li className="flex items-center gap-2">
                <BotIcon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                <span>Plafonds actifs : 3 décisions/message · 10 exécutions/h · quota IA 40/j</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- vie privée */}
      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5" data-testid="agent-privacy-note">
        <ShieldCheck className="w-3 h-3 shrink-0" />
        Vie privée : compteurs uniquement — aucun message, titre ni argument n'est stocké dans ces métriques.
      </p>
    </div>
  );
}
