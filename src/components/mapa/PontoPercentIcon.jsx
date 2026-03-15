import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  return (
    <div className="flex items-end gap-3 min-h-[90px]">
      <div className="relative h-[68px] w-[68px] shrink-0 flex items-center justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={label || "icone"}
            className="h-[68px] w-[68px] object-contain pointer-events-none"
          />
        ) : (
          <div className="h-[68px] w-[68px] rounded border border-slate-200 bg-slate-50" />
        )}
      </div>

      <div className="flex flex-col items-center justify-end h-[90px] shrink-0">
        <span className="text-[10px] font-bold leading-none text-slate-900 mb-1">
          {nivel}%
        </span>
        <div className="relative h-[72px] w-[14px] rounded-full bg-slate-200 overflow-hidden">
          <div
            className="absolute inset-x-0 bottom-0 rounded-full bg-lime-400 transition-all duration-300"
            style={{ height: `${nivel}%` }}
          />
        </div>
      </div>
    </div>
  );
}