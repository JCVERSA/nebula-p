import { useCallback, useEffect, useRef, useState } from "react";
import {
  Server,
  RefreshCw,
  RotateCcw,
  Square,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  KeyRound,
  Settings2,
  Cookie,
  Copy,
  Download,
} from "lucide-react";

/**
 * 9.2 — Section « Système » : mini-console admin du panneau.
 *
 * Idée owner : piloter `nebula update` depuis le dashboard, sans SSH.
 * Étendu en mini-console : mise à jour, redémarrage, arrêt, journal en
 * direct (polling léger).
 *
 * Particularité : les actions ARRÊTENT le panneau lui-même (~1-3 min).
 * Le composant suit donc un cycle de vie :
 *   lancé → le panneau devient injoignable (normal, pas une erreur) →
 *   il revient → la page se recharge automatiquement (nouvelle version).
 * Cas « Déjà à jour » : le panneau ne meurt jamais → message sans reload.
 */

interface SystemInfoData {
  version?: string;
  commit?: string;
  branch?: string;
  uptimeSeconds?: number;
  updating?: boolean;
}

interface YtCookiesStatusData {
  configured?: boolean;
  envSet?: boolean;
  cookieCount?: number;
  domains?: string[];
  maxExpiry?: string | null;
  updatedAt?: string | null;
}

interface EnvVarView {
  key: string;
  label: string;
  description: string;
  type: "number" | "boolean" | "enum" | "string" | "path" | "secret";
  group: "quotas" | "digest" | "keys";
  choices?: string[];
  default?: string;
  set: boolean;
  value: string;
  restartRequired: boolean;
}

const ENV_GROUP_META: Record<EnvVarView["group"], { title: string; hint?: string }> = {
  quotas: { title: "Quotas & moteur IA" },
  digest: { title: "Digest & veille" },
  keys: {
    title: "Clés & accès (écriture seule)",
    hint: "Les clés ne s'affichent jamais — colle la nouvelle valeur pour remplacer.",
  },
};

type Phase = "idle" | "updating" | "restarting" | "stopping" | "uptodate";
type ModalAction = "update" | "restart" | "stop" | null;

const INFO_POLL_MS = 5000;
const LOG_POLL_MS = 4000;
const LIFECYCLE_POLL_MS = 2500;

function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const ACTION_META: Record<
  Exclude<ModalAction, null>,
  { title: string; desc: string; confirm: string; classes: string }
> = {
  update: {
    title: "Mettre à jour",
    desc:
      "Le bot et le panneau vont redémarrer pendant la mise à jour (~2 min). " +
      "Les messages WhatsApp ne sont pas traités pendant ce temps.",
    confirm: "Lancer la mise à jour",
    classes: "bg-emerald-500 hover:bg-emerald-400 text-emerald-950",
  },
  restart: {
    title: "Redémarrer",
    desc: "Le panneau et les bots vont redémarrer (~30 s). Utile après un changement de .env.",
    confirm: "Redémarrer",
    classes: "bg-amber-400 hover:bg-amber-300 text-amber-950",
  },
  stop: {
    title: "Arrêter",
    desc:
      "⚠️ Tout s'éteint (panneau inclus) et ne redémarre PAS tout seul. " +
      "Relance uniquement possible en SSH : nebula start",
    confirm: "Tout arrêter",
    classes: "bg-rose-500 hover:bg-rose-400 text-rose-50",
  },
};

export default function SystemPanel() {
  const [info, setInfo] = useState<SystemInfoData | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [logsPaused, setLogsPaused] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [modal, setModal] = useState<ModalAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Le panneau est-il passé par l'état injoignable depuis le lancement ?
  const panelLostRef = useRef(false);
  // 9.3 — éditeur .env
  const [envVars, setEnvVars] = useState<EnvVarView[] | null>(null);
  const [envEditing, setEnvEditing] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState("");
  const [envFeedback, setEnvFeedback] = useState<string | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  // 9.4 — cookies YouTube
  const [ytStatus, setYtStatus] = useState<YtCookiesStatusData | null>(null);
  const [ytContent, setYtContent] = useState("");
  const [ytFeedback, setYtFeedback] = useState<string | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytBusy, setYtBusy] = useState(false);
  const [ytConfirmDelete, setYtConfirmDelete] = useState(false);
  // 9.4b — journal : copie / export
  const [logsCopied, setLogsCopied] = useState(false);

  const fetchJson = async (url: string): Promise<any | null> => {
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const refreshInfo = useCallback(async () => {
    const data = await fetchJson("/api/system/info");
    if (data) {
      setInfo(data);
      setInfoError(null);
    } else {
      setInfoError("Panneau injoignable — redémarrage en cours ?");
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    const data = await fetchJson("/api/system/logs?lines=100");
    if (data && typeof data.lines === "string") setLogs(data.lines);
  }, []);

  const refreshEnv = useCallback(async () => {
    const data = await fetchJson("/api/system/env");
    if (data?.vars) setEnvVars(data.vars);
  }, []);

  const saveEnvVar = async (key: string) => {
    setEnvError(null);
    setEnvFeedback(null);
    try {
      const res = await fetch("/api/system/env", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: envDraft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setEnvError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setEnvEditing(null);
      setEnvDraft("");
      setEnvFeedback(
        data?.restartRequired
          ? `✓ ${key} enregistré — redémarrage requis pour l'appliquer`
          : `✓ ${key} appliqué à chaud`
      );
      refreshEnv();
    } catch {
      setEnvError("Panneau injoignable — réessaie.");
    }
  };

  const refreshYtCookies = useCallback(async () => {
    const data = await fetchJson("/api/system/yt-cookies");
    if (data) setYtStatus(data);
  }, []);

  const saveYtCookies = async () => {
    setYtBusy(true);
    setYtError(null);
    setYtFeedback(null);
    try {
      const res = await fetch("/api/system/yt-cookies", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: ytContent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setYtError(data?.error || `HTTP ${res.status}`);
        return;
      }
      const expiry = data?.maxExpiry
        ? new Date(data.maxExpiry).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : null;
      setYtFeedback(
        `✓ ${data.cookieCount} cookies enregistrés (${(data.domains || []).join(", ")})` +
          `${expiry ? ` — valides jusqu'au ${expiry}` : ""}` +
          (data.restartRequired ? " — redémarrage requis pour activer" : " — actif à chaud")
      );
      setYtContent("");
      refreshYtCookies();
    } catch {
      setYtError("Panneau injoignable — réessaie.");
    } finally {
      setYtBusy(false);
    }
  };

  const deleteYtCookies = async () => {
    setYtBusy(true);
    setYtError(null);
    setYtFeedback(null);
    try {
      await fetch("/api/system/yt-cookies", { method: "DELETE", credentials: "same-origin" });
      setYtConfirmDelete(false);
      setYtFeedback("Cookies supprimés — mode anonyme (redémarrage requis pour l'appliquer).");
      refreshYtCookies();
    } catch {
      setYtError("Panneau injoignable — réessaie.");
    } finally {
      setYtBusy(false);
    }
  };

  // 9.4b — copier ce qui est affiché (WYSIWYG, pour coller dans le chat).
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch {
      /* clipboard indisponible (contexte non sécurisé) — silencieux */
    }
  };

  // 9.4b — exporter : récupère les 300 dernières lignes (max API) avec un
  // en-tête daté + version — le fichier se partage tel quel pour du debug.
  const exportLogs = async () => {
    try {
      const data = await fetchJson("/api/system/logs?lines=300");
      const content = typeof data?.lines === "string" && data.lines ? data.lines : logs;
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const name = `nebula-logs-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}-${pad(stamp.getHours())}h${pad(stamp.getMinutes())}.txt`;
      const header =
        `# Nebula — export des logs (${stamp.toISOString()})\n` +
        `# version ${info?.version ?? "?"} · commit ${info?.commit ?? "?"} · 300 dernières lignes\n\n`;
      const blob = new Blob([header + content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* export best-effort */
    }
  };

  // ── Polling de fond (info + journal) ─────────────────────────────────────
  useEffect(() => {
    refreshInfo();
    const t = setInterval(refreshInfo, INFO_POLL_MS);
    return () => clearInterval(t);
  }, [refreshInfo]);

  // 9.3 — configuration .env (chargée une fois, rechargée après édition)
  useEffect(() => {
    refreshEnv();
    refreshYtCookies();
  }, [refreshEnv, refreshYtCookies]);

  useEffect(() => {
    if (logsPaused || phase === "stopping") return;
    refreshLogs();
    const t = setInterval(refreshLogs, LOG_POLL_MS);
    return () => clearInterval(t);
  }, [refreshLogs, logsPaused, phase]);

  // ── Cycle de vie update : suivre jusqu'au retour du panneau ─────────────
  useEffect(() => {
    if (phase !== "updating") return;
    panelLostRef.current = false;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/system/update-status", { credentials: "same-origin" });
        if (!res.ok) throw new Error("down");
        const data = await res.json();
        if (stopped) return;
        if (data?.updating) return; // toujours en cours
        // Terminé SANS que le panneau soit jamais mort → déjà à jour.
        if (!panelLostRef.current) {
          setPhase("uptodate");
          refreshInfo();
          return;
        }
        // Le panneau est revenu avec (peut-être) une nouvelle version.
        setPhase("idle");
        window.location.reload();
      } catch {
        panelLostRef.current = true; // panneau en train de redémarrer : NORMAL
      }
    };
    poll();
    const t = setInterval(poll, LIFECYCLE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase, refreshInfo]);

  // ── Cycle redémarrage : attendre le retour du panneau ───────────────────
  useEffect(() => {
    if (phase !== "restarting") return;
    panelLostRef.current = false;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { credentials: "same-origin" });
        if (!res.ok) throw new Error("down");
        if (stopped) return;
        if (panelLostRef.current) {
          setPhase("idle");
          window.location.reload();
        }
      } catch {
        panelLostRef.current = true;
      }
    };
    poll();
    const t = setInterval(poll, LIFECYCLE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase]);

  const launchAction = async (action: Exclude<ModalAction, null>) => {
    setModal(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/system/${action}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error || `HTTP ${res.status}`);
        return;
      }
      if (action === "update") setPhase("updating");
      else if (action === "restart") setPhase("restarting");
      else setPhase("stopping");
    } catch {
      setActionError("Panneau injoignable — réessaie.");
    }
  };

  const updating = info?.updating || phase === "updating";
  const busy = phase === "updating" || phase === "restarting";

  return (
    <div className="space-y-5 max-w-4xl" data-testid="system-panel">
      {/* ── État & version ─────────────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Server size={18} className="text-sky-300" />
          <h3 className="text-sm font-semibold text-zinc-100">Système</h3>
          {updating && (
            <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              mise à jour en cours…
            </span>
          )}
        </div>
        {infoError && !info ? (
          <p className="text-xs text-rose-300">{infoError}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-zinc-500">Version</p>
              <p className="text-zinc-100 font-mono" data-testid="system-version">
                {info?.version ?? "…"}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Commit</p>
              <p className="text-zinc-100 font-mono">{info?.commit ?? "…"}</p>
            </div>
            <div>
              <p className="text-zinc-500">Branche</p>
              <p className="text-zinc-100 font-mono">{info?.branch ?? "…"}</p>
            </div>
            <div>
              <p className="text-zinc-500">Panneau up</p>
              <p className="text-zinc-100 font-mono">
                {info ? formatUptime(info.uptimeSeconds ?? 0) : "…"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-1">Actions</h3>
        <p className="text-[11px] text-zinc-500 mb-4">
          La mise à jour tire la dernière version publiée sur GitHub (sync depuis ton PC d'abord).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            data-testid="btn-system-update"
            disabled={busy}
            onClick={() => setModal("update")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-emerald-950 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <Rocket size={14} /> Mettre à jour
          </button>
          <button
            data-testid="btn-system-restart"
            disabled={busy}
            onClick={() => setModal("restart")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-amber-950 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <RotateCcw size={14} /> Redémarrer
          </button>
          <button
            data-testid="btn-system-stop"
            disabled={busy}
            onClick={() => setModal("stop")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/90 hover:bg-rose-400 text-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <Square size={14} /> Arrêter
          </button>
        </div>

        {phase === "updating" && (
          <div className="mt-4 flex items-start gap-2 text-xs text-amber-300" data-testid="system-lifecycle">
            <RefreshCw size={14} className="animate-spin mt-0.5" />
            <span>
              Mise à jour en cours — le panneau va redémarrer (~2 min).
              Cette page se rechargera automatiquement.
            </span>
          </div>
        )}
        {phase === "restarting" && (
          <div className="mt-4 flex items-start gap-2 text-xs text-amber-300" data-testid="system-lifecycle">
            <RefreshCw size={14} className="animate-spin mt-0.5" />
            <span>Redémarrage en cours (~30 s) — la page se rechargera automatiquement.</span>
          </div>
        )}
        {phase === "stopping" && (
          <div className="mt-4 flex items-start gap-2 text-xs text-rose-300" data-testid="system-lifecycle">
            <AlertTriangle size={14} className="mt-0.5" />
            <span>
              Arrêt demandé — le panneau va s'éteindre. Relance en SSH :{" "}
              <code className="font-mono">nebula start</code>
            </span>
          </div>
        )}
        {phase === "uptodate" && (
          <div className="mt-4 flex items-start gap-2 text-xs text-emerald-300" data-testid="system-lifecycle">
            <CheckCircle2 size={14} className="mt-0.5" />
            <span>Déjà à jour — aucune nouvelle version sur GitHub.</span>
          </div>
        )}
        {actionError && (
          <p className="mt-3 text-xs text-rose-300" data-testid="system-action-error">
            {actionError}
          </p>
        )}
      </div>

      {/* ── Configuration .env (9.3) ───────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5" data-testid="env-editor">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 size={16} className="text-zinc-300" />
          <h3 className="text-sm font-semibold text-zinc-100">Configuration (.env)</h3>
        </div>
        <p className="text-[11px] text-zinc-500 mb-4">
          Les clés sont en écriture seule (masquées). La plupart des réglages s'appliquent après un
          redémarrage — le bouton Redémarrer est juste au-dessus.
        </p>

        {envFeedback && (
          <p className="mb-3 text-xs text-emerald-300" data-testid="env-feedback">{envFeedback}</p>
        )}
        {envError && (
          <p className="mb-3 text-xs text-rose-300" data-testid="env-error">{envError}</p>
        )}

        {!envVars ? (
          <p className="text-xs text-zinc-500">Chargement…</p>
        ) : (
          (["quotas", "digest", "keys"] as const).map((group) => {
            const vars = envVars.filter((v) => v.group === group);
            if (!vars.length) return null;
            return (
              <div key={group} className="mb-4 last:mb-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                  {ENV_GROUP_META[group].title}
                </p>
                {ENV_GROUP_META[group].hint && (
                  <p className="text-[11px] text-zinc-600 mb-2">{ENV_GROUP_META[group].hint}</p>
                )}
                <div className="space-y-2">
                  {vars.map((v) => (
                    <div
                      key={v.key}
                      className="flex flex-wrap items-center gap-2 justify-between bg-black/20 border border-white/5 rounded-xl px-3 py-2"
                      data-testid={`env-var-${v.key}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-200 font-medium">
                          {v.label}{" "}
                          {v.type === "secret" && <KeyRound size={11} className="inline text-zinc-500" />}
                        </p>
                        <p className="text-[10.5px] text-zinc-500 truncate">{v.description}</p>
                        <p className="text-[10.5px] font-mono text-zinc-400 mt-0.5">
                          {v.set ? v.value : <span className="text-zinc-600">(défaut{v.default ? ` : ${v.default}` : ""})</span>}
                        </p>
                      </div>
                      {envEditing === v.key ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type={v.type === "secret" ? "password" : "text"}
                            value={envDraft}
                            onChange={(e) => setEnvDraft(e.target.value)}
                            placeholder={v.type === "secret" ? "colle la clé…" : v.default || ""}
                            className="w-44 px-2 py-1 rounded-lg bg-black/40 border border-white/10 text-xs text-zinc-100 font-mono focus:outline-none focus:border-sky-500/50"
                            data-testid={`env-input-${v.key}`}
                          />
                          <button
                            onClick={() => saveEnvVar(v.key)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-500 hover:bg-sky-400 text-sky-950 transition cursor-pointer"
                            data-testid={`env-save-${v.key}`}
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setEnvEditing(null); setEnvDraft(""); }}
                            className="px-2 py-1 rounded-lg text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 transition cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEnvEditing(v.key); setEnvDraft(""); setEnvFeedback(null); setEnvError(null); }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition cursor-pointer"
                        >
                          {v.set ? "Modifier" : "Définir"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Cookies YouTube (9.4) ───────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5" data-testid="yt-cookies-card">
        <div className="flex items-center gap-2 mb-1">
          <Cookie size={16} className="text-zinc-300" />
          <h3 className="text-sm font-semibold text-zinc-100">Cookies YouTube</h3>
          {ytStatus?.configured && (
            <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              ✓ configuré
            </span>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mb-3">
          Débloque .ytv/.ytm quand YouTube exige une session. Sur ton PC : extension « Get cookies.txt
          LOCALLY » sur youtube.com connecté → Export → colle le contenu ci-dessous. Le contenu ne
          s'affiche jamais et n'est jamais renvoyé.
        </p>

        {ytStatus?.configured && (
          <p className="text-[11px] text-zinc-400 mb-3" data-testid="yt-cookies-status">
            {ytStatus.cookieCount} cookies ({(ytStatus.domains || []).slice(0, 3).join(", ")})
            {ytStatus.maxExpiry
              ? ` — valides jusqu'au ${new Date(ytStatus.maxExpiry).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
              : ""}
          </p>
        )}

        {ytFeedback && (
          <p className="mb-3 text-xs text-emerald-300" data-testid="yt-cookies-feedback">{ytFeedback}</p>
        )}
        {ytError && (
          <p className="mb-3 text-xs text-rose-300" data-testid="yt-cookies-error">{ytError}</p>
        )}

        <textarea
          value={ytContent}
          onChange={(e) => setYtContent(e.target.value)}
          rows={4}
          placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tVISITOR_INFO1_LIVE\t…"}
          className="w-full mb-2 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-sky-500/50"
          data-testid="yt-cookies-input"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveYtCookies}
            disabled={ytBusy || !ytContent.trim()}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-sky-950 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            data-testid="yt-cookies-save"
          >
            Enregistrer les cookies
          </button>
          {ytStatus?.configured && (
            <button
              onClick={() => (ytConfirmDelete ? deleteYtCookies() : setYtConfirmDelete(true))}
              disabled={ytBusy}
              onBlur={() => setYtConfirmDelete(false)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                ytConfirmDelete
                  ? "bg-rose-500 hover:bg-rose-400 text-rose-50"
                  : "bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300"
              }`}
              data-testid="yt-cookies-delete"
            >
              {ytConfirmDelete ? "Confirmer la suppression ?" : "Supprimer"}
            </button>
          )}
        </div>
      </div>

      {/* ── Journal en direct ──────────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-100">Journal (bot.log)</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={copyLogs}
              title="Copier les lignes affichées"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition cursor-pointer"
              data-testid="btn-copy-logs"
            >
              <Copy size={12} />
              {logsCopied ? "Copié ✓" : "Copier"}
            </button>
            <button
              onClick={exportLogs}
              title="Exporter les 300 dernières lignes en .txt"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition cursor-pointer"
              data-testid="btn-export-logs"
            >
              <Download size={12} />
              Exporter
            </button>
            <button
              onClick={() => setLogsPaused((p) => !p)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition cursor-pointer"
            >
              {logsPaused ? <Play size={12} /> : <Pause size={12} />}
              {logsPaused ? "Reprendre" : "Pause"}
            </button>
          </div>
        </div>
        <pre
          data-testid="system-log"
          className="text-[10.5px] leading-relaxed font-mono text-zinc-400 bg-black/40 border border-white/5 rounded-xl p-3 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all"
        >
          {logs || "— aucune ligne —"}
        </pre>
      </div>

      {/* ── Modale de confirmation ─────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          data-testid="system-modal"
        >
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <h4 className="text-sm font-semibold text-zinc-100 mb-2">
              {ACTION_META[modal].title} — confirmer ?
            </h4>
            <p className="text-xs text-zinc-400 leading-relaxed mb-5">{ACTION_META[modal].desc}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                data-testid="system-modal-confirm"
                onClick={() => launchAction(modal)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${ACTION_META[modal].classes}`}
              >
                {ACTION_META[modal].confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
