import { FC } from "react";

interface SpeedLoaderProps {
  color?: string;
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
}

export const SpeedLoader: FC<SpeedLoaderProps> = ({
  color = "#f59e0b",
  size = "md",
  text,
  className = "",
}) => {
  const scale = size === "sm" ? 0.6 : size === "lg" ? 1.2 : 0.85;

  return (
    <div className={`flex flex-col items-center justify-center p-4 ${className}`}>
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          width: `${180 * scale}px`,
          height: `${70 * scale}px`,
          // @ts-expect-error custom CSS variable
          "--speeder-color": color,
        }}
      >
        <div
          className="speed-loader-wrapper absolute"
          style={{ transform: `scale(${scale})` }}
        >
          <div className="speeder-body">
            <span>
              <span />
              <span />
              <span />
              <span />
            </span>
            <div className="speeder-base">
              <span />
              <div className="speeder-face" />
            </div>
          </div>
          <div className="speeder-longfazers">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      {text && (
        <p className="mt-2 text-xs font-mono font-medium tracking-wide text-zinc-400 animate-pulse text-center">
          {text}
        </p>
      )}
    </div>
  );
};

export default SpeedLoader;
