import React from "react";

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const isCocho = String(label || "").toLowerCase().includes("cocho") || String(imageUrl || "").includes("AgroCattle15");

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
      <span className="absolute left-0 top-0 z-20 rounded bg-white/90 px-1 py-0.5 text-[10px] font-bold leading-none text-slate-700 shadow-sm">
        {nivel}%
      </span>

      {isCocho ? (
        <>
          <div
            className="absolute left-1/2 top-[22px] -translate-x-1/2 w-[54px] h-[20px] overflow-hidden"
            style={{
              clipPath: "polygon(8% 0%, 92% 0%, 100% 35%, 90% 100%, 10% 100%, 0% 35%)",
              backgroundColor: "#fde8d8",
            }}
          >
            <div
              className="absolute inset-x-0 bottom-0 bg-[#f4b183] transition-all duration-300"
              style={{ height: `${Math.max(10, nivel)}%` }}
            />
          </div>
          <img
            src={imageUrl}
            alt={label || "Ícone"}
            className="absolute inset-0 m-auto h-[68px] w-[68px] object-contain pointer-events-none"
          />
        </>
      ) : (
        <>
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
              style={{
                height: `${nivel}%`,
                backgroundColor: "#f4b183",
              }}
            />
          </div>
          <img
            src={imageUrl}
            alt={label || "Ícone"}
            className="absolute inset-0 m-auto h-[68px] w-[68px] object-contain pointer-events-none mix-blend-multiply"
          />
        </>
      )}
    </div>
  );
}