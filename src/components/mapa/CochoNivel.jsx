import React, { useId } from "react";
import { COCHO_DESCOBERTO_FORMA as forma, geometriaNivelCocho, COCHO_APARENCIA } from "@/assets/icones/cocho-descoberto";

/**
 * O nível varia dentro do SVG escolhido para o modelo de cocho.
 *
 * `neutro` (D-PROD-178): não há estimativa (sem lançamento, sem %PV, período
 * fechado…). O SVG é o mesmo, sem preenchimento, e o texto mostra
 * `rotuloNeutro` no lugar de um "0%" que pareceria cocho vazio.
 *
 * @param {{ percent?: number, label?: string, neutro?: boolean, rotuloNeutro?: string }} props
 */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho", neutro = false, rotuloNeutro = "Sem estimativa" }) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `cocho-${instanceId}`;
  const { fracao, nivel, preenchimento } = geometriaNivelCocho(neutro ? 0 : percent);
  const textoValor = neutro ? rotuloNeutro : `${nivel}%`;

  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${textoValor}`} data-cocho-neutro={neutro ? "" : undefined}>
      <svg viewBox={forma.viewBox} width={forma.width} height={forma.height} className="h-auto w-[156px] max-w-full" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d={forma.corpo} />
          </clipPath>
        </defs>
        {forma.pes.map((pe, index) => (
          <path key={index} d={pe.d} transform={pe.transform} fill={COCHO_APARENCIA.subicone.cor} stroke={COCHO_APARENCIA.subicone.cor} strokeWidth={pe.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {fracao > 0 && (
          <g clipPath={`url(#${clipId})`}>
            <path
              data-cocho-nivel={nivel}
              d={preenchimento}
              fill={COCHO_APARENCIA.subicone.sal}
            />
          </g>
        )}
        <path d={forma.corpo} fill="none" stroke={COCHO_APARENCIA.subicone.cor} strokeWidth={COCHO_APARENCIA.subicone.espessura} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className={neutro ? "text-xs font-medium text-slate-500" : "text-xs font-semibold text-slate-700"}>{textoValor}</span>
    </div>
  );
}
