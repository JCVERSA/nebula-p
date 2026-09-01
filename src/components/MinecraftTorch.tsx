import { FC } from "react";

interface MinecraftTorchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  subLabel?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}

export const MinecraftTorch: FC<MinecraftTorchProps> = ({
  checked,
  onChange,
  label = "Torch Engine Power",
  subLabel,
  size = "md",
  disabled = false,
}) => {
  const scale = size === "sm" ? 0.55 : size === "lg" ? 0.9 : 0.7;

  return (
    <div className="flex flex-col items-center select-none">
      <label className={`torch-container flex flex-col items-center relative cursor-pointer group ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="absolute opacity-0 cursor-pointer h-0 w-0"
        />
        
        <div
          className="torch-scaler"
          style={{ transform: `scale(${scale})`, height: `${160 * scale}px`, width: `${100 * scale}px` }}
        >
          <div className="torch">
            <div className="head">
              <div className="face top">
                <div />
                <div />
                <div />
                <div />
              </div>
              <div className="face left">
                <div />
                <div />
                <div />
                <div />
              </div>
              <div className="face right">
                <div />
                <div />
                <div />
                <div />
              </div>
            </div>
            <div className="stick">
              <div className="side side-left">
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
              </div>
              <div className="side side-right">
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
              </div>
            </div>
          </div>
        </div>

        {label && (
          <span className={`text-xs font-mono font-bold tracking-wider mt-1 transition-colors ${checked ? "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" : "text-zinc-500"}`}>
            {label}
          </span>
        )}
        {subLabel && (
          <span className="text-[10px] text-zinc-500 mt-0.5">{subLabel}</span>
        )}
      </label>
    </div>
  );
};

export default MinecraftTorch;
