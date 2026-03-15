import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  if (!imageUrl) {
    return (
      <div className="relative h-[74px] w-[74px] flex items-center justify-center text-[10px] font-bold text-slate-700">
        {nivel}%
      </div>
    );
  }

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center">
      <div className="relative h-[68px] w-[68px] overflow-hidden">
        <div className="absolute inset-0 bg-[#fde8d8]" />
        <div
          className="absolute inset-x-0 bottom-0 bg-[#f4b183] transition-all duration-300"
          style={{ height: `${nivel}%` }}
        />
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="absolute inset-0 h-[68px] w-[68px] object-contain mix-blend-multiply"
        />
      </div>
      <div className="absolute inset-x-0 top-[43%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none">
        {nivel}%
      </div>
    </div>
  );
}