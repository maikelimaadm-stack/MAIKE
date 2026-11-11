import React, { useId } from "react";
import { COCHO_DESCOBERTO_FORMA as forma } from "@/assets/icones/cocho-descoberto";

/** O nível varia dentro do SVG escolhido para o modelo de cocho. */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho" }) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `cocho-${instanceId}`;
  const saltId = `sal-${instanceId}`;
  const fracao = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0;
  const nivel = Math.round(fracao * 100);
  const amplitudeMaxima = Math.min(8, forma.limites.width * 0.035);
  const topo = forma.limites.y + forma.strokeWidth / 2 + amplitudeMaxima;
  const fundo = forma.limites.y + forma.limites.height - forma.strokeWidth / 2;
  const y = fundo - (fundo - topo) * fracao;
  const onda = Math.min(amplitudeMaxima, (fundo - y) * 0.4);
  const esquerda = forma.limites.x;
  const larguraOnda = forma.limites.width / 6;
  const direita = esquerda + forma.limites.width;
  const base = forma.limites.y + forma.limites.height + forma.strokeWidth;

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
              d={`M${esquerda} ${y} Q${esquerda + larguraOnda / 2} ${y - onda * 2} ${esquerda + larguraOnda} ${y} T${esquerda + larguraOnda * 2} ${y} T${esquerda + larguraOnda * 3} ${y} T${esquerda + larguraOnda * 4} ${y} T${esquerda + larguraOnda * 5} ${y} T${direita} ${y} L${direita} ${base} H${esquerda}Z`}
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
