/**
 * UTILITÁRIOS CENTRALIZADOS DE CÁLCULO DE CONSUMO
 * 
 * Centraliza toda a lógica de fechamento de período de suplementação.
 * Garante consistência entre todos os pontos que calculam consumo:
 * - FormularioLancamentoSuplementacao (novo lançamento)
 * - FormularioMovimentacaoLote (fechamento antes de mover)
 * - HistoricoSuplementacaoUtils (reversão de exclusão)
 */

import { base44 } from "@/api/base44Client";
import { safeDivide } from "./pecuariaUtils";
import { buildTimeWeightedLoteAllocations } from "../suplementacao/timeWeightedAllocation";

const parseDateLocal = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Calcula os dias entre duas datas (mínimo 1 dia).
 */
export function calcularDiasPeriodo(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) return 0;
  const parseDateLocal = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [ano, mes, dia] = value.split("-").map(Number);
      return new Date(ano, mes - 1, dia);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const inicio = parseDateLocal(dataInicio);
  const fim = parseDateLocal(dataFim);
  if (!inicio || !fim) return 0;
  return Math.max(1, Math.ceil((fim - inicio) / 86400000));
}

/**
 * Calcula o consumo de um período de suplementação.
 * 
 * Fórmula: consumo_total = fornecido - sobra_final + sobra_inicial
 * 
 * @param {number} fornecido - Quantidade total fornecida no período (kg)
 * @param {number} sobraFinal - Sobra encontrada ao final do período (kg)
 * @param {number} sobraInicial - Sobra existente no início do período (kg)
 * @param {number} diasPeriodo - Número de dias do período
 * @param {number} pesoTotalConsumo - Soma dos pesos de consumo (cabeças × fatores)
 * @returns {{ consumoTotal, consumoDiarioGrupo, consumoUnitarioDia }}
 */
export function calcularConsumo({ fornecido, sobraFinal, sobraInicial, diasPeriodo, totalCabecas }) {
  const fornecidoNum = Number(fornecido || 0);
  const sobraFinalNum = Number(sobraFinal || 0);
  const sobraInicialNum = Number(sobraInicial || 0);
  const dias = Math.max(1, Number(diasPeriodo || 1));
  const cabecas = Number(totalCabecas || 0);

  const consumoTotal = Math.max(0, fornecidoNum - sobraFinalNum + sobraInicialNum);
  const consumoDiarioGrupo = safeDivide(consumoTotal, dias);
  const consumoPorCabecaDia = safeDivide(consumoDiarioGrupo, cabecas);

  return { consumoTotal, consumoDiarioGrupo, consumoPorCabecaDia };
}

/**
 * Calcula o consumo de um lote específico dentro de um período.
 * 
 * @param {number} consumoUnitarioDia - Consumo unitário por dia (do cálculo geral)
 * @param {number} fatorConsumo - Fator de consumo da categoria do lote
 * @param {number} cabecas - Número de cabeças do lote
 * @param {number} diasPeriodo - Número de dias do período
 * @returns {{ consumoPorCabecaDia, consumoTotalLotePeriodo }}
 */
export function calcularConsumoLote({ consumoDiarioGrupo, totalCabecas, cabecas, diasPeriodo }) {
  const consumoDiaGrupo = Number(consumoDiarioGrupo || 0);
  const totalCab = Number(totalCabecas || 0);
  const cab = Number(cabecas || 0);
  const dias = Math.max(1, Number(diasPeriodo || 1));

  const percentualLote = safeDivide(cab, totalCab);
  const consumoDiarioLote = consumoDiaGrupo * percentualLote;
  const consumoPorCabecaDia = safeDivide(consumoDiarioLote, cab);
  const consumoTotalLotePeriodo = consumoDiarioLote * dias;

  return { percentualLote, consumoDiarioLote, consumoPorCabecaDia, consumoTotalLotePeriodo };
}

export async function calcularConsumoLotesPonderadoPorTempo({
  evento,
  diasPeriodo,
  consumoTotal,
  dataFechamento,
}) {
  const [todosLotesSupl, lotesAtivos, movimentacoes] = await Promise.all([
    base44.entities.SuplementacaoLote.list(),
    base44.entities.Lote.list(),
    base44.entities.MovimentacaoPecuaria.list(),
  ]);

  const lotesDoEvento = todosLotesSupl.filter((l) => l.suplementacao_evento_id === evento.id);
  const lotesRelacionados = lotesAtivos.filter((lote) => lotesDoEvento.some((item) => item.lote_id === lote.id));
  const movimentosRelacionados = movimentacoes.filter((mov) => mov.empresa_id === evento.empresa_id && lotesDoEvento.some((item) => item.lote_id === mov.lote_id));

  const dataInicio = evento.data_lancamento;
  const dataFim = dataFechamento || new Date(parseDateLocal(evento.data_lancamento).getTime() + Math.max(1, Number(diasPeriodo || 1)) * 86400000);

  return buildTimeWeightedLoteAllocations({
    lotes: lotesRelacionados,
    movimentacoes: movimentosRelacionados,
    areaIds: Array.isArray(evento.area_ids) ? evento.area_ids : (evento.area_id ? [evento.area_id] : []),
    dataInicio,
    dataFim,
    consumoTotalPeriodo: consumoTotal,
  });
}

/**
 * Fecha um período de suplementação (evento + lotes vinculados).
 * Atualiza o SuplementacaoEvento e todos os SuplementacaoLote do período.
 * 
 * @param {object} evento - O SuplementacaoEvento a fechar
 * @param {number} diasPeriodo - Dias do período
 * @param {number} sobraFinal - Sobra registrada (kg)
 * @param {function} onProgress - Callback de progresso (opcional)
 */
export async function fecharPeriodoSupplementacao({ evento, diasPeriodo, sobraFinal, sobraInicial, dataFechamento, onProgress }) {
  const { consumoTotal, consumoDiarioGrupo, consumoPorCabecaDia } = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    sobraInicial: sobraInicial ?? evento.sobra_kg,
    diasPeriodo,
    totalCabecas: evento.total_cabecas_afetadas,
  });

  await base44.entities.SuplementacaoEvento.update(evento.id, {
    sobra_kg: Number(sobraFinal || 0),
    dias_periodo: diasPeriodo,
    data_fechamento_consumo: dataFechamento || null,
    consumo_diario_grupo_kg: consumoDiarioGrupo,
  });

  if (onProgress) onProgress("Atualizando lotes do período...");

  const todosLotesSupl = await base44.entities.SuplementacaoLote.list();
  const lotesDoEvento = todosLotesSupl.filter((l) => l.suplementacao_evento_id === evento.id);
  const alocacoes = await calcularConsumoLotesPonderadoPorTempo({
    evento,
    diasPeriodo,
    consumoTotal,
    dataFechamento,
  });
  const alocacaoMap = new Map(alocacoes.map((item) => [item.loteId, item]));

  await Promise.all(lotesDoEvento.map((loteSupl) => {
    const alocacao = alocacaoMap.get(loteSupl.lote_id);
    const percentualLote = alocacao?.percentualParticipacao ?? safeDivide(loteSupl.cabecas_na_area, evento.total_cabecas_afetadas);
    const consumoDiarioLote = consumoDiarioGrupo * percentualLote;
    const consumoCabecaLote = alocacao?.consumoPorCabecaDiaKg ?? safeDivide(consumoDiarioLote, loteSupl.cabecas_na_area);
    const consumoTotalLotePeriodo = alocacao?.consumoTotalLotePeriodoKg ?? consumoDiarioLote * diasPeriodo;

    return base44.entities.SuplementacaoLote.update(loteSupl.id, {
      dias_periodo: diasPeriodo,
      consumo_unitario_dia: consumoPorCabecaDia,
      consumo_por_cabeca_dia_kg: consumoCabecaLote,
      consumo_total_lote_periodo_kg: consumoTotalLotePeriodo,
      percentual_consumo_lote: percentualLote,
      animal_dias_periodo: alocacao?.animalDias ?? null,
      dias_ativos_periodo: alocacao?.diasAtivos ?? null,
    });
  }));

  return { consumoTotal, consumoDiarioGrupo, consumoPorCabecaDia };
}

/**
 * Reabre um período de suplementação (remove métricas de consumo).
 * Usado ao excluir um evento e precisar reabrir o anterior.
 */
export async function reabrirPeriodoSuplementacao({ eventoId, lotesSupl }) {
  await base44.entities.SuplementacaoEvento.update(eventoId, {
    dias_periodo: null,
    consumo_diario_grupo_kg: null,
  });

  const lotesDoEvento = lotesSupl.filter((item) => item.suplementacao_evento_id === eventoId);
  for (const lote of lotesDoEvento) {
    await base44.entities.SuplementacaoLote.update(lote.id, {
      dias_periodo: null,
      consumo_unitario_dia: null,
      consumo_por_cabeca_dia_kg: null,
      consumo_total_lote_periodo_kg: null,
    });
  }
}