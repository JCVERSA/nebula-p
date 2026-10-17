import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Megaphone,
  Sparkles,
  RefreshCw,
  Send,
  Users,
  UsersRound,
  Search,
  History,
  AlertTriangle,
} from "lucide-react";
import { useBotUrl } from "../lib/botContext";

/**
 * 9.16 — Annonces : un seul endroit pour écrire à tout le monde (décision
 * owner — absorbe l'ancien « Group Tools »).
 *
 * - Rédaction manuelle OU brouillon IA (à relire avant l'envoi) ;
 * - Destinataires : utilisateurs cochés (segments rapides) et/ou groupes ;
 * - Envoi PROGRESSIF anti-ban : ~1 message toutes les 3-8 s — une annonce
 *   à 50 personnes prend ~4 min, c'est le prix de protéger le numéro ;
 * - Progression honnête en direct + historique persistant.
 */

interface KnownUser {
  jid: string;
  name: string;
  lastSeen: number;
  banned: boolean;
  noAnnounce?: boolean;
}

interface KnownGroup {
  jid: string;
  name: string;
  lastSeen: number;
  memberCount?: number;
}

interface AnnouncementJob {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  text: string;
  targets: string[];
  sentCount: number;
  failures: Array<{ jid: string; error: string }>;
  status: "running" | "done";
}

interface HistoryEntry {
  id: string;
  at: number;
  text: string;
  total: number;
  sent: number;
  failed: number;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface AnnouncementsPanelProps {
  /** 9.18 (E) — jids pré-sélectionnés depuis le gestionnaire d'utilisateurs. */
  preselected?: string[];
  onPreselectConsumed?: () => void;
}

export default function AnnouncementsPanel({ preselected, onPreselectConsumed }: AnnouncementsPanelProps) {
  const botUrl = useBotUrl();
  const [text, setText] = useState("");
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [groups, setGroups] = useState<KnownGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [job, setJob] = useState<AnnouncementJob | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDirectory = useCallback(async () => {
    try {
      const res = await fetch(botUrl("/api/bot/users"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "répertoire indisponible");
    }
  }, [botUrl]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(botUrl("/api/bot/announce/status"), { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job || null);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      /* silencieux : le polling repassera */
    }
  }, [botUrl]);

  useEffect(() => {
    void loadDirectory();
    void loadStatus();
  }, [loadDirectory, loadStatus]);

  // 9.18 (E) — pont depuis Utilisateurs : « Annoncer à la sélection ».
  useEffect(() => {
    if (preselected && preselected.length) {
      setSelected((prev) => new Set([...prev, ...preselected]));
      onPreselectConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected]);

  // Polling pendant un envoi en cours
  useEffect(() => {
    if (job?.status === "running") {
      pollRef.current = setInterval(() => void loadStatus(), 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [job?.status, loadStatus]);

  // 9.18 (F) — les opt-out sont exclus du ciblage (le serveur filtre aussi).
  const eligibleUsers = useMemo(() => users.filter((u) => !u.banned && !u.noAnnounce), [users]);
  const optOutCount = useMemo(() => users.filter((u) => u.noAnnounce && !u.banned).length, [users]);
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleUsers;
    return eligibleUsers.filter(
      (u) => u.jid.toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q)
    );
  }, [eligibleUsers, search]);

  const selectedUsers = useMemo(() => [...selected].filter((j) => !j.endsWith("@g.us")), [selected]);
  const selectedGroups = useMemo(() => [...selected].filter((j) => j.endsWith("@g.us")), [selected]);

  const toggle = (jid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const selectSegment = (mode: "all" | "active7d") => {
    const weekAgo = Date.now() - 7 * 86400_000;
    setSelected(
      new Set(
        eligibleUsers
          .filter((u) => (mode === "all" ? true : u.lastSeen >= weekAgo))
          .map((u) => u.jid)
      )
    );
  };

  const draft = async () => {
    if (!idea.trim()) return;
    setDrafting(true);
    setNotice(null);
    try {
      const res = await fetch(botUrl("/api/bot/announce/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ idea }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setText(data.text || "");
      setNotice("✨ Brouillon généré — RELIS-LE avant d'envoyer (l'IA peut se tromper).");
    } catch (e: any) {
      setNotice(`❌ Brouillon impossible : ${e?.message || "erreur IA"}`);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!text.trim() || !selected.size) return;
    if (job?.status === "running") {
      setNotice("⏳ Une annonce est déjà en cours — attends la fin.");
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch(botUrl("/api/bot/announce"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text, targets: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setNotice(
        `📢 Annonce lancée vers ${data.total} destinataire(s) — envoi progressif (~3-8 s par message).` +
          (data.skippedOptOut ? ` ${data.skippedOptOut} opt-out ignoré(s).` : "")
      );
      setText("");
      await loadStatus();
    } catch (e: any) {
      setNotice(`❌ ${e?.message || "envoi impossible"}`);
    } finally {
      setSending(false);
    }
  };

  const progress = job ? Math.round(((job.sentCount + job.failures.length) / Math.max(1, job.targets.length)) * 100) : 0;

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs text-rose-300 font-medium">
          ❌ {error} — le moteur doit être connecté.
        </div>
      )}
      {notice && (
        <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl text-xs text-amber-300 font-medium">
          {notice}
        </div>
      )}

      {/* Progression en direct */}
      {job && job.status === "running" && (
        <div className="bg-[#0b0b0c] border border-amber-500/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
              Envoi en cours…
            </div>
            <span className="text-xs text-zinc-400 tabular-nums">
              {job.sentCount + job.failures.length}/{job.targets.length} envoyés
            </span>
          </div>
          <div className="h-2 bg-black border border-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[11px] text-zinc-500">
            Envoi progressif anti-ban (~3-8 s par message) — garde cet onglet ouvert, tu peux continuer à utiliser le bot.
          </p>
        </div>
      )}

      {/* Rédaction */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-white">Rédiger l'annonce</h3>
          <span className="ml-auto text-[11px] text-zinc-500 tabular-nums">{text.length}/4000</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 4000))}
          rows={5}
          placeholder="Le texte de ton annonce… (WhatsApp, emojis bienvenus)"
          className="w-full px-3.5 py-2.5 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 resize-none"
        />

        {/* Brouillon IA */}
        <div className="p-4 bg-black border border-white/10 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-300">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Brouillon IA — décris ton idée, l'IA rédige, tu relis
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="text"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && idea.trim()) void draft();
              }}
              placeholder="Ex. maintenance du bot samedi soir, nouvelle commande .tiktok dispo…"
              className="flex-1 px-3.5 py-2 bg-[#0b0b0c] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={() => void draft()}
              disabled={drafting || !idea.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-bold text-xs rounded-xl transition flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {drafting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Générer
            </button>
          </div>
        </div>
      </div>

      {/* Destinataires */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Utilisateurs */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-white">Utilisateurs</h4>
            <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">
              {selectedUsers.length} sélectionné(s) / {eligibleUsers.length}
              {optOutCount ? ` · ${optOutCount} 🔕` : ""}
            </span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => selectSegment("all")}
              className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 text-[11px] font-bold transition cursor-pointer"
            >
              Tout sélectionner
            </button>
            <button
              onClick={() => selectSegment("active7d")}
              className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 text-[11px] font-bold transition cursor-pointer"
            >
              Actifs 7 j
            </button>
            <button
              onClick={() => setSelected(new Set(selectedGroups))}
              className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 text-[11px] font-bold transition cursor-pointer"
            >
              Tout désélectionner
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer…"
              className="w-full pl-8 pr-3 py-2 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-800">
            {filteredUsers.slice(0, 100).map((u) => (
              <label
                key={u.jid}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.03] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.jid)}
                  onChange={() => toggle(u.jid)}
                  className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs text-white truncate flex-1">{u.name || "Sans nom"}</span>
                <span className="text-[10px] font-mono text-zinc-500">+{u.jid.split("@")[0]}</span>
              </label>
            ))}
            {!filteredUsers.length && (
              <p className="text-[11px] text-zinc-500 p-3">
                {eligibleUsers.length ? "Aucun utilisateur ne correspond au filtre." : "Personne n'a encore écrit au bot."}
              </p>
            )}
            {optOutCount > 0 && (
              <p className="text-[10px] text-zinc-500 px-3">
                {optOutCount} utilisateur(s) ont refusé les annonces — exclus du ciblage (bouton 🔕 dans Utilisateurs pour rétablir).
              </p>
            )}
            {filteredUsers.length > 100 && (
              <p className="text-[10px] text-zinc-500 px-3 pt-1">{filteredUsers.length - 100} de plus — affiné le filtre.</p>
            )}
          </div>
        </div>

        {/* Groupes */}
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <UsersRound className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-white">Groupes</h4>
            <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">
              {selectedGroups.length} sélectionné(s) / {groups.length}
            </span>
          </div>
          <div className="max-h-[380px] overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-800">
            {groups.map((g) => (
              <label
                key={g.jid}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.03] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(g.jid)}
                  onChange={() => toggle(g.jid)}
                  className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs text-white truncate flex-1">
                  {g.name || "Groupe sans nom"}
                  {g.memberCount ? <span className="text-zinc-500"> · {g.memberCount} membres</span> : null}
                </span>
              </label>
            ))}
            {!groups.length && (
              <p className="text-[11px] text-zinc-500 p-3">Aucun groupe connu — le bot découvre les groupes à leur premier message.</p>
            )}
          </div>
        </div>
      </div>

      {/* Envoi */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-zinc-300 font-bold">
            {selected.size} destinataire(s) au total ({selectedUsers.length} utilisateur(s) + {selectedGroups.length} groupe(s))
          </div>
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Envoi progressif anti-ban : ~1 message toutes les 3-8 s ({Math.ceil((selected.size * 5.5) / 60)} min estimées).
          </p>
        </div>
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim() || !selected.size || job?.status === "running"}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-extrabold text-sm rounded-xl transition flex items-center gap-2 cursor-pointer whitespace-nowrap"
        >
          {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Envoyer l'annonce
        </button>
      </div>

      {/* Historique */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h4 className="text-sm font-bold text-white">Historique</h4>
          <button
            onClick={() => void loadStatus()}
            className="ml-auto p-1.5 rounded-lg text-zinc-500 hover:text-white transition cursor-pointer"
            title="Rafraîchir"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {!history.length ? (
          <p className="text-[11px] text-zinc-500">Aucune annonce envoyée pour l'instant.</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 10).map((h) => (
              <div key={h.id} className="flex items-start gap-3 px-3 py-2.5 bg-black border border-white/10 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-200 truncate">{h.text.slice(0, 120)}{h.text.length > 120 ? "…" : ""}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {formatDate(h.at)} · {h.sent}/{h.total} envoyés
                    {h.failed ? <span className="text-rose-400"> · {h.failed} échec(s)</span> : <span className="text-emerald-400"> · ✓</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
