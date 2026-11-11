import React, { useId } from "react";
import { COCHO_DESCOBERTO_FORMA as forma, geometriaNivelCocho } from "@/assets/icones/cocho-descoberto";

/** O nível varia dentro do SVG escolhido para o modelo de cocho. */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho" }) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `cocho-${instanceId}`;
  const saltId = `sal-${instanceId}`;
  const { fracao, nivel, preenchimento } = geometriaNivelCocho(percent);

  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${nivel}%`}>
      <svg viewBox={forma.viewBox} width={forma.width} height={forma.height} className="h-auto w-[156px] max-w-full" aria-hidden="true">
        <defs>
          <pattern id={saltId} width="62" height="42" patternUnits="userSpaceOnUse">
            <rect width="62" height="42" fill="#d2d7db" />
            <circle cx="9" cy="10" r="2.6" fill="#a6afb6" />
            <circle cx="36" cy="27" r="2.4" fill="#a6afb6" />
            <circle cx="56" cy="9" r="2.2" fill="#a6afb6" />
            <circle cx="12" cy="34" r="2.5" fill="#a6afb6" />
          </pattern>
          <clipPath id={clipId}>
            <path d={forma.corpo} />
          </clipPath>
        </defs>
        {forma.pes.map((pe, index) => (
          <path key={index} d={pe.d} transform={pe.transform} fill={pe.fill} stroke={pe.stroke} strokeWidth={pe.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {fracao > 0 && (
          <g clipPath={`url(#${clipId})`}>
            <path
              data-cocho-nivel={nivel}
              d={preenchimento}
              fill={`url(#${saltId})`}
            />
          </g>
        )}
        <path d={forma.corpo} fill="none" stroke={forma.stroke} strokeWidth={forma.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="text-xs font-semibold text-slate-700">{nivel}%</span>
    </div>
  );
}
