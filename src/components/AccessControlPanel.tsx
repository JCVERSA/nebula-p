import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Save, Trash2 } from "lucide-react";

interface AccessPolicy {
  defaultTo: "allow" | "deny";
  adminAllow: string[];
  memberDeny: string[];
  memberAllow: string[];
}

interface AccessData {
  policies: Record<string, AccessPolicy>;
  commandIndex: Array<{ name: string; category: string }>;
}

const EMPTY_POLICY: AccessPolicy = {
  defaultTo: "allow",
  adminAllow: [],
  memberDeny: [],
  memberAllow: [],
};

export default function AccessControlPanel() {
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [draft, setDraft] = useState<AccessPolicy>({ ...EMPTY_POLICY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/bot/access", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AccessData;
      setData(json);
      const groups = Object.keys(json.policies || {});
      if (groups.length > 0) selectGroup(groups[0], json);
    } catch (e: any) {
      setError(e?.message || "Failed to load access policies.");
    } finally {
      setLoading(false);
    }
  };

  const selectGroup = (group: string, current?: AccessData) => {
    setSelected(group);
    const src = (current || data);
    const policy = src?.policies?.[group] || { ...EMPTY_POLICY };
    setDraft({
      defaultTo: policy.defaultTo || "allow",
      adminAllow: [...(policy.adminAllow || [])],
      memberDeny: [...(policy.memberDeny || [])],
      memberAllow: [...(policy.memberAllow || [])],
    });
    setMessage("");
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const splitEntries = (text: string) => text.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  const save = async () => {
    if (!selected.trim()) {
      setMessage("⚠️ Enter a group JID first.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/bot/access/${encodeURIComponent(selected)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMessage("✅ Policy saved.");
      await load();
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || "Failed to save policy."}`);
    } finally {
      setSaving(false);
    }
  };

  const removePolicy = async (group: string) => {
    if (!group) return;
    setMessage("");
    try {
      // Reset to defaults = remove the custom policy row.
      const res = await fetch(`/api/bot/access/${encodeURIComponent(group)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultTo: "allow", memberDeny: [], memberAllow: [], adminAllow: [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected("");
      setDraft({ ...EMPTY_POLICY });
      setMessage("✅ Policy reset to defaults.");
      await load();
    } catch (e: any) {
      setMessage(`⚠️ ${e?.message || "Failed to reset policy."}`);
    }
  };

  const groupCount = data ? Object.keys(data.policies).length : 0;
  const cmdCount = data?.commandIndex?.length || 0;

  return (
    <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-white/5 text-amber-400 border border-white/5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">RoleGuard — Command Access Control</h3>
            <p className="text-[10px] text-zinc-400">
              Declarative per-group ACL. Owner bypasses everything; admins get adminAllow overrides; members follow default + lists.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-zinc-300 transition flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Group policies</div>
          <div className="text-lg font-bold text-amber-400">{groupCount}</div>
        </div>
        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Commands indexed</div>
          <div className="text-lg font-bold text-zinc-200">{cmdCount}</div>
        </div>
      </div>

      {error && <div className="p-2.5 bg-rose-950/50 border border-rose-800/50 rounded-lg text-xs text-rose-300">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* left: policy list */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Configured groups</div>
          {data && Object.keys(data.policies).length === 0 && (
            <div className="p-3 bg-black/40 border border-white/5 rounded-xl text-xs text-zinc-500">
              No custom policies yet — every group uses the default (allow, no lists). Try the whatsapp-side <code>.access</code> command or edit below.
            </div>
          )}
          {data &&
            Object.entries(data.policies).map(([group, policy]) => (
              <div
                key={group}
                onClick={() => selectGroup(group)}
                className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition ${
                  selected === group ? "border-amber-500/60 bg-amber-500/5" : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-zinc-200 truncate">{group}</div>
                  <div className="text-[10px] text-zinc-400">
                    {policy.defaultTo === "deny" ? "🔒 Locked (default deny)" : "🔓 Open (default allow)"} · deny {policy.memberDeny.length} · allow {policy.memberAllow.length}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePolicy(group);
                  }}
                  title="Reset to defaults"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
        </div>

        {/* right: editor */}
        <div className="space-y-3">
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Policy editor</div>
          <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-2.5">
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Group JID (e.g. 1203630123@g.us)</label>
              <input
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                placeholder="1203630123@g.us"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>
            <div className="flex gap-2">
              {(["allow", "deny"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDraft({ ...draft, defaultTo: mode })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition cursor-pointer border ${
                    draft.defaultTo === mode
                      ? mode === "deny"
                        ? "bg-rose-600/20 border-rose-500/50 text-rose-300"
                        : "bg-emerald-600/20 border-emerald-500/50 text-emerald-300"
                      : "bg-white/5 border-white/10 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  {mode === "deny" ? "🔒 Locked (default deny)" : "🔓 Open (default allow)"}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Member deny (names/categories, comma or space separated)</label>
              <textarea
                value={draft.memberDeny.join(", ")}
                onChange={(e) => setDraft({ ...draft, memberDeny: splitEntries(e.target.value) })}
                rows={2}
                placeholder="kick, promote, download"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Member allow (wins over deny-default)</label>
              <textarea
                value={draft.memberAllow.join(", ")}
                onChange={(e) => setDraft({ ...draft, memberAllow: splitEntries(e.target.value) })}
                rows={2}
                placeholder="menu, help, info"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Admin allow (overrides member deny)</label>
              <textarea
                value={draft.adminAllow.join(", ")}
                onChange={(e) => setDraft({ ...draft, adminAllow: splitEntries(e.target.value) })}
                rows={2}
                placeholder="group, setmenuimage"
                className="w-full px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono resize-none"
              />
            </div>
            {message && <div className="p-2 bg-white/5 border border-white/5 rounded-lg text-xs text-amber-300">{message}</div>}
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Policy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
