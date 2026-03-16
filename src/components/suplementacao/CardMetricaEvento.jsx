import React from "react";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { formatDecimal, formatKg } from "./formatters";
import { safeDivide } from "../utils/pecuariaUtils";

/**
 * Card de métricas de um evento de suplementação, organizado em seções lógicas:
 * FORNECIMENTO → DADOS DO LOTE → CONSUMO ESPERADO → CONSUMO REAL → PROJEÇÃO
 *
 * Props:
 *  - evento: objeto SuplementacaoEvento
 *  - consumoEsperadoDiaKg: consumo esperado do grupo/dia (usado no Detalhes do Ponto)
 *  - sacos: quantidade em sacos (opcional)
 *  - showProjecao: se mostra seção de projeção (default true)
 *  - duracaoEstimada: dias de duração estimada (opcional, para detalhes)
 *  - proximaReposicao: string data formatada (opcional, para detalhes)
 */
export default function CardMetricaEvento({
  evento,
  consumoEsperadoDiaKg,
  sacos,
  showProjecao = true,
  duracaoEstimada,
  proximaReposicao,
}) {
  if (!evento) return null;

  const periodoFechado = (evento.dias_periodo || 0) > 0;
  const cabecas = evento.total_cabecas_afetadas || 0;
  const pesoMedio = evento.peso_medio_lotes_kg || 0;
  const consumoEsperadoPV = consumoEsperadoDiaKg || evento.consumo_esperado_pv_kg || 0;
  const consumoEsperadoCabDia = consumoEsperadoPV > 0 && cabecas > 0 ? consumoEsperadoPV / cabecas : 0;

  // Consumo real (só quando período fechado)
  const consumoDiarioGrupo = evento.consumo_diario_grupo_kg || 0;
  const consumoCabDiaReal = cabecas > 0 ? safeDivide(consumoDiarioGrupo, cabecas) : 0;

  // Duração / projeção
  const fornecido = Number(evento.quantidade_total_kg || 0);
  const sobra = Number(evento.sobra_kg || 0);
  const totalDisp = fornecido + sobra;
  const duracaoCalc = duracaoEstimada != null
    ? duracaoEstimada
    : consumoEsperadoPV > 0
      ? Math.round(totalDisp / consumoEsperadoPV)
      : 0;

  const fmtNum = (v, decimals = 2) =>
    v > 0
      ? v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : "-";

  const fmtNum3 = (v) =>
    v > 0
      ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg"
      : "-";

  return (
    <div className="space-y-1.5">
      {/* FORNECIMENTO */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <MetricCell label="Quantidade kg" value={formatKg(fornecido)} />
          <MetricCell label="Quantidade sacos" value={sacos != null ? fmtNum(sacos) : "-"} />
          <MetricCell label="Sobra" value={formatKg(sobra)} />
        </div>
      </div>

      {/* DADOS DO LOTE */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Dados do Lote</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <MetricCell label="Qtd. Cabeças" value={formatDecimal(cabecas, 0, true)} />
          <MetricCell label="Peso médio" value={pesoMedio > 0 ? `${formatDecimal(pesoMedio, 0)} kg` : "-"} />
        </div>
      </div>

      {/* CONSUMO ESPERADO */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Esperado</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <MetricCell label="Consumo Lote PV/dia" value={consumoEsperadoPV > 0 ? formatKg(consumoEsperadoPV) : "-"} />
          <MetricCell label="Esperado/cab/dia" value={fmtNum3(consumoEsperadoCabDia)} />
        </div>
      </div>

      {/* CONSUMO REAL */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Real</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <MetricCell label="Realizado cab/dia" value={periodoFechado && consumoCabDiaReal > 0 ? fmtNum3(consumoCabDiaReal) : "-"} />
          <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
            <div className="text-slate-500">Desvio</div>
            <div className="font-semibold text-slate-900 flex items-center gap-1">
              {periodoFechado && consumoCabDiaReal > 0 && consumoEsperadoCabDia > 0 ? (
                <DesvioConsumoTag real={consumoCabDiaReal} esperado={consumoEsperadoCabDia} />
              ) : "-"}
            </div>
          </div>
        </div>
      </div>

      {/* PROJEÇÃO */}
      {showProjecao && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Projeção</div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <MetricCell label="Fechamento" value={periodoFechado ? `${evento.dias_periodo} dia(s)` : "Em aberto"} />
            <MetricCell label="Duração estimada" value={duracaoCalc > 0 ? `${duracaoCalc} dia(s)` : "-"} />
            <MetricCell label="Próx. reposição" value={proximaReposicao || "-"} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}