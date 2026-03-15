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

  const maskStyle = {
    WebkitMaskImage: `url(${imageUrl})`,
    maskImage: `url(${imageUrl})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center isolate">
      <div className="relative h-[68px] w-[68px]">
        <div
          className="absolute inset-0"
          style={{
            ...maskStyle,
            backgroundColor: "#fde8d8",
          }}
        />
        <div
          className="absolute inset-0 transition-all duration-300"
          style={{
            ...maskStyle,
            backgroundColor: "#f4b183",
            clipPath: `inset(${100 - nivel}% 0 0 0)`,
          }}
        />
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="absolute inset-0 h-[68px] w-[68px] object-contain opacity-30 grayscale contrast-150 pointer-events-none"
        />
      </div>

      <div className="absolute inset-x-0 top-[43%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none">
        {nivel}%
      </div>
    </div>
  );
}