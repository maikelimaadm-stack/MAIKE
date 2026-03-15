import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  return (
    <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className="absolute inset-x-0 bottom-0 bg-slate-300/60 transition-all duration-300"
        style={{ height: `${nivel}%` }}
      />
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="absolute inset-0 m-auto h-10 w-10 object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-600">
          {label?.slice(0, 2) || "PT"}
        </div>
      )}
      <div className="absolute inset-x-0 top-[58%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700">
        {nivel}%
      </div>
    </div>
  );
}