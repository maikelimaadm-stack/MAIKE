import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  const isCocho =
    String(label || "").toLowerCase().includes("cocho");

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
    <div className="relative h-[74px] w-[74px] flex items-center justify-center">

      {/* percentual */}
      <span className="absolute left-0 top-0 z-20 rounded bg-white/90 px-1 py-0.5 text-[10px] font-bold text-slate-700 shadow-sm">
        {nivel}%
      </span>

      {isCocho && (
        <svg
          viewBox="0 0 500 500"
          className="absolute h-[68px] w-[68px]"
        >
          <defs>
            <clipPath id="cochoClip">
              <polygon points="80,140 420,140 360,220 140,220" />
            </clipPath>
          </defs>

          {/* fundo do cocho */}
          <polygon
            points="80,140 420,140 360,220 140,220"
            fill="#fde8d8"
          />

          {/* nível da ração */}
          <rect
            x="80"
            width="340"
            y={220 - (80 * nivel / 100)}
            height={(80 * nivel) / 100}
            fill="#f4b183"
            clipPath="url(#cochoClip)"
          />
        </svg>
      )}

      {/* imagem */}
      <img
        src={`${imageUrl}?v=${Date.now()}`}
        alt={label || "icone"}
        className="absolute h-[68px] w-[68px] object-contain pointer-events-none"
      />

    </div>
  );
}