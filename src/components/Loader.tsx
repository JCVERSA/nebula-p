import React from 'react';

interface LoaderProps {
  scale?: number;
  className?: string;
  text?: string;
}

const Loader: React.FC<LoaderProps> = ({ scale = 0.65, className = "", text }) => {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div
        className="box-shift-loader-wrapper relative"
        style={{
          width: 112 * scale,
          height: 112 * scale,
        }}
      >
        <div
          className="box-shift-loader absolute inset-0 origin-top-left"
          style={{
            width: 112,
            height: 112,
            transform: `scale(${scale})`,
          }}
        >
          <div className="box1" />
          <div className="box2" />
          <div className="box3" />
        </div>
      </div>
      {text && (
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider text-center animate-pulse">
          {text}
        </span>
      )}
    </div>
  );
};

export default Loader;
