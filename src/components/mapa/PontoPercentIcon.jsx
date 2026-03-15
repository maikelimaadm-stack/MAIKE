import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  if (!imageUrl) {
    return (
      <div className="relative h-16 w-16 flex items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm text-[10px] font-bold text-slate-700">
        {nivel}%
      </div>
    );
  }

  return (
    <div className="relative h-20 w-20 flex items-center justify-center isolate">
      <div
        className="relative h-16 w-16 overflow-hidden"
        style={{
          WebkitMaskImage: `url(${imageUrl})`,
          maskImage: `url(${imageUrl})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          backgroundColor: "#e2e8f0",
        }}
      >
        <div
          className="absolute inset-x-0 bottom-0 bg-slate-500 transition-all duration-300"
          style={{ height: `${nivel}%` }}
        />
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none mix-blend-multiply">
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="h-16 w-16 object-contain"
        />
      </div>

      <div className="absolute inset-x-0 top-[48%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none">
        {nivel}%
      </div>
    </div>
  );
}