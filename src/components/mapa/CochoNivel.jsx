import React, { useId } from "react";
import { COCHO_DESCOBERTO_FORMA as forma, geometriaNivelCocho, COCHO_APARENCIA, envolverMarcadorSvg } from "@/assets/icones/cocho-descoberto";
import { ENCAIXE_FIGURA, REDONDO_ORIGINAL_SVG } from "@/assets/icones/pontos/redondo";

/**
 * Moldura do marcador do mapa (bolinha branca, borda, ponteira e sombra) sem
 * figura, como imagem: o modo `marcador` desenha o cocho por cima, no mesmo
 * encaixe (`ENCAIXE_FIGURA`) e no mesmo sistema de coordenadas da moldura.
 */
const MOLDURA = (() => {
  const viewBox = /viewBox="([^"]+)"/.exec(REDONDO_ORIGINAL_SVG)?.[1] ?? "0 0 100 100";
  const [x, y, largura, altura] = viewBox.trim().split(/\s+/).map(Number);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(envolverMarcadorSvg("", forma.viewBox))}`;
  return { viewBox, x, y, largura, altura, url };
})();

/**
 * O nível varia dentro do SVG escolhido para o modelo de cocho.
 *
 * `neutro` (D-PROD-178): não há estimativa (sem lançamento, sem %PV, período
 * fechado…). O SVG é o mesmo, sem preenchimento, e o texto mostra
 * `rotuloNeutro` no lugar de um "0%" que pareceria cocho vazio.
 *
 * `marcador` (D-PROD-220): o mesmo desenho do MARCADOR do mapa — moldura
 * redonda e as cores do mapa (`COCHO_APARENCIA.marcador`) — para o bloco de
 * nível do detalhe do cocho no desenho v12. O nível, o `role="img"`, o texto e
 * o `data-cocho-nivel` são os mesmos; sem a prop, nada muda (subícone de antes).
 *
 * @param {{ percent?: number, label?: string, neutro?: boolean, rotuloNeutro?: string, marcador?: boolean }} props
 */
export default function CochoNivel({ percent = 0, label = "Nível estimado do cocho", neutro = false, rotuloNeutro = "Sem estimativa", marcador = false }) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `cocho-${instanceId}`;
  const { fracao, nivel, preenchimento } = geometriaNivelCocho(neutro ? 0 : percent);
  const textoValor = neutro ? rotuloNeutro : `${nivel}%`;
  const aparencia = marcador ? COCHO_APARENCIA.marcador : COCHO_APARENCIA.subicone;

  const desenho = (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={forma.corpo} />
        </clipPath>
      </defs>
      {forma.pes.map((pe, index) => (
        <path key={index} d={pe.d} transform={pe.transform} fill={aparencia.cor} stroke={aparencia.cor} strokeWidth={pe.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {fracao > 0 && (
        <g clipPath={`url(#${clipId})`}>
          <path
            data-cocho-nivel={nivel}
            d={preenchimento}
            fill={aparencia.sal}
          />
        </g>
      )}
      <path d={forma.corpo} fill="none" stroke={aparencia.cor} strokeWidth={aparencia.espessura} strokeLinejoin="round" strokeLinecap="round" />
    </>
  );

  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${textoValor}`} data-cocho-neutro={neutro ? "" : undefined}>
      {marcador ? (
        <svg viewBox={MOLDURA.viewBox} width={MOLDURA.largura} height={MOLDURA.altura} aria-hidden="true" data-cocho-marcador="">
          <image href={MOLDURA.url} x={MOLDURA.x} y={MOLDURA.y} width={MOLDURA.largura} height={MOLDURA.altura} />
          <svg x={ENCAIXE_FIGURA.x} y={ENCAIXE_FIGURA.y} width={ENCAIXE_FIGURA.width} height={ENCAIXE_FIGURA.height} viewBox={forma.viewBox} preserveAspectRatio="xMidYMid meet">
            {desenho}
          </svg>
        </svg>
      ) : (
        <svg viewBox={forma.viewBox} width={forma.width} height={forma.height} className="h-auto w-[156px] max-w-full" aria-hidden="true">
          {desenho}
        </svg>
      )}
      <span className={neutro ? "text-xs font-medium text-slate-500" : "text-xs font-semibold text-slate-700"}>{textoValor}</span>
    </div>
  );
}
