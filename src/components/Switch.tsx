import React from 'react';
import { motion } from "motion/react";

interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  size?: "sm" | "md" | "lg";
}

const Switch: React.FC<SwitchProps> = ({
  checked = false,
  onChange,
  disabled = false,
  id,
  name,
  size = "md",
}) => {
  const scaleClass =
    size === "sm"
      ? "text-[9px]"
      : size === "lg"
      ? "text-[14px]"
      : "text-[11px]";

  return (
    <motion.div 
      layout
      className="inline-block"
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
    >
      <label
        className={`cursor-pointer relative inline-block h-[2.8em] w-[5.4em] rounded-full bg-[hsl(0,0%,7%)] shadow-[0px_2px_4px_0px_rgb(18,18,18,0.25),0px_4px_8px_0px_rgb(18,18,18,0.35)] select-none transition-all ${scaleClass} ${
          disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
        }`}
      >
        {/* Outer subtle inner rim */}
        <span className="absolute inset-[0.05em] rounded-full border-[1px] border-[hsl(0,0%,20%)] pointer-events-none" />
        
        {/* Off indicator track */}
        <div className="absolute right-[0.6em] top-1/2 h-[0.3em] w-[1.4em] -translate-y-1/2 rounded-full bg-zinc-800 shadow-[inset_0px_1px_2px_rgba(0,0,0,0.5)]" />

        {/* Main interactive sliding thumb using spring physics */}
        <motion.div
          layout
          animate={{
            left: checked ? "calc(100% - 2.5em)" : "0.25em",
            backgroundColor: checked ? "var(--theme-primary, #f59e0b)" : "rgb(32,32,35)",
            boxShadow: checked
              ? "0 0 12px var(--theme-primary, #f59e0b), inset 1px 1px 2px rgba(255,255,255,0.4)"
              : "0 2px 4px rgba(0,0,0,0.4), inset 1px 1px 2px rgba(255,255,255,0.15)",
          }}
          transition={{
            type: "spring",
            stiffness: 450,
            damping: 24,
          }}
          className="absolute top-1/2 flex h-[2.25em] w-[2.25em] -translate-y-1/2 items-center justify-center rounded-full border border-white/10"
        >
          {/* Inner metal button core with elastic squish animation */}
          <motion.span 
            animate={{
              scale: checked ? [0.9, 1.1, 1] : 1,
            }}
            transition={{ duration: 0.3 }}
            className="relative h-[1.6em] w-[1.6em] rounded-full bg-gradient-to-b from-white/10 to-transparent flex items-center justify-center"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
          </motion.span>
        </motion.div>

        <input
          className="peer sr-only"
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
        />
      </label>
    </motion.div>
  );
};

export default Switch;
