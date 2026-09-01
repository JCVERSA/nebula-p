import { useState } from "react";
import { Copy, Check } from "lucide-react";

export interface HeroSnippetProps {
  children: string;
  symbol?: string;
  size?: "sm" | "md" | "lg";
  color?: "default" | "primary" | "success" | "warning";
  className?: string;
}

export default function HeroSnippet({
  children,
  symbol = "$",
  size = "md",
  color = "default",
  className = "",
}: HeroSnippetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy failure
    }
  };

  const colorStyles = {
    default: "bg-[#18181b]/90 border border-white/5 text-zinc-300",
    primary: "bg-blue-500/10 border border-blue-500/20 text-blue-400",
    success: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400",
    warning: "bg-amber-500/10 border border-amber-500/20 text-amber-400",
  };

  const sizeStyles = {
    sm: "px-2.5 py-1 text-xs rounded-lg gap-2",
    md: "px-3.5 py-1.5 text-sm rounded-xl gap-3",
    lg: "px-4.5 py-2.5 text-base rounded-2xl gap-4",
  };

  return (
    <div
      className={`inline-flex items-center font-mono max-w-full overflow-x-auto justify-between select-none ${colorStyles[color]} ${sizeStyles[size]} ${className}`}
    >
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0">
        {symbol && <span className="text-zinc-500 select-none font-bold">{symbol}</span>}
        <span className="select-text whitespace-nowrap overflow-hidden text-ellipsis text-white font-medium">
          {children}
        </span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="text-zinc-400 hover:text-white transition-colors active:scale-95 duration-150 p-1 rounded hover:bg-white/5 cursor-pointer shrink-0"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
