import { ReactNode } from "react";

export interface HeroChipProps {
  children: ReactNode;
  variant?: "solid" | "bordered" | "flat" | "dot";
  color?: "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
  onClose?: () => void;
  className?: string;
  classNames?: {
    base?: string;
    content?: string;
    dot?: string;
    closeButton?: string;
  };
}

export default function HeroChip({
  children,
  variant = "flat",
  color = "default",
  size = "md",
  onClose,
  className = "",
  classNames = {},
}: HeroChipProps) {
  // Styles based on HeroUI/NextUI design patterns
  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] h-5 gap-1",
    md: "px-2.5 py-1 text-xs h-6 gap-1.5",
    lg: "px-3 py-1 text-sm h-7 gap-2",
  };

  const colorVariants = {
    default: {
      solid: "bg-zinc-800 text-zinc-100 border-zinc-700",
      bordered: "bg-transparent text-zinc-300 border-zinc-700 border",
      flat: "bg-zinc-800/50 text-zinc-300 border-transparent",
      dot: "bg-transparent text-zinc-300 border-zinc-800 border",
    },
    primary: {
      solid: "bg-blue-600 text-white border-blue-500",
      bordered: "bg-transparent text-blue-400 border-blue-500/50 border",
      flat: "bg-blue-500/10 text-blue-400 border-transparent",
      dot: "bg-transparent text-blue-400 border-zinc-800 border",
    },
    secondary: {
      solid: "bg-purple-600 text-white border-purple-500",
      bordered: "bg-transparent text-purple-400 border-purple-500/50 border",
      flat: "bg-purple-500/10 text-purple-400 border-transparent",
      dot: "bg-transparent text-purple-400 border-zinc-800 border",
    },
    success: {
      solid: "bg-emerald-600 text-white border-emerald-500",
      bordered: "bg-transparent text-emerald-400 border-emerald-500/50 border",
      flat: "bg-emerald-500/10 text-emerald-400 border-transparent",
      dot: "bg-transparent text-emerald-400 border-zinc-800 border",
    },
    warning: {
      solid: "bg-amber-600 text-white border-amber-500",
      bordered: "bg-transparent text-amber-400 border-amber-500/50 border",
      flat: "bg-amber-500/10 text-amber-400 border-transparent",
      dot: "bg-transparent text-amber-400 border-zinc-800 border",
    },
    danger: {
      solid: "bg-rose-600 text-white border-rose-500",
      bordered: "bg-transparent text-rose-400 border-rose-500/50 border",
      flat: "bg-rose-500/10 text-rose-400 border-transparent",
      dot: "bg-transparent text-rose-400 border-zinc-800 border",
    },
  };

  const dotColors = {
    default: "bg-zinc-400",
    primary: "bg-blue-400",
    secondary: "bg-purple-400",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-rose-400",
  };

  const baseStyle = "inline-flex items-center justify-center font-semibold rounded-full select-none max-w-fit box-border transition-colors";
  const selectedColor = colorVariants[color]?.[variant] || colorVariants.default.flat;
  const sizeStyle = sizeClasses[size];

  return (
    <div
      className={`${baseStyle} ${sizeStyle} ${selectedColor} ${classNames.base || ""} ${className}`}
    >
      {variant === "dot" && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[color]} ${classNames.dot || ""}`}
        />
      )}
      <span className={`flex-1 truncate ${classNames.content || ""}`}>{children}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className={`opacity-65 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center rounded-full active:scale-95 ${classNames.closeButton || ""}`}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
