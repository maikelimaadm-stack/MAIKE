import React, { useId } from "react";
import { COCHO_DESCOBERTO_FORMA as forma } from "@/assets/icones/cocho-descoberto";

/** O nível varia dentro do SVG escolhido para o modelo de cocho. */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho" }) {
  const clipId = `cocho-${useId().replace(/:/g, "")}`;
  const fracao = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0;
  const nivel = Math.round(fracao * 100);
  const topo = forma.limites.y + forma.strokeWidth / 2;
  const fundo = forma.limites.y + forma.limites.height - forma.strokeWidth / 2;
  const y = fundo - (fundo - topo) * fracao;
  const onda = Math.min(3, (fundo - y) / 2, (y - topo) / 2);
  const esquerda = forma.limites.x;
  const larguraOnda = forma.limites.width / 4;
  const direita = esquerda + forma.limites.width;
  const base = forma.limites.y + forma.limites.height + forma.strokeWidth;

  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${nivel}%`}>
      <svg viewBox={forma.viewBox} width={forma.width} height={forma.height} className="h-auto w-[156px] max-w-full" aria-hidden="true">
        <defs>
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
              d={`M${esquerda} ${y} Q${esquerda + larguraOnda / 2} ${y - onda * 2} ${esquerda + larguraOnda} ${y} T${esquerda + larguraOnda * 2} ${y} T${esquerda + larguraOnda * 3} ${y} T${direita} ${y} L${direita} ${base} H${esquerda}Z`}
              fill="#70d552"
            />
          </g>
        )}
        <path d={forma.corpo} fill="none" stroke={forma.stroke} strokeWidth={forma.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="text-xs font-semibold text-slate-700">{nivel}%</span>
    </div>
  );
}
