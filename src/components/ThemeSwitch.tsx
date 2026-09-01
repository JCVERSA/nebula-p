import { FC } from "react";

interface ThemeSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  subLabel?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({
  checked,
  onChange,
  label,
  subLabel,
  size = "md",
  disabled = false,
}) => {
  const sizePx = size === "sm" ? "12px" : size === "lg" ? "18px" : "15px";

  return (
    <label className={`inline-flex items-center gap-3 cursor-pointer select-none ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="theme-checkbox shrink-0"
        style={{ "--toggle-size": sizePx } as React.CSSProperties}
      />
      {(label || subLabel) && (
        <div className="flex flex-col">
          {label && <span className="text-xs font-semibold text-zinc-200">{label}</span>}
          {subLabel && <span className="text-[11px] text-zinc-400">{subLabel}</span>}
        </div>
      )}
    </label>
  );
};

export default ThemeSwitch;
