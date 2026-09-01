import React, { useState, useMemo } from "react";
import {
  Globe,
  Monitor,
  Laptop,
  Smartphone,
  Sparkles,
  Check,
  Search,
  RotateCcw,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import { BROWSER_PRESETS, BrowserPreset } from "../lib/browserPresets";

interface BrowserIdentitySelectorProps {
  platform: string;
  browserName: string;
  version: string;
  onChange: (updates: {
    browserPlatform: string;
    browserName: string;
    browserVersion: string;
  }) => void;
  disabled?: boolean;
}

export const BrowserIdentitySelector: React.FC<BrowserIdentitySelectorProps> = ({
  platform,
  browserName,
  version,
  onChange,
  disabled = false,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showAdvancedEditor, setShowAdvancedEditor] = useState<boolean>(false);

  const categories = ["All", "Linux", "macOS", "Windows", "Mobile / Tablet", "Custom / Bot"];

  // Match current values to known presets
  const currentPreset = useMemo(() => {
    return BROWSER_PRESETS.find(
      (p) =>
        p.platform.toLowerCase() === (platform || "").toLowerCase() &&
        p.browser.toLowerCase() === (browserName || "").toLowerCase()
    );
  }, [platform, browserName]);

  const filteredPresets = useMemo(() => {
    return BROWSER_PRESETS.filter((preset) => {
      const matchesCat = activeCategory === "All" || preset.category === activeCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        preset.name.toLowerCase().includes(q) ||
        preset.platform.toLowerCase().includes(q) ||
        preset.browser.toLowerCase().includes(q) ||
        preset.category.toLowerCase().includes(q) ||
        preset.description.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  const applyPreset = (preset: BrowserPreset) => {
    onChange({
      browserPlatform: preset.platform,
      browserName: preset.browser,
      browserVersion: preset.version,
    });
  };

  const resetToDefault = () => {
    const defaultPreset = BROWSER_PRESETS.find((p) => p.id === "ubuntu-chrome") || BROWSER_PRESETS[0];
    applyPreset(defaultPreset);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "macOS":
      case "Windows":
        return <Laptop className="w-3.5 h-3.5" />;
      case "Linux":
        return <Monitor className="w-3.5 h-3.5" />;
      case "Mobile / Tablet":
        return <Smartphone className="w-3.5 h-3.5" />;
      default:
        return <Globe className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="space-y-4" id="browser-identity-selector">
      {/* Header & WhatsApp Mobile Linked Devices Preview */}
      <div className="p-4 bg-gradient-to-r from-amber-500/10 via-black/40 to-black/60 rounded-xl border border-amber-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                WhatsApp Linked Device Signature
              </h4>
              <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                24 Presets Available
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Customizes how your WhatsApp session appears on linked phones and in the Baileys multi-device handshake.
            </p>
          </div>
        </div>

        {/* Mock WhatsApp Linked Device display */}
        <div className="bg-[#121214] border border-white/10 rounded-lg px-3.5 py-2 flex items-center gap-3 shrink-0 shadow-inner">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="text-left">
            <div className="text-[11px] font-bold text-white flex items-center gap-1.5 font-mono">
              <span>{browserName || "Chrome"}</span>
              <span className="text-zinc-500 font-sans">({platform || "Ubuntu"})</span>
            </div>
            <div className="text-[9px] text-zinc-400 font-mono flex items-center gap-1">
              <span>Build v{version || "22.04.4"}</span>
              {currentPreset && (
                <span className="text-amber-400 font-sans font-semibold">· {currentPreset.name.split("·")[0].trim()}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                activeCategory === cat
                  ? "bg-amber-500 text-black shadow-sm font-bold"
                  : "bg-zinc-900/90 text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
              }`}
            >
              {cat === "All" ? <Sparkles className="w-3 h-3" /> : getCategoryIcon(cat)}
              <span>{cat}</span>
              {cat === "All" && (
                <span className="text-[9px] bg-black/40 text-amber-200 px-1.5 py-0.2 rounded-full">
                  {BROWSER_PRESETS.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search OS, browser, engine..."
              className="pl-8 pr-3 py-1.5 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 w-44 sm:w-48 transition"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedEditor(!showAdvancedEditor)}
            className={`p-2 rounded-lg border text-xs flex items-center gap-1.5 transition cursor-pointer ${
              showAdvancedEditor
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                : "bg-zinc-900 text-zinc-400 hover:text-white border-white/10"
            }`}
            title="Toggle Custom Parameter Editor"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Customise</span>
          </button>
        </div>
      </div>

      {/* Preset Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin">
        {filteredPresets.map((preset) => {
          const isSelected =
            (platform || "").toLowerCase() === preset.platform.toLowerCase() &&
            (browserName || "").toLowerCase() === preset.browser.toLowerCase();

          return (
            <div
              key={preset.id}
              onClick={() => !disabled && applyPreset(preset)}
              className={`p-3 rounded-xl border transition-all text-left flex flex-col justify-between relative cursor-pointer group ${
                isSelected
                  ? "bg-amber-500/10 border-amber-500/50 shadow-md ring-1 ring-amber-500/30"
                  : "bg-black/40 hover:bg-black/70 border-white/10 hover:border-white/20"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-400 group-hover:text-amber-400 transition">
                      {getCategoryIcon(preset.category)}
                    </span>
                    <span className="text-xs font-bold text-white truncate max-w-[170px]">
                      {preset.name}
                    </span>
                  </div>

                  {isSelected ? (
                    <span className="w-4 h-4 rounded-full bg-amber-400 text-black flex items-center justify-center shrink-0">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </span>
                  ) : preset.badge ? (
                    <span className="text-[9px] font-semibold bg-white/5 border border-white/10 text-amber-300/90 px-1.5 py-0.5 rounded-full shrink-0">
                      {preset.badge}
                    </span>
                  ) : null}
                </div>

                <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed mb-2.5">
                  {preset.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] font-mono text-zinc-400">
                <span className="truncate max-w-[130px] text-zinc-300">
                  {preset.platform} · {preset.browser}
                </span>
                <span className="text-amber-400/80 bg-black px-1.5 py-0.5 rounded border border-white/10 text-[9px]">
                  v{preset.version}
                </span>
              </div>
            </div>
          );
        })}

        {filteredPresets.length === 0 && (
          <div className="col-span-full py-8 text-center bg-black/30 rounded-xl border border-white/10 text-zinc-400">
            <p className="text-xs">No browser presets matched &ldquo;{searchQuery}&rdquo;</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("All");
              }}
              className="mt-2 text-xs text-amber-400 hover:underline font-bold"
            >
              Reset search filters
            </button>
          </div>
        )}
      </div>

      {/* Manual / Advanced Editable Inputs */}
      {showAdvancedEditor && (
        <div className="p-4 bg-black/60 rounded-xl border border-white/10 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-amber-400" />
              <h5 className="text-xs font-bold text-white">Manual Browser Identity Values</h5>
            </div>
            <button
              type="button"
              onClick={resetToDefault}
              className="text-[11px] text-zinc-400 hover:text-amber-300 flex items-center gap-1 transition cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Reset to Recommended (Ubuntu/Chrome)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
                <span>Platform / Operating System</span>
              </label>
              <input
                type="text"
                disabled={disabled}
                value={platform || ""}
                placeholder="e.g. Ubuntu, macOS, Windows"
                onChange={(e) =>
                  onChange({
                    browserPlatform: e.target.value,
                    browserName: browserName || "Chrome",
                    browserVersion: version || "22.04.4",
                  })
                }
                className="w-full px-3 py-2 border border-white/10 rounded-lg text-xs bg-black text-white focus:outline-none focus:border-amber-400 font-mono transition shadow-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
                <span>Client / Browser Name</span>
              </label>
              <input
                type="text"
                disabled={disabled}
                value={browserName || ""}
                placeholder="e.g. Chrome, Safari, Arc, Edge"
                onChange={(e) =>
                  onChange({
                    browserPlatform: platform || "Ubuntu",
                    browserName: e.target.value,
                    browserVersion: version || "22.04.4",
                  })
                }
                className="w-full px-3 py-2 border border-white/10 rounded-lg text-xs bg-black text-white focus:outline-none focus:border-amber-400 font-mono transition shadow-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
                <span>Browser Version String</span>
              </label>
              <input
                type="text"
                disabled={disabled}
                value={version || ""}
                placeholder="e.g. 22.04.4, 124.0, 17.4"
                onChange={(e) =>
                  onChange({
                    browserPlatform: platform || "Ubuntu",
                    browserName: browserName || "Chrome",
                    browserVersion: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-white/10 rounded-lg text-xs bg-black text-white focus:outline-none focus:border-amber-400 font-mono transition shadow-sm"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 pt-1 text-[10px] text-zinc-400">
            <Info className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
            <span>
              Values are packaged into a standard Baileys 3-tuple signature{" "}
              <code className="bg-black text-amber-300 px-1 py-0.2 rounded border border-white/10 font-mono">
                [&quot;{platform || "Ubuntu"}&quot;, &quot;{browserName || "Chrome"}&quot;, &quot;{version || "22.04.4"}&quot;]
              </code>
              . When you save settings, the next connection or pairing code request uses this signature.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
