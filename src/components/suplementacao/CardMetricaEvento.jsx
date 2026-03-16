import React from "react";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { formatDecimal, formatKg } from "./formatters";
import { safeDivide } from "../utils/pecuariaUtils";
import { kgParaSacos } from "./unidadeConversaoUtils";

const parseDateLocal = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

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

  // Sacos: 1) prop, 2) evento.quantidade_sacos, 3) calcular via produto ou evento.peso_por_saco_kg
  const pesoPorSaco = Number(produto?.peso_por_saco_kg || evento.peso_por_saco_kg || 0);
  const sacosCalc = sacos != null
    ? sacos
    : evento.quantidade_sacos > 0
      ? evento.quantidade_sacos
      : pesoPorSaco > 0
        ? kgParaSacos(fornecido, pesoPorSaco)
        : null;

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

  // Desvio: realizado - esperado (em kg, não %)
  const desvioKg = periodoFechado && consumoCabDiaReal > 0 && consumoEsperadoCabDia > 0
    ? consumoCabDiaReal - consumoEsperadoCabDia
    : null;

  // Próx. reposição: calcular internamente quando não passado e período aberto
  const proxReposicaoCalc = (() => {
    if (proximaReposicao) return proximaReposicao;
    if (periodoFechado) return null;
    if (duracaoCalc <= 0) return null;
    const dataBase = parseDateLocal(evento.data_lancamento);
    if (!dataBase) return null;
    return new Date(dataBase.getTime() + duracaoCalc * 86400000).toLocaleDateString("pt-BR");
  })();

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
                {desvioKg != null ? (
                  <>
                    <DesvioConsumoTag real={consumoCabDiaReal} esperado={consumoEsperadoCabDia} />
                    {desvioKg > 0 ? "+" : ""}{desvioKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                  </>
                ) : "-"}
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
              <MetricCell label="Próx. reposição" value={proxReposicaoCalc || "-"} />
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