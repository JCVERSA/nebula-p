import { ReactNode } from "react";

export interface HeroKbdProps {
  children: ReactNode;
  keys?: ("command" | "shift" | "ctrl" | "option" | "alt" | "enter" | "up" | "down" | "left" | "right")[];
  className?: string;
}

export default function HeroKbd({ children, keys = [], className = "" }: HeroKbdProps) {
  const keySymbols: Record<string, string> = {
    command: "⌘",
    shift: "⇧",
    ctrl: "⌃",
    option: "⌥",
    alt: "⎇",
    enter: "↵",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
  };

  return (
    <kbd
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-300 bg-[#161618] border border-white/10 rounded-md shadow-[0_2px_0_0_rgba(255,255,255,0.05),0_1px_1px_rgba(0,0,0,0.5)] select-none leading-none ${className}`}
    >
      {keys.map((k) => (
        <span key={k} className="text-[12px] opacity-75 font-sans leading-none">
          {keySymbols[k] || k}
        </span>
      ))}
      <span className="leading-none pt-0.5">{children}</span>
    </kbd>
  );
}
