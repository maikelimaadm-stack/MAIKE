import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  if (!imageUrl) {
    return (
      <div className="relative h-[74px] w-[74px] flex items-center justify-center text-[10px] font-bold text-slate-700">
        <span className="absolute left-0 top-0 z-20 rounded bg-white/90 px-1 py-0.5 text-[10px] leading-none shadow-sm">
          {nivel}%
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center isolate">
      
      {/* Percentual */}
      <span className="absolute left-0 top-0 z-20 rounded bg-white/90 px-1 py-0.5 text-[10px] font-bold leading-none text-slate-700 shadow-sm">
        {nivel}%
      </span>

      {/* área mascarada pelo próprio ícone */}
      <div
        className="relative h-[68px] w-[68px] overflow-hidden"
        style={{
          WebkitMaskImage: `url(${imageUrl})`,
          maskImage: `url(${imageUrl})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          backgroundColor: "#fde8d8"
        }}
      >
        {/* nível da ração */}
        <div
          className="absolute inset-x-0 bottom-0 transition-all duration-300"
          style={{
            height: `${nivel}%`,
            backgroundColor: "#f4b183"
          }}
        />
      </div>

      {/* imagem real do sub ícone */}
      <img
        src={imageUrl}
        alt={label || "Ícone"}
        className="absolute inset-0 m-auto h-[68px] w-[68px] object-contain pointer-events-none"
      />
    </div>
  );
}