import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useBotUrl } from "../lib/botContext";

/**
 * 9.16 — Gestionnaire d'utilisateurs (décision owner : niveau « complet »).
 *
 * Le répertoire se construit à l'usage : chaque personne qui écrit au bot
 * (ou participe activement dans un groupe du bot) apparaît ici avec son
 * activité. Actions : bannir/réhabiliter (un banni est ignoré par tout le
 * moteur — le propriétaire ne peut jamais l'être), réinitialiser les
 * quotas IA/web/vocal du jour, DM rapide.
 */

interface KnownUser {
  jid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  commandCount: number;
  lastCommand: string | null;
  banned: boolean;
  isOwner?: boolean; // 9.16b — calculé côté moteur (digits OWNER_NUMBER / LID reconnu)
}

interface KnownGroup {
  jid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
}

type Segment = "all" | "active7d" | "new30d" | "banned";

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export default function UsersPanel() {
  const botUrl = useBotUrl();
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [groups, setGroups] = useState<KnownGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [busyJid, setBusyJid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState<string | null>(null);
  const [dmFor, setDmFor] = useState<string | null>(null);
  const [dmText, setDmText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(botUrl("/api/bot/users"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "impossible de charger le répertoire");
    } finally {
      setLoading(false);
    }
  }, [botUrl]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (jid: string, action: string, text?: string) => {
      setBusyJid(jid);
      setNotice(null);
      try {
        const res = await fetch(botUrl("/api/bot/users/action"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ jid, action, text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (action === "ban") setNotice(`🚫 Utilisateur banni — il est ignoré par tout le bot.`);
        if (action === "unban") setNotice(`✅ Utilisateur réhabilité.`);
        if (action === "reset-quota") setNotice(`♻️ Quotas IA + web + vocal remis à zéro pour aujourd'hui.`);
        if (action === "dm") {
          setNotice(`📨 DM envoyé.`);
          setDmFor(null);
          setDmText("");
        }
        await load();
      } catch (e: any) {
        setNotice(`❌ ${e?.message || "action impossible"}`);
      } finally {
        setBusyJid(null);
        setConfirmBan(null);
      }
    },
    [botUrl, load]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekAgo = Date.now() - 7 * 86400_000;
    const monthAgo = Date.now() - 30 * 86400_000;
    return users.filter((u) => {
      if (segment === "active7d" && u.lastSeen < weekAgo) return false;
      if (segment === "new30d" && u.firstSeen < monthAgo) return false;
      if (segment === "banned" && !u.banned) return false;
      if (segment !== "banned" && u.banned) return false;
      if (!q) return true;
      return (
        u.jid.toLowerCase().includes(q) ||
        (u.name || "").toLowerCase().includes(q)
      );
    });
  }, [users, search, segment]);

  const activeCount = users.filter((u) => u.lastSeen > Date.now() - 7 * 86400_000 && !u.banned).length;
  const bannedCount = users.filter((u) => u.banned).length;

  return (
    <div className="space-y-6">
      {/* En-tête statistiques */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Users className="w-4 h-4 text-amber-400" /> Utilisateurs connus
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{users.length}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Chaque personne qui a écrit au bot au moins une fois.</p>
        </div>
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Activity className="w-4 h-4 text-emerald-400" /> Actifs (7 j)
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{activeCount}</div>
          <p className="text-[11px] text-zinc-500 mt-1">{groups.length} groupe(s) connu(s) — visibles dans Annonces.</p>
        </div>
        <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Ban className="w-4 h-4 text-rose-400" /> Bannis
          </div>
          <div className="text-3xl font-extrabold text-white mt-2 tabular-nums">{bannedCount}</div>
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
            onChange={(e) => setSearch(e.target.value)}
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
              onClick={() => setSegment(id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                segment === id
                  ? "bg-amber-500 text-black"
                  : "bg-black border border-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => void load()}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-black border border-white/10 text-zinc-400 hover:text-white transition cursor-pointer flex items-center gap-1.5"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

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
        ) : !filtered.length ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            {users.length
              ? "Aucun utilisateur ne correspond à ce filtre."
              : "Personne n'a encore écrit au bot — le répertoire se remplit dès le premier message."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-white/10 text-left">
                  <th className="px-4 py-3 font-bold">Utilisateur</th>
                  <th className="px-4 py-3 font-bold">Numéro</th>
                  <th className="px-4 py-3 font-bold">Dernière activité</th>
                  <th className="px-4 py-3 font-bold text-right">Messages</th>
                  <th className="px-4 py-3 font-bold text-right">Commandes</th>
                  <th className="px-4 py-3 font-bold">Dernière cmd</th>
                  <th className="px-4 py-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((u) => (
                  <tr key={u.jid} className={`border-b border-white/5 hover:bg-white/[0.02] ${u.banned ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white truncate max-w-[160px]">{u.name || "Sans nom"}</span>
                        {u.isOwner && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold" title="Le propriétaire ne peut pas être banni">
                            👑 OWNER
                          </span>
                        )}
                        {u.banned && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/60 text-rose-300 text-[10px] font-bold">
                            BANNI
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-500">1er contact {relTime(u.firstSeen)}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300">+{u.jid.split("@")[0]}</td>
                    <td className="px-4 py-3 text-zinc-400">{relTime(u.lastSeen)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{u.messageCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{u.commandCount}</td>
                    <td className="px-4 py-3 font-mono text-zinc-500">{u.lastCommand ? `.${u.lastCommand}` : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
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
                        {u.isOwner ? (
                          <button
                            disabled
                            title="Le propriétaire ne peut pas être banni"
                            className="p-2 rounded-lg bg-black border border-white/5 text-zinc-600 cursor-not-allowed"
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
                        ) : confirmBan === u.jid ? (
                          <button
                            onClick={() => void act(u.jid, "ban")}
                            disabled={busyJid === u.jid}
                            className="px-2.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition cursor-pointer disabled:opacity-40"
                          >
                            Confirmer le ban ?
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmBan(u.jid)}
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
                              if (e.key === "Enter" && dmText.trim()) void act(u.jid, "dm", dmText);
                            }}
                            placeholder="Ton message…"
                            autoFocus
                            className="flex-1 min-w-[180px] px-3 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                          />
                          <button
                            onClick={() => void act(u.jid, "dm", dmText)}
                            disabled={!dmText.trim() || busyJid === u.jid}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-lg transition cursor-pointer"
                          >
                            Envoyer
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-2.5 text-[11px] text-zinc-500 border-t border-white/10">
                {filtered.length - 200} autre(s) utilisateur(s) — affiné ta recherche pour les voir.
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
        <UserPlus className="w-3.5 h-3.5" />
        Le répertoire ne liste que les personnes qui ont déjà interagi avec le bot — impossible d'énumérer tous tes contacts WhatsApp.
      </p>
    </div>
  );
}
