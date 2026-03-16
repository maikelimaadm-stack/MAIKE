import React from "react";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { formatDecimal, formatKg } from "./formatters";
import { safeDivide } from "../utils/pecuariaUtils";
import { kgParaSacos } from "./unidadeConversaoUtils";

/**
 * Card de métricas de um evento de suplementação, organizado em seções lógicas:
 * FORNECIMENTO → DADOS DO LOTE → CONSUMO ESPERADO → CONSUMO REAL (só fechado) → PROJEÇÃO
 *
 * Props:
 *  - evento: objeto SuplementacaoEvento
 *  - consumoEsperadoDiaKg: consumo esperado do grupo/dia (externo, ex: DetalhesPonto)
 *  - sacos: quantidade em sacos (opcional, se não passado calcula via produto)
 *  - produto: objeto Produto (opcional, para calcular sacos)
 *  - showProjecao: se mostra seção de projeção (default true)
 *  - duracaoEstimada: dias de duração estimada (opcional)
 *  - proximaReposicao: string data formatada (opcional, para aberto)
 */
export default function CardMetricaEvento({
  evento,
  consumoEsperadoDiaKg,
  sacos,
  produto,
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

  const fornecido = Number(evento.quantidade_total_kg || 0);
  const sobra = Number(evento.sobra_kg || 0);
  const totalDisp = fornecido + sobra;

  // Sacos: usar prop ou calcular via produto
  const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
  const sacosCalc = sacos != null ? sacos : (pesoPorSaco > 0 ? kgParaSacos(fornecido, pesoPorSaco) : null);

  // Duração estimada
  const duracaoCalc = duracaoEstimada != null
    ? duracaoEstimada
    : consumoEsperadoPV > 0
      ? Math.round(totalDisp / consumoEsperadoPV)
      : 0;

  // Diferença dias (fechado): estimado - realizado
  const diferencaDias = periodoFechado && duracaoCalc > 0 && evento.dias_periodo > 0
    ? duracaoCalc - evento.dias_periodo
    : null;

  const fmtNum3 = (v) =>
    v > 0
      ? v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg"
      : "-";

  const fmtSacos = (v) =>
    v != null && v > 0
      ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "-";

  return (
    <div className="space-y-1.5">
      {/* FORNECIMENTO */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fornecimento</div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <MetricCell label="Quantidade kg" value={formatKg(fornecido)} />
          <MetricCell label="Quantidade sacos" value={fmtSacos(sacosCalc)} />
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

      {/* CONSUMO REAL - só quando período está fechado */}
      {periodoFechado && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Real</div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <MetricCell label="Realizado cab/dia" value={consumoCabDiaReal > 0 ? fmtNum3(consumoCabDiaReal) : "-"} />
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Desvio</div>
              <div className="font-semibold text-slate-900 flex items-center gap-1">
                {consumoCabDiaReal > 0 && consumoEsperadoCabDia > 0 ? (
                  <DesvioConsumoTag real={consumoCabDiaReal} esperado={consumoEsperadoCabDia} />
                ) : null}
                {consumoCabDiaReal > 0 && consumoEsperadoCabDia > 0
                  ? `${((consumoCabDiaReal - consumoEsperadoCabDia) / consumoEsperadoCabDia * 100) > 0 ? "+" : ""}${((consumoCabDiaReal - consumoEsperadoCabDia) / consumoEsperadoCabDia * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                  : "-"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROJEÇÃO */}
      {showProjecao && (
        <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Projeção</div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <MetricCell label="Fechamento" value={periodoFechado ? `${evento.dias_periodo} dia(s)` : "Em aberto"} />
            <MetricCell label="Duração estimada" value={duracaoCalc > 0 ? `${duracaoCalc} dia(s)` : "-"} />
            {periodoFechado ? (
              <MetricCell
                label="Diferença (est - real)"
                value={diferencaDias != null ? `${diferencaDias > 0 ? "+" : ""}${diferencaDias} dia(s)` : "-"}
              />
            ) : (
              <MetricCell label="Próx. reposição" value={proximaReposicao || "-"} />
            )}
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