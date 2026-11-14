import React from "react";
import { MESES, formatarGmd } from "@/services/curvaGanhoCadastroService";

const LARGURA = 360;
const ALTURA = 112;
const TOPO = 8;
const BASE_ROTULOS = 16;
const PASSO = LARGURA / MESES.length;
const BARRA = PASSO * 0.62;

/**
 * Gráfico de barras dos 12 GMD da curva (D-PROD-194), de janeiro a dezembro,
 * com a linha do zero: barra para cima é ganho, para baixo é perda de peso.
 * Mês sem valor válido fica sem barra. SVG puro, sem biblioteca.
 *
 * @param {{ valores: Array<number|null|undefined>, className?: string }} props
 */
export default function GraficoCurvaGanho({ valores, className }) {
  const numeros = valores.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const preenchidos = /** @type {number[]} */ (numeros.filter((v) => v !== null));
  if (preenchidos.length === 0) return null;

  const max = Math.max(0, ...preenchidos);
  const min = Math.min(0, ...preenchidos);
  const amplitude = max - min || 1;
  const alturaUtil = ALTURA - TOPO - BASE_ROTULOS;
  const y = (/** @type {number} */ v) => TOPO + ((max - v) / amplitude) * alturaUtil;
  const zero = y(0);

  const descricao = MESES.map((m, i) =>
    numeros[i] === null ? `${m.nome}: sem valor` : `${m.nome}: ${formatarGmd(numeros[i])} kg/dia`,
  ).join("; ");

  return (
    <svg
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      className={className}
      role="img"
      aria-label={`Curva de ganho por mês. ${descricao}`}
      data-testid="grafico-curva-ganho"
    >
      <line x1={0} x2={LARGURA} y1={zero} y2={zero} stroke="#B9B8B3" strokeWidth={1} />
      {MESES.map((m, i) => {
        const v = numeros[i];
        const x = i * PASSO + (PASSO - BARRA) / 2;
        const rotulo = (
          <text
            key={`r-${m.campo}`}
            x={i * PASSO + PASSO / 2}
            y={ALTURA - 4}
            textAnchor="middle"
            fontSize={10}
            fill="#73726C"
          >
            {m.curto}
          </text>
        );
        if (v === null) return rotulo;
        const topo = Math.min(y(v), zero);
        const altura = Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1);
        return (
          <React.Fragment key={m.campo}>
            <rect
              x={x}
              y={topo}
              width={BARRA}
              height={altura}
              rx={2}
              fill={v < 0 ? "#D97757" : "#16a34a"}
              data-testid={`barra-${m.campo}`}
            >
              <title>{`${m.nome}: ${formatarGmd(v)} kg/dia`}</title>
            </rect>
            {rotulo}
          </React.Fragment>
        );
      })}
    </svg>
  );
}
