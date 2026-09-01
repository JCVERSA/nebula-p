import React from "react";

interface DotGridPanelProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export default function DotGridPanel({ children, className = "", id }: DotGridPanelProps) {
  return (
    <div
      id={id}
      className={`relative rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 sm:p-6 transition-all duration-200 ${className}`}
      style={{
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    >
      <span className="pointer-events-none absolute left-3 top-3 h-3 w-3 border-l-2 border-t-2 border-white/50" />
      <span className="pointer-events-none absolute right-3 top-3 h-3 w-3 border-r-2 border-t-2 border-white/50" />
      <span className="pointer-events-none absolute bottom-3 left-3 h-3 w-3 border-b-2 border-l-2 border-white/50" />
      <span className="pointer-events-none absolute bottom-3 right-3 h-3 w-3 border-b-2 border-r-2 border-white/50" />
      {children}
    </div>
  );
}
