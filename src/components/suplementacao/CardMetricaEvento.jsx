import React from "react";
import DesvioConsumoTag from "./DesvioConsumoTag";
import { formatDecimal, formatKg } from "./formatters";
import { safeDivide } from "../utils/pecuariaUtils";
import { kgParaSacos } from "./unidadeConversaoUtils";
import { formatarDia, somarDias } from "@/lib/diaCivil";
import { baseDoCicloDoEvento } from "@/domain/suplementacao/nivelSuplementacao";
import { resumoDoFechamento } from "@/domain/suplementacao/fechamentoConsumo";
import { ResumoFechamentoConsumo } from "./FarolConsumo";

/** Dias com até 1 casa ("4", "6,7"). @param {number} dias */
const formatarDias = (dias) => dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * Métricas de um lançamento de suplementação.
 *
 * Taxa (D-PROD-178): `consumoEsperadoDiaKg` passado (inclusive `null`) é a taxa
 * do SSOT do nível (`nivelSuplementacao.taxaConsumoKgDia`) e vale como está —
 * `null` significa "sem estimativa confiável" e não projeta nada. Sem a prop,
 * vale a taxa gravada no evento (`consumo_esperado_pv_kg`). Para o ÚLTIMO
 * lançamento do cocho, o detalhe e o Histórico passam o mesmo
 * `projecaoDoCartaoDoNivel(nivel)`: no ciclo aberto, taxa, duração e próxima
 * reposição do SSOT; fora dele, nada (vale o gravado).
 *
 * Sem as props, a projeção segue a MESMA regra do SSOT: base do ciclo
 * (`baseDoCicloDoEvento`: aberto = fornecido + sobra anterior; fechado = consumo
 * real × dias + sobra final) ÷ taxa, sem arredondar; próxima reposição =
 * lançamento + ⌈base ÷ taxa⌉ dia(s).
 *
 * @param {{
 *   evento: any,
 *   consumoEsperadoDiaKg?: number|null,
 *   sacos?: number|null,
 *   produto?: any,
 *   showProjecao?: boolean,
 *   duracaoEstimada?: number|null,
 *   proximaReposicao?: string|null,
 * }} props
 */
export default function CardMetricaEvento({
  evento,
  consumoEsperadoDiaKg,
  sacos,
  produto,
  showProjecao = true,
  duracaoEstimada,
  proximaReposicao
}) {
  if (!evento) return null;

  const periodoFechado = (evento.dias_periodo || 0) > 0;
  const cabecas = evento.total_cabecas_afetadas || 0;
  const pesoMedio = evento.peso_medio_lotes_kg || 0;
  const consumoEsperadoPV = consumoEsperadoDiaKg !== undefined
    ? Math.max(0, Number(consumoEsperadoDiaKg) || 0)
    : Math.max(0, Number(evento.consumo_esperado_pv_kg) || 0);
  const consumoEsperadoCabDia = consumoEsperadoPV > 0 && cabecas > 0 ? consumoEsperadoPV / cabecas : 0;

  // Consumo real (só quando período fechado)
  const consumoDiarioGrupo = evento.consumo_diario_grupo_kg || 0;
  const consumoCabDiaReal = cabecas > 0 ? safeDivide(consumoDiarioGrupo, cabecas) : 0;

  const fornecido = Number(evento.quantidade_total_kg || 0);
  const sobra = Number(evento.sobra_kg || 0);
  // No período fechado `sobra_kg` é a sobra FINAL: a base vem do fechamento.
  const baseCiclo = baseDoCicloDoEvento(evento);

  // Sacos: 1) prop, 2) evento.quantidade_sacos, 3) calcular via produto ou evento.peso_por_saco_kg
  const pesoPorSaco = Number(produto?.peso_por_saco_kg || evento.peso_por_saco_kg || 0);
  const sacosCalc = sacos != null ?
  sacos :
  evento.quantidade_sacos > 0 ?
  evento.quantidade_sacos :
  pesoPorSaco > 0 ?
  kgParaSacos(fornecido, pesoPorSaco) :
  null;

  // Duração estimada (dias, sem arredondar; a tela mostra 1 casa)
  const duracaoCalc = duracaoEstimada != null ?
  duracaoEstimada :
  consumoEsperadoPV > 0 && baseCiclo != null ?
  baseCiclo / consumoEsperadoPV :
  0;

  // Diferença dias (fechado): estimado - realizado
  const diferencaDias = periodoFechado && duracaoCalc > 0 && evento.dias_periodo > 0 ?
  duracaoCalc - evento.dias_periodo :
  null;

  // Desvio: realizado - esperado (em kg, não %)
  const desvioKg = periodoFechado && consumoCabDiaReal > 0 && consumoEsperadoCabDia > 0 ?
  consumoCabDiaReal - consumoEsperadoCabDia :
  null;

  // Próx. reposição: calcular internamente quando não passado e período aberto
  const proxReposicaoCalc = (() => {
    if (proximaReposicao) return proximaReposicao;
    if (periodoFechado) return null;
    if (duracaoCalc <= 0) return null;
    // Aritmética de dia civil sobre o texto AAAA-MM-DD (sem `Date` local).
    const dia = typeof evento.data_lancamento === "string" ? evento.data_lancamento.split("T")[0] : "";
    const fim = somarDias(dia, Math.ceil(duracaoCalc - 1e-9));
    return fim ? formatarDia(fim) : null;
  })();

  const fmtNum3 = (v) =>
  v > 0 ?
  v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" :
  "-";

  const fmtSacos = (v) =>
  v != null && v > 0 ?
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) :
  "-";

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
          {/* D-PROD-208: na base g/cab/dia o esperado não é por %PV. */}
          <MetricCell label={evento.base_consumo === "G_CAB_DIA" ? "Esperado lote/dia (g/cab)" : "Consumo Lote PV/dia"} value={consumoEsperadoPV > 0 ? formatKg(consumoEsperadoPV) : "-"} />
          <MetricCell label="Esperado/cab/dia" value={fmtNum3(consumoEsperadoCabDia)} />
        </div>
      </div>

      {/* CONSUMO REAL - só quando período está fechado */}
      {periodoFechado &&
      <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Consumo Real</div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <MetricCell label="Realizado cab/dia" value={consumoCabDiaReal > 0 ? fmtNum3(consumoCabDiaReal) : "-"} />
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
              <div className="text-slate-500">Desvio</div>
              <div className="font-semibold text-slate-900 flex items-center gap-1">
                {desvioKg != null ?
              <>
                    <DesvioConsumoTag real={consumoCabDiaReal} esperado={consumoEsperadoCabDia} />
                    {desvioKg > 0 ? "+" : ""}{desvioKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                  </> :
              "-"}
              </div>
            </div>
          </div>
        </div>
      }

      {/* FECHAMENTO DO CONSUMO (D-PROD-206) - farol real × esperado, %PV e custo; só período fechado */}
      {periodoFechado && resumoDoFechamento(evento) &&
      <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fechamento do consumo</div>
          <ResumoFechamentoConsumo resumo={resumoDoFechamento(evento)} />
        </div>
      }

      {/* PROJEÇÃO */}
      {showProjecao &&
      <div>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Projeção</div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <MetricCell label="Fechamento" value={periodoFechado ? `${evento.dias_periodo} dia(s)` : "Em aberto"} />
            <MetricCell label="Duração estimada" value={duracaoCalc > 0 ? `${formatarDias(duracaoCalc)} dia(s)` : "-"} />
            {periodoFechado ?
          <MetricCell
            label="Diferença dia(s)"
            value={diferencaDias != null ? `${diferencaDias > 0 ? "+" : ""}${formatarDias(diferencaDias)} dia(s)` : "-"} /> :


          <MetricCell label="Próx. reposição" value={proxReposicaoCalc || "-"} />
          }
          </div>
        </div>
      }
    </div>);

}

function MetricCell({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>);

}