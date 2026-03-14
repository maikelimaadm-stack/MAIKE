import React from "react";

function IconPreview({ src, size, alt }) {
  if (!src) return null;

  return (
    <div className="relative flex items-center justify-center rounded-full bg-white shadow-sm border border-slate-200" style={{ width: size, height: size }}>
      <img src={src} alt={alt} className="object-contain" style={{ width: size - 8, height: size - 8 }} />
    </div>
  );
}

export default function PontoStatusIcon({ iconUrl, subIconUrl, title, helperLabel }) {
  return (
    <div className="flex items-center gap-3">
      <IconPreview src={iconUrl} percent={percent} size={56} alt={title || "Ícone"} />
      <div className="flex flex-col gap-1">
        <IconPreview src={subIconUrl || iconUrl} percent={percent} size={34} alt={`${title || "Ícone"} secundário`} />
        {helperLabel && <span className="text-[10px] text-slate-500 max-w-28 leading-tight">{helperLabel}</span>}
      </div>
    </div>
  );
}