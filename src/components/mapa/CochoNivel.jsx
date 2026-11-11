import React, { useId } from "react";

/** O recorte mantém o alimento dentro do cocho em qualquer nível. */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho" }) {
  const clipId = `cocho-${useId().replace(/:/g, "")}`;
  const fracao = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0;
  const nivel = Math.round(fracao * 100);
  const y = 151 - 119 * fracao;
  const onda = Math.min(4, (151 - y) / 2, (y - 32) / 2);
  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${nivel}%`}>
      <svg viewBox="96 96 408 236" className="h-[90px] w-[156px] max-w-full" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d="M132 32H468L446 143Q444 151 430 151H170Q156 151 154 143Z" />
          </clipPath>
        </defs>
        <g transform="translate(0 104)" stroke="#142026" strokeLinejoin="round" strokeLinecap="round">
          <path d="M162 166 144 216Q143 220 149 220H173Q179 220 181 213L203 167ZM397 167 419 213Q421 220 427 220H451Q457 220 456 216L438 166Z" fill="#fff" strokeWidth="8" />
          <path d="M122 0H478Q502 0 494 24L466 150Q462 168 439 170H161Q138 168 134 150L106 24Q98 0 122 0Z" fill="#fff" strokeWidth="9" />
          {fracao > 0 && (
            <g clipPath={`url(#${clipId})`} stroke="none">
              <path data-cocho-nivel={nivel} d={`M124 ${y} Q168 ${y - onda * 2} 212 ${y} T300 ${y} T388 ${y} T476 ${y} L480 160H124Z`} fill="#70d552" />
            </g>
          )}
          <path d="M132 32 154 143Q156 151 170 151H430Q444 151 446 143L468 32" strokeWidth="3" fill="none" />
          <path d="M120 0H480Q496 0 497 11Q498 21 480 21H120Q102 21 103 11Q104 0 120 0Z" fill="#fff" strokeWidth="7" />
        </g>
      </svg>
      <span className="text-xs font-semibold text-slate-700">{nivel}%</span>
    </div>
  );
}
