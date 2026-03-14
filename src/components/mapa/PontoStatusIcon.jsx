import React from "react";

function IconPreview({ src, size, alt }) {
  if (!src) return null;

  return (
    <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm" style={{ width: size, height: size }}>
      <img src={src} alt={alt} className="object-contain" style={{ width: size - 10, height: size - 10 }} />
    </div>
  );
}

export default function PontoStatusIcon({ iconUrl, title, helperLabel }) {
  return (
    <div className="flex items-center gap-3">
      <IconPreview src={iconUrl} size={48} alt={title || "Ícone"} />
      {helperLabel && <span className="text-[10px] text-slate-500 max-w-28 leading-tight">{helperLabel}</span>}
    </div>
  );
}