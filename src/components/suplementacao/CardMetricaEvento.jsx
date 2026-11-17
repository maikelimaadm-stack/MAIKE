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
 * @typedef {{ chave: string, rotulo: string, valor: string, desvio?: { real: number, esperado: number } | null }} CelulaMetrica
 *   `desvio` (só na célula "Desvio"): os consumos por cabeça para o ícone da faixa.
 * @typedef {{ chave: "fornecimento" | "lote" | "esperado" | "real" | "projecao", titulo: string, celulas: CelulaMetrica[] }} SecaoMetrica
 * @typedef {{
 *   evento: any,
 *   consumoEsperadoDiaKg?: number|null,
 *   sacos?: number|null,
 *   produto?: any,
 *   showProjecao?: boolean,
 *   duracaoEstimada?: number|null,
 *   proximaReposicao?: string|null,
 * }} PropsMetricaEvento
 */

/**
 * Rótulos e valores (já formatados) do cartão de métricas de um lançamento,
 * por seção. Função pura: o cartão abaixo (Histórico) e o "Último registro" do
 * detalhe do cocho no desenho v12 (D-PROD-220) desenham a MESMA conta, cada um
 * no seu desenho. O fechamento do consumo (D-PROD-206) não entra: quem desenha
 * usa `resumoDoFechamento(evento)`.
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
 * @param {PropsMetricaEvento} props
 * @returns {{ periodoFechado: boolean, secoes: SecaoMetrica[] } | null} null sem evento
 */
export function metricasDoEvento({
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

  /** @param {number} v */
  const fmtNum3 = (v) =>
  v > 0 ?
  v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kg" :
  "-";

  /** @param {number|null} v */
  const fmtSacos = (v) =>
  v != null && v > 0 ?
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) :
  "-";

  /** @type {SecaoMetrica[]} */
  const secoes = [
    { chave: "fornecimento", titulo: "Fornecimento", celulas: [
      { chave: "kg", rotulo: "Quantidade kg", valor: formatKg(fornecido) },
      { chave: "sacos", rotulo: "Quantidade sacos", valor: fmtSacos(sacosCalc) },
      { chave: "sobra", rotulo: "Sobra", valor: formatKg(sobra) },
    ] },
    { chave: "lote", titulo: "Dados do Lote", celulas: [
      { chave: "cabecas", rotulo: "Qtd. Cabeças", valor: formatDecimal(cabecas, 0, true) },
      { chave: "peso", rotulo: "Peso médio", valor: pesoMedio > 0 ? `${formatDecimal(pesoMedio, 0)} kg` : "-" },
    ] },
    { chave: "esperado", titulo: "Consumo Esperado", celulas: [
      // D-PROD-210: na base g/cab/dia o esperado não é por %PV.
      { chave: "lote", rotulo: evento.base_consumo === "G_CAB_DIA" ? "Esperado lote/dia (g/cab)" : "Consumo Lote PV/dia", valor: consumoEsperadoPV > 0 ? formatKg(consumoEsperadoPV) : "-" },
      { chave: "cab", rotulo: "Esperado/cab/dia", valor: fmtNum3(consumoEsperadoCabDia) },
    ] },
  ];
  // CONSUMO REAL - só quando período está fechado
  if (periodoFechado) {
    secoes.push({ chave: "real", titulo: "Consumo Real", celulas: [
      { chave: "realizado", rotulo: "Realizado cab/dia", valor: consumoCabDiaReal > 0 ? fmtNum3(consumoCabDiaReal) : "-" },
      {
        chave: "desvio",
        rotulo: "Desvio",
        valor: desvioKg != null ? `${desvioKg > 0 ? "+" : ""}${desvioKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` : "-",
        desvio: desvioKg != null ? { real: consumoCabDiaReal, esperado: consumoEsperadoCabDia } : null,
      },
    ] });
  }
  if (showProjecao) {
    secoes.push({ chave: "projecao", titulo: "Projeção", celulas: [
      { chave: "fechamento", rotulo: "Fechamento", valor: periodoFechado ? `${evento.dias_periodo} dia(s)` : "Em aberto" },
      { chave: "duracao", rotulo: "Duração estimada", valor: duracaoCalc > 0 ? `${formatarDias(duracaoCalc)} dia(s)` : "-" },
      periodoFechado ?
      { chave: "diferenca", rotulo: "Diferença dia(s)", valor: diferencaDias != null ? `${diferencaDias > 0 ? "+" : ""}${formatarDias(diferencaDias)} dia(s)` : "-" } :
      { chave: "reposicao", rotulo: "Próx. reposição", valor: proxReposicaoCalc || "-" },
    ] });
  }
  return { periodoFechado, secoes };
}

/** Grade de cada seção do cartão (classes inteiras, para o Tailwind achar). */
const GRADE_DA_SECAO = Object.freeze({
  fornecimento: "grid grid-cols-3 gap-1 text-[10px]",
  lote: "grid grid-cols-2 gap-1 text-[10px]",
  esperado: "grid grid-cols-2 gap-1 text-[10px]",
  real: "grid grid-cols-2 gap-1 text-[10px]",
  projecao: "grid grid-cols-3 gap-1 text-[10px]",
});

/**
 * Métricas de um lançamento de suplementação (Histórico). Os números vêm de
 * `metricasDoEvento` (regras da taxa e da projeção descritas lá).
 *
 * @param {PropsMetricaEvento} props
 */
export default function CardMetricaEvento(props) {
  const metricas = metricasDoEvento(props);
  if (!metricas) return null;
  const fechamento = metricas.periodoFechado ? resumoDoFechamento(props.evento) : null;

  return (
    <div className="space-y-1.5">
      {metricas.secoes.map((secao) =>
      <React.Fragment key={secao.chave}>
          <div>
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{secao.titulo}</div>
            <div className={GRADE_DA_SECAO[secao.chave]}>
              {secao.celulas.map((celula) =>
            celula.chave === "desvio" ?
            <div key={celula.chave} className="rounded border border-slate-200 bg-white px-1.5 py-1">
                  <div className="text-slate-500">{celula.rotulo}</div>
                  <div className="font-semibold text-slate-900 flex items-center gap-1">
                    {celula.desvio ?
                <>
                        <DesvioConsumoTag real={celula.desvio.real} esperado={celula.desvio.esperado} />
                        {celula.valor}
                      </> :
                celula.valor}
                  </div>
                </div> :

            <MetricCell key={celula.chave} label={celula.rotulo} value={celula.valor} />
            )}
            </div>
          </div>

          {/* FECHAMENTO DO CONSUMO (D-PROD-206) - farol real × esperado, %PV e custo; só período fechado, depois do consumo real */}
          {secao.chave === "real" && fechamento &&
        <div>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Fechamento do consumo</div>
              <ResumoFechamentoConsumo resumo={fechamento} />
            </div>
        }
        </React.Fragment>
      )}
    </div>);

}

/** @param {{ label: string, value: React.ReactNode }} props */
function MetricCell({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-1 py-1">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>);

}
