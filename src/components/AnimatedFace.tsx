import { FC } from "react";

interface AnimatedFaceProps {
  color?: string;
  size?: number | string;
  className?: string;
  isThinking?: boolean;
}

export const AnimatedFace: FC<AnimatedFaceProps> = ({
  color = "#f59e0b",
  size = 140,
  className = "",
  isThinking = false,
}) => {
  const numericSize = typeof size === "number" ? size : size === "sm" ? 36 : size === "lg" ? 180 : 140;
  return (
    <div
      className={`animated-face-wrapper ${isThinking ? "animate-pulse" : ""} ${className}`}
      style={{ width: `${numericSize}px`, height: `${numericSize * 1.18}px` }}
    >
      <svg
        className="face"
        viewBox="0 0 320 380"
        style={{ width: "100%", height: "100%", color }}
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={24}
        >
          <g className="face__eyes" transform="translate(0,112.5)">
            <g transform="translate(15,0)">
              <polyline className="face__eye-lid" points="37,0 0,120 75,120" />
              <polyline
                className="face__pupil"
                points="55,120 55,155"
                strokeDasharray="35 35"
              />
            </g>
            <g transform="translate(230,0)">
              <polyline className="face__eye-lid" points="37,0 0,120 75,120" />
              <polyline
                className="face__pupil"
                points="55,120 55,155"
                strokeDasharray="35 35"
              />
            </g>
          </g>
          <rect
            className="face__nose"
            x="132.5"
            y="112.5"
            width={55}
            height={155}
            rx={4}
            ry={4}
          />
          <g transform="translate(65,334)" strokeDasharray="102 102">
            <path className="face__mouth-left" d="M 0 30 C 0 30 40 0 95 0" />
            <path className="face__mouth-right" d="M 95 0 C 150 0 190 30 190 30" />
          </g>
        </g>
      </svg>
    </div>
  );
};

export default AnimatedFace;
