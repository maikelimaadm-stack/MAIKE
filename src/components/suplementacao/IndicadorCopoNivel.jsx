import React from "react";

export default function IndicadorCopoNivel({ titulo, subtitulo, percent = 0, valor, cor = "#10b981", compact = false }) {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const clipId = `copo-${String(titulo || 'nivel').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${compact ? "p-2" : "p-3"}`}>
      <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
        <div className={`relative shrink-0 ${compact ? "h-14 w-11" : "h-20 w-16"}`}>
          <svg viewBox="0 0 64 96" className={`w-full ${compact ? "h-14" : "h-20"}`}>
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
          <div className={`absolute inset-0 flex items-center justify-center font-bold text-slate-700 ${compact ? "text-[8px]" : "text-[10px]"}`}>{nivel}%</div>
        </div>
        <div className="min-w-0">
          {titulo ? <div className="text-xs text-slate-500">{titulo}</div> : null}
          {valor ? <div className={`${compact ? "text-xs" : "text-sm"} font-bold text-slate-900`}>{valor}</div> : null}
          {subtitulo ? <div className="mt-1 text-[10px] leading-tight text-slate-500">{subtitulo}</div> : null}
        </div>
      </div>
    </div>
  );
}