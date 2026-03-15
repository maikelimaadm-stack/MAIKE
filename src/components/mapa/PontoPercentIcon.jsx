import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  if (!imageUrl) {
    return (
      <div className="relative h-[74px] w-[74px] flex items-center justify-center text-[10px] font-bold text-slate-700">
        <span className="absolute left-0 top-0 rounded bg-white/90 px-1 py-0.5 text-[10px] leading-none shadow-sm">
          {nivel}%
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center overflow-hidden isolate">
      <span className="absolute left-0 top-0 z-20 rounded bg-white/90 px-1 py-0.5 text-[10px] font-bold leading-none text-slate-700 shadow-sm">
        {nivel}%
      </span>

      <div
        className="absolute bottom-[8px] left-1/2 z-0 w-[58px] -translate-x-1/2 overflow-hidden"
        style={{ height: `${Math.max(8, nivel * 0.56)}px` }}
      >
        <div className="h-full w-full bg-[#f4b183] opacity-85" />
      </div>

      <img
        src={imageUrl}
        alt={label || "Ícone"}
        className="relative z-10 h-[68px] w-[68px] object-contain"
      />
    </div>
  );
}