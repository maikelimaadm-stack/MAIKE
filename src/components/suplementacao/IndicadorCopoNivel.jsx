import React from "react";

export default function IndicadorCopoNivel({ titulo, subtitulo, percent = 0, valor, cor = "#10b981" }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const clipId = `copo-${String(titulo || 'nivel').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-14 shrink-0">
          <svg viewBox="0 0 56 96" className="h-20 w-14">
            <path d="M12 8h32v10l-3 60c-.3 6-5.2 10-11.2 10H26.2C20.2 88 15.3 84 15 78L12 18V8Z" fill="#f8fafc" stroke="#64748b" strokeWidth="3" />
            <path d="M18 18h20l2.4 56c.2 4.1-3 7.6-7.1 7.6h-10.6c-4.1 0-7.3-3.5-7.1-7.6L18 18Z" fill="#e2e8f0" />
            <clipPath id={`copo-clip-${titulo || 'nivel'}`}>
              <path d="M18 18h20l2.4 56c.2 4.1-3 7.6-7.1 7.6h-10.6c-4.1 0-7.3-3.5-7.1-7.6L18 18Z" />
            </clipPath>
            <g clipPath={`url(#copo-clip-${titulo || 'nivel'})`}>
              <rect x="12" y={82 - (nivel * 0.64)} width="32" height="64" fill={cor} opacity="0.9" />
              <path d={`M12 ${82 - (nivel * 0.64) + 4} C20 ${79 - (nivel * 0.64)}, 36 ${87 - (nivel * 0.64)}, 44 ${82 - (nivel * 0.64) + 2} L44 90 L12 90 Z`} fill="#ffffff" opacity="0.25" />
            </g>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">{nivel}%</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500">{titulo}</div>
          <div className="text-sm font-bold text-slate-900">{valor}</div>
          {subtitulo && <div className="mt-1 text-[10px] leading-tight text-slate-500">{subtitulo}</div>}
        </div>
      </div>
    </div>
  );
}