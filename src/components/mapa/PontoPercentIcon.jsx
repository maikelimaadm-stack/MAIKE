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
    <div className="relative h-[74px] w-[74px] flex items-center justify-center isolate">
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
          backgroundColor: "#fde8d8",
        }}
      >
        <div
          className="absolute inset-x-0 bottom-0 transition-all duration-300"
          style={{ height: `${nivel}%`, backgroundColor: "#f4b183" }}
        />
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none mix-blend-multiply">
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="h-[68px] w-[68px] object-contain"
        />
      </div>

      <div className="absolute inset-x-0 top-[43%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none">
        {nivel}%
      </div>
    </div>
  );
}