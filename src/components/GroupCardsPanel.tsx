import { useEffect, useState } from "react";
import { useBotUrl } from "../lib/botContext";
import { Images, RefreshCw, Save } from "lucide-react";

/**
 * 9.18pppp — Welcome/Goodbye cards par groupe (owner, dashboard).
 *
 * Un groupe → son propre couple welcome/goodbye : message texte
 * (gabarit + variables) ET card graphique (5 presets, aperçu réel rendu
 * par l'API). Tout est désactivé par défaut — jamais de surprise.
 */

interface CardConf {
  enabled: boolean;
  preset: string;
}

interface Conf {
  enabled: boolean;
  text: string;
  card: CardConf;
}

interface GroupCardsData {
  presets: Array<{ id: string; label: string; kind: "generative" | "image"; description: string }>;
  groups: Array<{ jid: string; name: string }>;
  configs: Record<string, { welcome: Conf; goodbye: Conf }>;
}

const EMPTY_CONF: Conf = { enabled: false, text: "", card: { enabled: false, preset: "nebula" } };

export default function GroupCardsPanel() {
  const botUrl = useBotUrl();
  const [data, setData] = useState<GroupCardsData | null>(null);
  const [selected, setSelected] = useState("");
  const [welcome, setWelcome] = useState<Conf>({ ...EMPTY_CONF });
  const [goodbye, setGoodbye] = useState<Conf>({ ...EMPTY_CONF });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(botUrl("/api/bot/group-cards"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GroupCardsData;
      setData(json);
      if (json.groups.length > 0) selectGroup(json.groups[0]!.jid, json);
    } catch (e: any) {
      setError(e?.message || "Failed to load group cards.");
    } finally {
      setLoading(false);
    }
  };

  const selectGroup = (jid: string, current?: GroupCardsData) => {
    setSelected(jid);
    const src = current || data;
    const conf = src?.configs?.[jid];
    setWelcome(conf ? { ...conf.welcome } : { ...EMPTY_CONF });
    setGoodbye(conf ? { ...conf.goodbye } : { ...EMPTY_CONF });
    setMessage("");
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!selected.trim()) {
      setMessage("⚠️ Choisis un groupe d'abord.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(botUrl(`/api/bot/group-cards/${encodeURIComponent(selected)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ welcome, goodbye }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMessage("✅ Enregistré — le prochain (dé)part utilisera cette config.");
    } catch (e: any) {
      setMessage(`❌ ${e?.message || "Save failed."}`);
    } finally {
      setSaving(false);
    }
  };

  const groupName = data?.groups.find(g => g.jid === selected)?.name || selected;

  const ConfBlock = ({
    title,
    kind,
    conf,
    setConf,
  }: {
    title: string;
    kind: "welcome" | "goodbye";
    conf: Conf;
    setConf: (c: Conf) => void;
  }) => (
    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-white">{title}</div>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={conf.enabled}
            onChange={e => setConf({ ...conf, enabled: e.target.checked })}
            className="accent-emerald-400 w-4 h-4"
          />
          Message texte
        </label>
      </div>
      <textarea
        value={conf.text}
        onChange={e => setConf({ ...conf, text: e.target.value })}
        rows={2}
        placeholder="Gabarit — variables : {user} {groupe} {count}"
        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-emerald-400/50"
      />
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-xs font-semibold text-zinc-300">🖼️ Card graphique</div>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={conf.card.enabled}
            onChange={e => setConf({ ...conf, card: { ...conf.card, enabled: e.target.checked } })}
            className="accent-emerald-400 w-4 h-4"
          />
          Activée
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data?.presets.map(preset => (
          <button
            key={preset.id}
            onClick={() => setConf({ ...conf, card: { enabled: true, preset: preset.id } })}
            title={preset.description}
            className={`rounded-xl border overflow-hidden text-left transition ${
              conf.card.preset === preset.id
                ? "border-emerald-400/70 ring-1 ring-emerald-400/40"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <img
              src={botUrl(
                `/api/bot/group-cards/preview/${preset.id}/${kind}?group=${encodeURIComponent(groupName.slice(0, 40))}`,
              )}
              alt={`Preset ${preset.label}`}
              loading="lazy"
              className="w-full aspect-[2.5/1] object-cover bg-black/40"
            />
            <div className="px-2 py-1.5 bg-black/50 flex items-center justify-between gap-1">
              <span className="text-[11px] font-semibold text-zinc-200">{preset.label}</span>
              {preset.kind === "image" && <span className="text-[9px] text-emerald-300/80 uppercase">owner</span>}
            </div>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500">
        Aperçus réels (rendus par le moteur). La card part en image, le gabarit texte en caption avec la vraie mention.
      </p>
    </div>
  );

  return (
    <div className="bg-[#0b0b0c] border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-white/5 text-emerald-300 border border-white/5">
            <Images className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Welcome / Goodbye Cards</h3>
            <p className="text-[11px] text-zinc-400">
              Un groupe, sa config : message texte + card graphique. Tout est désactivé par défaut.
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

      {error && <div className="p-2.5 bg-rose-950/50 border border-rose-800/50 rounded-lg text-xs text-rose-300">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={e => selectGroup(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-400/50"
        >
          {data && data.groups.length === 0 && <option value="">Aucun groupe connu (connecte le bot)</option>}
          {data?.groups.map(g => (
            <option key={g.jid} value={g.jid}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-zinc-500 font-mono truncate max-w-64">{selected}</span>
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={saving || !selected}
          className="px-4 py-2 bg-emerald-400/90 hover:bg-emerald-300 disabled:opacity-40 text-black rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {message && (
        <div
          className={`p-2.5 rounded-lg text-xs border ${
            message.startsWith("✅")
              ? "bg-emerald-950/50 border-emerald-800/50 text-emerald-300"
              : "bg-amber-950/50 border-amber-800/50 text-amber-300"
          }`}
        >
          {message}
        </div>
      )}

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ConfBlock title="👋 Welcome (arrivées)" kind="welcome" conf={welcome} setConf={setWelcome} />
          <ConfBlock title="👋 Goodbye (départs)" kind="goodbye" conf={goodbye} setConf={setGoodbye} />
        </div>
      )}

      {selected && (
        <p className="text-[10px] text-zinc-500">
          Commandes WhatsApp équivalentes (admins du groupe) : <code>.welcome card &lt;preset&gt;</code>,{" "}
          <code>.welcome card off</code> — idem <code>.goodbye</code>.
        </p>
      )}
    </div>
  );
}
