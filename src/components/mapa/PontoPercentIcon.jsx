import React from "react";

const normalizeValue = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

function CochoPercentIcon({ imageUrl, label, nivel }) {
  const clipId = React.useMemo(() => `cocho-fill-${Math.random().toString(36).slice(2, 9)}`, []);
  const fillHeight = (340 * nivel) / 100;
  const fillY = 332 - fillHeight;

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center isolate">
      <svg viewBox="0 0 512 512" className="absolute h-[68px] w-[68px]" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d="M87 176 L163 112 H349 L425 176 L383 254 H129 Z" />
          </clipPath>
        </defs>
        <path d="M87 176 L163 112 H349 L425 176 L383 254 H129 Z" fill="#fde8d8" opacity="0.95" />
        <rect x="96" y={fillY} width="320" height={fillHeight} fill="#f4b183" clipPath={`url(#${clipId})`} />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <img
          src={imageUrl}
          alt={label || "Ícone"}
          className="h-[68px] w-[68px] object-contain"
        />
      </div>

      <div className="absolute inset-x-0 top-[43%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none z-20">
        {nivel}%
      </div>
    </div>
  );
}

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const normalizedLabel = normalizeValue(label);
  const normalizedUrl = normalizeValue(imageUrl);
  const isCochoIcon = normalizedLabel.includes("COCHO") || normalizedUrl.includes("AGROCATTLE14") || normalizedUrl.includes("COCHO");

  if (!imageUrl) {
    return (
      <div className="relative h-[74px] w-[74px] flex items-center justify-center text-[10px] font-bold text-slate-700">
        {nivel}%
      </div>
    );
  }

  if (isCochoIcon) {
    return <CochoPercentIcon imageUrl={imageUrl} label={label} nivel={nivel} />;
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