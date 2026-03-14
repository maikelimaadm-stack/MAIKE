import React from "react";

export default function IndicadorCopoNivel({ titulo, subtitulo, percent = 0, valor, cor = "#10b981" }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const clipId = `copo-${String(titulo || 'nivel').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-16 shrink-0">
          <svg viewBox="0 0 64 96" className="h-20 w-16">
            <path d="M14 8h36v8l-2.5 60c-.2 7-5.8 12-12.8 12H29.3c-7 0-12.6-5-12.8-12L14 16V8Z" fill="#f8fafc" stroke="#64748b" strokeWidth="3" />
            <path d="M18 18h28v56c0 4.4-3.6 8-8 8H26c-4.4 0-8-3.6-8-8V18Z" fill="#e2e8f0" />
            <clipPath id={clipId}>
              <path d="M18 18h28v56c0 4.4-3.6 8-8 8H26c-4.4 0-8-3.6-8-8V18Z" />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <rect x="18" y={82 - (nivel * 0.64)} width="28" height="64" fill={cor} opacity="0.9" />
              <path d={`M18 ${82 - (nivel * 0.64) + 3} C25 ${79 - (nivel * 0.64)}, 39 ${86 - (nivel * 0.64)}, 46 ${82 - (nivel * 0.64) + 2} L46 90 L18 90 Z`} fill="#ffffff" opacity="0.22" />
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