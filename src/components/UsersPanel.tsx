import { useCallback, useEffect, useRef, useState } from "react";
import {
  Users,
  RefreshCw,
  Search,
  Ban,
  ShieldCheck,
  RotateCcw,
  MessageSquare,
  UserPlus,
  Activity,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  StickyNote,
  Info,
  Download,
  Megaphone,
  X,
} from "lucide-react";
import { useBotUrl } from "../lib/botContext";

/**
 * 9.16/9.17/9.18 — Gestionnaire d'utilisateurs (owner : niveau « complet »).
 *
 * Répertoire construit sur les interactions réelles. Actions : bannir
 * (motif + durée 1 h/24 h/7 j/permanent, auto-expiration), réhabiliter,
 * sourdine IA (commandes conservées), refus d'annonces, reset quotas,
 * DM rapide, note owner, limite IA personnalisée, actions groupées,
 * export CSV, fiche détail avec audit.
 *
 * 9.17 : recherche + segment + pagination côté serveur.
 * 9.18 (A) : les jids @lid s'affichent comme LID (avec numéro résolu si connu)
 * — jamais comme un faux numéro +1203…
 */

interface QuotaInfo {
  used: number;
  limit: number;
}

interface KnownUser {
  jid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  commandCount: number;
  lastCommand: string | null;
  banned: boolean;
  banReason?: string;
  bannedUntil?: number;
  note?: string;
  muted?: boolean;
  noAnnounce?: boolean;
  aiLimitOverride?: number;
  resolvedNumber?: string;
  isOwner?: boolean;
  quota?: { ai: QuotaInfo; web: QuotaInfo; asr: QuotaInfo };
}

interface KnownGroup {
  jid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  memberCount?: number;
}

type Segment = "all" | "active7d" | "new30d" | "banned";
type SortField = "lastSeen" | "firstSeen" | "messageCount" | "commandCount" | "name";

const PAGE_SIZE = 200;

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

function fullDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR");
}

/** Chip de quota, colorée à l'approche de la limite (honnêteté visuelle). */
function QuotaChip({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = limit > 0 ? used / limit : 0;
  const color = ratio >= 1 ? "text-rose-400" : ratio >= 0.8 ? "text-amber-400" : "text-zinc-400";
  return (
    <span className={`tabular-nums ${color}`} title={`${label} : ${used}/${limit}`}>
      {label} {used}/{limit}
    </span>
  );
}

interface UsersPanelProps {
  /** 9.18 (E) — pont vers Annonces : pré-sélectionner ces jids. */
  onAnnounceTo?: (jids: string[]) => void;
}

export default function UsersPanel({ onAnnounceTo }: UsersPanelProps) {
  const botUrl = useBotUrl();
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [groups, setGroups] = useState<KnownGroup[]>([]);
  const [counts, setCounts] = useState({ all: 0, active7d: 0, new30d: 0, banned: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [sortField, setSortField] = useState<SortField>("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [busyJid, setBusyJid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dmFor, setDmFor] = useState<string | null>(null);
  const [dmText, setDmText] = useState("");
  const [banFor, setBanFor] = useState<string | null>(null); // jid unique OU "__bulk"
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState<string>(""); // "" = permanent
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [detailJid, setDetailJid] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildParams = useCallback(
    (opts: { q?: string; seg?: Segment; off?: number; sort?: SortField; dir?: "asc" | "desc" } = {}) => {
      const params = new URLSearchParams({
        segment: opts.seg ?? segment,
        limit: String(PAGE_SIZE),
        offset: String(opts.off ?? 0),
        sort: opts.sort ?? sortField,
        sortDir: opts.dir ?? sortDir,
      });
      const q = (opts.q ?? search).trim();
      if (q) params.set("q", q);
      return params;
    },
    [search, segment, sortField, sortDir]
  );

  const load = useCallback(
    async (opts: { q?: string; seg?: Segment; off?: number; sort?: SortField; dir?: "asc" | "desc" } = {}) => {
      try {
        const res = await fetch(botUrl(`/api/bot/users?${buildParams(opts).toString()}`), { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
        setGroups(Array.isArray(data.groups) ? data.groups : []);
        setCounts(data.counts || { all: 0, active7d: 0, new30d: 0, banned: 0 });
        setTotal(typeof data.total === "number" ? data.total : 0);
        setError(null);
      } catch (e: any) {
        setError(e?.message || "impossible de charger le répertoire");
      } finally {
        setLoading(false);
      }
    },
    [botUrl, buildParams]
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => void load({ off: offset }), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offset]);

  const onSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load({ q: value, off: 0 }), 300);
  };

  const onSegment = (seg: Segment) => {
    setSegment(seg);
    setOffset(0);
    void load({ seg, off: 0 });
  };

  const onSort = (field: SortField) => {
    const dir: "asc" | "desc" = sortField === field && sortDir === "desc" ? "asc" : "desc";
    setSortField(field);
    setSortDir(dir);
    setOffset(0);
    void load({ sort: field, dir, off: 0 });
  };

  const act = useCallback(
    async (jid: string, action: string, extra: Record<string, unknown> = {}) => {
      setBusyJid(jid);
      setNotice(null);
      try {
        const res = await fetch(botUrl("/api/bot/users/action"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ jid, action, ...extra }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (action === "ban") setNotice(`🚫 Utilisateur banni${extra.hours ? ` pour ${extra.hours} h` : " (permanent)"} — ignoré par tout le bot.`);
        if (action === "unban") setNotice(`✅ Utilisateur réhabilité.`);
        if (action === "reset-quota") setNotice(`♻️ Quotas IA + web + vocal remis à zéro pour aujourd'hui.`);
        if (action === "dm") {
          setNotice(`📨 DM envoyé.`);
          setDmFor(null);
          setDmText("");
        }
        if (action === "note") {
          setNotice(extra.text ? `📝 Note enregistrée.` : `📝 Note effacée.`);
          setNoteFor(null);
          setNoteText("");
        }
        if (action === "mute") setNotice(`🔇 Sourdine IA activée — les commandes restent accessibles.`);
        if (action === "unmute") setNotice(`🔊 Sourdine IA levée.`);
        if (action === "optout") setNotice(`🔕 Cet utilisateur ne recevra plus les annonces.`);
        if (action === "optin") setNotice(`🔔 Cet utilisateur accepte à nouveau les annonces.`);
        if (action === "set-ai-limit") setNotice(extra.limit ? `🎯 Limite IA quotidienne : ${extra.limit}.` : `🎯 Limite IA globale rétablie.`);
        await load({ off: offset });
      } catch (e: any) {
        setNotice(`❌ ${e?.message || "action impossible"}`);
      } finally {
        setBusyJid(null);
        setBanFor(null);
        setBanReason("");
        setBanHours("");
      }
    },
    [botUrl, load, offset]
  );

  const actBulk = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const jids = [...selected];
      if (!jids.length) return;
      setBusyJid("__bulk");
      setNotice(null);
      try {
        const res = await fetch(botUrl("/api/bot/users/action-bulk"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ jids, action, ...extra }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        setNotice(
          `✅ Action appliquée à ${data.applied} utilisateur(s)` +
            (data.skippedOwner ? ` — ${data.skippedOwner} owner ignoré(s)` : "") +
            (data.notFound ? ` — ${data.notFound} inconnu(s)` : "")
        );
        setSelected(new Set());
        setBanFor(null);
        setBanReason("");
        setBanHours("");
        await load({ off: offset });
      } catch (e: any) {
        setNotice(`❌ ${e?.message || "action groupée impossible"}`);
      } finally {
        setBusyJid(null);
      }
    },
    [botUrl, load, offset, selected]
  );

  const toggleSelect = (jid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const allVisibleSelected = users.length > 0 && users.every((u) => selected.has(u.jid));

  const submitBan = (target: string) => {
    const hours = banHours ? Number(banHours) : undefined;
    if (target === "__bulk") void actBulk("ban", { reason: banReason, hours });
    else void act(target, "ban", { reason: banReason, hours });
  };

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const SortHeader = ({ field, label, right }: { field: SortField; label: string; right?: boolean }) => (
    <th className={`px-4 py-3 font-bold ${right ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 cursor-pointer hover:text-white transition ${sortField === field ? "text-amber-400" : ""}`}
      >
        {label}
        {sortField === field && (sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* En-tête statistiques */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Users className="w-4 h-4 text-amber-400" /> Utilisateurs connus
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{counts.all}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Chaque personne qui a écrit au bot au moins une fois.</p>
        </div>
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Activity className="w-4 h-4 text-emerald-400" /> Actifs (7 j)
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{counts.active7d}</div>
          <p className="text-[11px] text-zinc-500 mt-1">{groups.length} groupe(s) connu(s) — visibles dans Annonces.</p>
        </div>
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Ban className="w-4 h-4 text-rose-400" /> Bannis
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{counts.banned}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Un banni est ignoré par tout le moteur.</p>
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-[#0b0b0c] border border-white/10 rounded-2xl p-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher un numéro ou un nom…"
            className="w-full pl-9 pr-3 py-2 bg-black border border-white/10 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {([
            ["all", "Tous"],
            ["active7d", "Actifs 7 j"],
            ["new30d", "Nouveaux 30 j"],
            ["banned", "Bannis"],
          ] as Array<[Segment, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onSegment(id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                segment === id
                  ? "bg-amber-500 text-black"
                  : "bg-black border border-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
          <a
            href={botUrl(`/api/bot/users/export?${buildParams().toString()}`)}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-black border border-white/10 text-zinc-400 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
            title="Exporter la liste filtrée en CSV"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <button
            onClick={() => void load({ off: offset })}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-black border border-white/10 text-zinc-400 hover:text-white transition cursor-pointer flex items-center gap-1.5"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Barre d'actions groupées */}
      {selected.size > 0 && (
        <div className="bg-amber-950/20 border border-amber-800/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-bold text-amber-300">{selected.size} utilisateur(s) sélectionné(s)</span>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => void actBulk("unban")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-400 text-[11px] font-bold hover:bg-emerald-900/50 transition cursor-pointer disabled:opacity-40">
                <ShieldCheck className="w-3.5 h-3.5 inline mr-1" /> Réhabiliter
              </button>
              <button onClick={() => void actBulk("reset-quota")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 text-[11px] font-bold transition cursor-pointer disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5 inline mr-1" /> Reset quotas
              </button>
              <button onClick={() => void actBulk("mute")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 text-[11px] font-bold transition cursor-pointer disabled:opacity-40">
                <VolumeX className="w-3.5 h-3.5 inline mr-1" /> Muet IA
              </button>
              <button onClick={() => void actBulk("unmute")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 text-[11px] font-bold transition cursor-pointer disabled:opacity-40">
                <Volume2 className="w-3.5 h-3.5 inline mr-1" /> Sonne
              </button>
              <button onClick={() => void actBulk("optout")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 text-[11px] font-bold transition cursor-pointer disabled:opacity-40">
                <BellOff className="w-3.5 h-3.5 inline mr-1" /> Pas d'annonces
              </button>
              <button onClick={() => setBanFor("__bulk")} disabled={busyJid === "__bulk"} className="px-2.5 py-1.5 rounded-lg bg-rose-950/50 border border-rose-900/60 text-rose-400 text-[11px] font-bold hover:bg-rose-900/50 transition cursor-pointer disabled:opacity-40">
                <Ban className="w-3.5 h-3.5 inline mr-1" /> Bannir…
              </button>
              {onAnnounceTo && (
                <button
                  onClick={() => onAnnounceTo([...selected])}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-bold transition cursor-pointer"
                >
                  <Megaphone className="w-3.5 h-3.5 inline mr-1" /> Annoncer à la sélection
                </button>
              )}
              <button onClick={() => setSelected(new Set())} className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-500 hover:text-white text-[11px] font-bold transition cursor-pointer">
                <X className="w-3.5 h-3.5 inline mr-1" /> Désélectionner
              </button>
            </div>
          </div>
          {banFor === "__bulk" && (
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-zinc-400 font-bold">Motif (optionnel, tracé dans l'audit)</label>
                <input
                  type="text"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Ex. spam de commandes"
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400 font-bold">Durée</label>
                <select
                  value={banHours}
                  onChange={(e) => setBanHours(e.target.value)}
                  className="px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400 cursor-pointer"
                >
                  <option value="">Permanent</option>
                  <option value="1">1 heure</option>
                  <option value="24">24 heures</option>
                  <option value="168">7 jours</option>
                </select>
              </div>
              <button
                onClick={() => submitBan("__bulk")}
                disabled={busyJid === "__bulk"}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                Bannir {selected.size} utilisateur(s)
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs text-rose-300 font-medium">
          ❌ {error} — le moteur doit être connecté pour remplir le répertoire.
        </div>
      )}
      {notice && (
        <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl text-xs text-amber-300 font-medium">
          {notice}
        </div>
      )}

      {/* Tableau */}
      <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl overflow-hidden">
        {loading && !users.length ? (
          <div className="p-8 text-center text-xs text-zinc-500">Chargement du répertoire…</div>
        ) : !users.length ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            {counts.all
              ? "Aucun utilisateur ne correspond à ce filtre."
              : "Personne n'a encore écrit au bot — le répertoire se remplit dès le premier message."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-white/10 text-left">
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setSelected(
                          allVisibleSelected
                            ? new Set()
                            : new Set(users.filter((u) => !u.isOwner).map((u) => u.jid))
                        )
                      }
                      className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                      title="Tout sélectionner (owner exclu)"
                    />
                  </th>
                  <SortHeader field="name" label="Utilisateur" />
                  <th className="px-4 py-3 font-bold">Numéro</th>
                  <SortHeader field="lastSeen" label="Dernière activité" />
                  <SortHeader field="messageCount" label="Messages" right />
                  <SortHeader field="commandCount" label="Commandes" right />
                  <th className="px-4 py-3 font-bold">Quotas (aujourd'hui)</th>
                  <th className="px-4 py-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isLid = u.jid.endsWith("@lid");
                  const banRemaining = u.bannedUntil ? u.bannedUntil - Date.now() : 0;
                  return (
                    <tr
                      key={u.jid}
                      className={`border-b border-white/5 hover:bg-white/[0.02] ${u.banned ? "opacity-60" : ""} ${selected.has(u.jid) ? "bg-amber-500/[0.04]" : ""}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(u.jid)}
                          onChange={() => toggleSelect(u.jid)}
                          disabled={!!u.isOwner}
                          className="accent-amber-500 w-3.5 h-3.5 cursor-pointer disabled:opacity-30"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white truncate max-w-[150px]">{u.name || "Sans nom"}</span>
                          {u.isOwner && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold" title="Le propriétaire ne peut pas être banni">
                              👑 OWNER
                            </span>
                          )}
                          {u.banned && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/60 text-rose-300 text-[10px] font-bold"
                              title={u.banReason ? `Motif : ${u.banReason}` : "Banni (aucun motif)"}
                            >
                              BANNI{u.bannedUntil ? ` · ${banRemaining > 3600_000 ? `${Math.ceil(banRemaining / 3600_000)} h` : `${Math.max(1, Math.ceil(banRemaining / 60_000))} min`}` : " · permanent"}
                            </span>
                          )}
                          {u.muted && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-900/60 text-indigo-300 text-[10px] font-bold" title="Sourdine IA — commandes conservées">
                              🔇 IA
                            </span>
                          )}
                          {u.noAnnounce && (
                            <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-400 text-[10px] font-bold" title="Refuse les annonces">
                              🔕
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-500">
                          1er contact {relTime(u.firstSeen)}
                          {u.note ? ` · 📝 ${u.note.slice(0, 40)}${u.note.length > 40 ? "…" : ""}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isLid ? (
                          <div className="flex flex-col">
                            <span className="font-mono text-zinc-400" title="Identifiant LID (numéro masqué par WhatsApp)">
                              LID {u.jid.split("@")[0].slice(0, 8)}…
                            </span>
                            {u.resolvedNumber ? (
                              <span className="font-mono text-emerald-400 text-[11px]" title="Numéro réel résolu via la table Baileys">
                                → +{u.resolvedNumber}
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">numéro masqué</span>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-zinc-300">+{u.jid.split("@")[0]}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{relTime(u.lastSeen)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{u.messageCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{u.commandCount}</td>
                      <td className="px-4 py-3">
                        {u.quota ? (
                          <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
                            <QuotaChip label="IA" used={u.quota.ai.used} limit={u.quota.ai.limit} />
                            <span className="text-zinc-500 tabular-nums">
                              Web <QuotaChip label="" used={u.quota.web.used} limit={u.quota.web.limit} /> · Vocal {u.quota.asr.used}/{u.quota.asr.limit}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => setDetailJid(u.jid)}
                            title="Fiche détail (quotas, audit, réglages)"
                            className="p-2 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setDmFor(dmFor === u.jid ? null : u.jid);
                              setDmText("");
                            }}
                            disabled={busyJid === u.jid}
                            title="Envoyer un DM"
                            className="p-2 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer disabled:opacity-40"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void act(u.jid, "reset-quota")}
                            disabled={busyJid === u.jid}
                            title="Réinitialiser les quotas du jour (IA, web, vocal)"
                            className="p-2 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer disabled:opacity-40"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void act(u.jid, u.muted ? "unmute" : "mute")}
                            disabled={busyJid === u.jid || !!u.isOwner}
                            title={u.muted ? "Lever la sourdine IA" : "Sourdine IA (commandes conservées)"}
                            className={`p-2 rounded-lg border transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                              u.muted
                                ? "bg-indigo-950/50 border-indigo-800/60 text-indigo-300"
                                : "bg-black border-white/10 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/40"
                            }`}
                          >
                            {u.muted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => void act(u.jid, u.noAnnounce ? "optin" : "optout")}
                            disabled={busyJid === u.jid}
                            title={u.noAnnounce ? "Réaccepter les annonces" : "Exclure des annonces (opt-out)"}
                            className={`p-2 rounded-lg border transition cursor-pointer disabled:opacity-40 ${
                              u.noAnnounce
                                ? "bg-zinc-900 border-white/20 text-zinc-300"
                                : "bg-black border-white/10 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {u.noAnnounce ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => {
                              setNoteFor(noteFor === u.jid ? null : u.jid);
                              setNoteText(u.note || "");
                            }}
                            disabled={busyJid === u.jid}
                            title="Note owner"
                            className={`p-2 rounded-lg border transition cursor-pointer disabled:opacity-40 ${
                              u.note ? "bg-amber-950/30 border-amber-800/40 text-amber-300" : "bg-black border-white/10 text-zinc-400 hover:text-amber-400"
                            }`}
                          >
                            <StickyNote className="w-3.5 h-3.5" />
                          </button>
                          {u.isOwner ? (
                            <button
                              disabled
                              title="Le propriétaire ne peut pas être banni"
                              className="p-2 rounded-lg bg-black border border-white/5 text-zinc-500 cursor-not-allowed"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          ) : u.banned ? (
                            <button
                              onClick={() => void act(u.jid, "unban")}
                              disabled={busyJid === u.jid}
                              title="Réhabiliter"
                              className="px-2.5 py-2 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-400 text-[11px] font-bold hover:bg-emerald-900/50 transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> Réhabiliter
                            </button>
                          ) : banFor === u.jid ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={banReason}
                                onChange={(e) => setBanReason(e.target.value)}
                                placeholder="Motif…"
                                className="w-28 px-2 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                              />
                              <select
                                value={banHours}
                                onChange={(e) => setBanHours(e.target.value)}
                                className="px-2 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white cursor-pointer focus:outline-none focus:border-amber-400"
                              >
                                <option value="">∞</option>
                                <option value="1">1 h</option>
                                <option value="24">24 h</option>
                                <option value="168">7 j</option>
                              </select>
                              <button
                                onClick={() => submitBan(u.jid)}
                                disabled={busyJid === u.jid}
                                className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold rounded-lg transition cursor-pointer disabled:opacity-40"
                              >
                                Confirmer
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setBanFor(u.jid)}
                              disabled={busyJid === u.jid}
                              title="Bannir (ignoré par tout le bot)"
                              className="p-2 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer disabled:opacity-40"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {dmFor === u.jid && (
                          <div className="mt-2 flex gap-2 justify-end">
                            <input
                              type="text"
                              value={dmText}
                              onChange={(e) => setDmText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && dmText.trim()) void act(u.jid, "dm", { text: dmText });
                              }}
                              placeholder="Ton message…"
                              autoFocus
                              className="flex-1 min-w-[180px] px-3 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                            />
                            <button
                              onClick={() => void act(u.jid, "dm", { text: dmText })}
                              disabled={!dmText.trim() || busyJid === u.jid}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-bold text-xs rounded-lg transition cursor-pointer"
                            >
                              Envoyer
                            </button>
                          </div>
                        )}
                        {noteFor === u.jid && (
                          <div className="mt-2 flex gap-2 justify-end">
                            <input
                              type="text"
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void act(u.jid, "note", { text: noteText });
                              }}
                              placeholder="Note pour toi-même…"
                              autoFocus
                              className="flex-1 min-w-[180px] px-3 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                            />
                            <button
                              onClick={() => void act(u.jid, "note", { text: noteText })}
                              disabled={busyJid === u.jid}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg transition cursor-pointer"
                            >
                              OK
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2.5 text-[11px] text-zinc-500 border-t border-white/10 flex items-center justify-between gap-2">
              <span>
                {users.length} affiché(s) sur {total}
                {segment === "banned" ? " (bannis)" : ""}
              </span>
              {(hasPrev || hasNext) && (
                <span className="flex items-center gap-1.5">
                  <button
                    disabled={!hasPrev}
                    onClick={() => {
                      const off = Math.max(0, offset - PAGE_SIZE);
                      setOffset(off);
                      void load({ off });
                    }}
                    className="p-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-white disabled:opacity-30 transition cursor-pointer"
                    title="Page précédente"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="tabular-nums">
                    {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
                  </span>
                  <button
                    disabled={!hasNext}
                    onClick={() => {
                      const off = offset + PAGE_SIZE;
                      setOffset(off);
                      void load({ off });
                    }}
                    className="p-1.5 rounded-lg bg-black border border-white/10 text-zinc-400 hover:text-white disabled:opacity-30 transition cursor-pointer"
                    title="Page suivante"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
        <UserPlus className="w-3.5 h-3.5" />
        Le répertoire ne liste que les personnes qui ont déjà interagi avec le bot — impossible d'énumérer tous tes contacts WhatsApp.
      </p>

      {/* Fiche détail (9.18 I) */}
      {detailJid && <UserDetailDrawer jid={detailJid} onClose={() => setDetailJid(null)} onChanged={() => void load({ off: offset })} />}
    </div>
  );
}

/** 9.18 (I) — drawer détail : identité, quotas, réglages, historique d'audit. */
function UserDetailDrawer({
  jid,
  onClose,
  onChanged,
}: {
  jid: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const botUrl = useBotUrl();
  const [data, setData] = useState<{
    user: KnownUser;
    quota: { ai: QuotaInfo; web: QuotaInfo; asr: QuotaInfo };
    audit: Array<{ at?: number; action?: string; detail?: string; actor?: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [limitText, setLimitText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(botUrl(`/api/bot/users/${encodeURIComponent(jid)}/detail`), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setNoteText(d.user?.note || "");
      setLimitText(d.user?.aiLimitOverride ? String(d.user.aiLimitOverride) : "");
      setError(null);
    } catch (e: any) {
      setError(e?.message || "fiche indisponible");
    }
  }, [botUrl, jid]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (action: string, extra: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(botUrl("/api/bot/users/action"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ jid, action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || `HTTP ${res.status}`);
      }
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.message || "action impossible");
    } finally {
      setBusy(false);
    }
  };

  const u = data?.user;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-[#0b0b0c] border-l border-white/10 overflow-y-auto p-5 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Fiche utilisateur</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-white transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs text-rose-300">❌ {error}</div>}
        {!data ? (
          <p className="text-xs text-zinc-500 p-4">Chargement…</p>
        ) : !u ? (
          <p className="text-xs text-zinc-500 p-4">Utilisateur inconnu.</p>
        ) : (
          <>
            {/* Identité */}
            <div className="space-y-1.5">
              <div className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                {u.name || "Sans nom"}
                {u.isOwner && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold">👑 OWNER</span>}
                {u.banned && <span className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/60 text-rose-300 text-[10px] font-bold">BANNI</span>}
                {u.muted && <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-900/60 text-indigo-300 text-[10px] font-bold">🔇 IA</span>}
                {u.noAnnounce && <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-400 text-[10px] font-bold">🔕 annonces</span>}
              </div>
              <p className="font-mono text-[11px] text-zinc-400 break-all">{u.jid}</p>
              {u.jid.endsWith("@lid") && (
                <p className="font-mono text-[11px] text-emerald-400">
                  {u.resolvedNumber ? `→ +${u.resolvedNumber} (résolu)` : "LID — numéro masqué par WhatsApp"}
                </p>
              )}
              <p className="text-[11px] text-zinc-500">
                1er contact : {fullDate(u.firstSeen)} · Dernier : {fullDate(u.lastSeen)}
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                {u.messageCount} messages · {u.commandCount} commandes · dernière : {u.lastCommand ? `.${u.lastCommand}` : "—"}
              </p>
              {u.banned && (
                <p className="text-[11px] text-rose-300">
                  {u.bannedUntil ? `Banni jusqu'à ${fullDate(u.bannedUntil)}` : "Banni en permanence"}
                  {u.banReason ? ` — motif : ${u.banReason}` : ""}
                </p>
              )}
            </div>

            {/* Quotas */}
            <div className="bg-black border border-white/10 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-zinc-300">Quotas du jour</h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  ["IA", data.quota.ai],
                  ["Web", data.quota.web],
                  ["Vocal", data.quota.asr],
                ] as Array<[string, QuotaInfo]>).map(([label, q]) => (
                  <div key={label} className="bg-[#0b0b0c] border border-white/10 rounded-lg py-2">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">{label}</div>
                    <div className={`text-sm font-bold tabular-nums ${q.used >= q.limit ? "text-rose-400" : q.used >= q.limit * 0.8 ? "text-amber-400" : "text-white"}`}>
                      {q.used}/{q.limit}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void save("reset-quota", {})}
                disabled={busy}
                className="w-full px-3 py-2 bg-black border border-white/10 text-zinc-300 hover:text-amber-400 text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-40"
              >
                ♻️ Réinitialiser les quotas du jour
              </button>
            </div>

            {/* Note */}
            <div className="bg-black border border-white/10 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-zinc-300">📝 Note owner</h4>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value.slice(0, 300))}
                rows={2}
                placeholder="Ex. c'est mon frère — limiter l'IA à 20/jour…"
                className="w-full px-3 py-2 bg-[#0b0b0c] border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 tabular-nums">{noteText.length}/300</span>
                <button
                  onClick={() => void save("note", { text: noteText })}
                  disabled={busy}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg transition cursor-pointer disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            </div>

            {/* Limite IA personnalisée */}
            <div className="bg-black border border-white/10 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-zinc-300">🎯 Limite IA quotidienne personnalisée</h4>
              <p className="text-[11px] text-zinc-500">Vide = limite globale. Entre 1 et 500 requêtes/jour.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={limitText}
                  onChange={(e) => setLimitText(e.target.value)}
                  placeholder="globale"
                  className="flex-1 px-3 py-2 bg-[#0b0b0c] border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                />
                <button
                  onClick={() => void save("set-ai-limit", { limit: limitText === "" ? null : Number(limitText) })}
                  disabled={busy}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg transition cursor-pointer disabled:opacity-40"
                >
                  Appliquer
                </button>
              </div>
            </div>

            {/* Historique d'actions */}
            <div className="bg-black border border-white/10 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-zinc-300">🗂 Historique d'actions (audit)</h4>
              {!data.audit.length ? (
                <p className="text-[11px] text-zinc-500">Aucune action enregistrée pour cet utilisateur.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {data.audit.map((e, i) => (
                    <div key={i} className="text-[11px] text-zinc-400 border-b border-white/5 pb-1.5">
                      <span className="font-mono text-zinc-500">{e.at ? fullDate(e.at) : ""}</span>{" "}
                      <span className="font-bold text-zinc-300">{e.action}</span>
                      {e.detail ? <span> — {e.detail}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
