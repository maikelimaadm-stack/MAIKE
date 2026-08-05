/**
 * CÁLCULO DE CONSUMO DE SUPLEMENTAÇÃO — PURO
 *
 * Centraliza a aritmética de fechamento de período e garante consistência entre
 * os pontos que calculam consumo: novo lançamento, fechamento antes de mover o
 * lote e reversão de exclusão.
 *
 * Desde a P1.4 este arquivo **não faz I/O**. Ele importava `base44` e escrevia
 * em `SuplementacaoEvento` e `SuplementacaoLote` — persistência dentro de um
 * módulo de utilitários de cálculo. O que persiste agora é
 * `src/services/suplementacaoService.js`; o que decide continua aqui.
 *
 * Sem React, sem provider, sem `window`.
 */

import { safeDivide } from "./pecuariaUtils";
import { buildTimeWeightedLoteAllocations } from "../suplementacao/timeWeightedAllocation";

export const parseDateLocal = (value) => {
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
 * @param {object} p
 * @param {number} p.fornecido quantidade total fornecida no período (kg)
 * @param {number} p.sobraFinal sobra encontrada ao final do período (kg)
 * @param {number} [p.sobraInicial] sobra existente no início do período (kg)
 * @param {number} p.diasPeriodo número de dias do período
 * @param {number} [p.totalCabecas] soma das cabeças afetadas
 * @returns {{consumoTotal: number, consumoDiarioGrupo: number, consumoPorCabecaDia: number}}
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

/**
 * Alocação ponderada por tempo a partir de dados **já carregados**.
 *
 * A versão anterior fazia três `list()` aqui dentro. O service passou a carregar
 * e a chamar esta função; a ponderação em si não mudou.
 *
 * @param {object} p
 * @param {object} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.consumoTotal
 * @param {Array<object>} p.todosLotesSupl
 * @param {Array<object>} p.lotesAtivos
 * @param {Array<object>} p.movimentacoes
 */
export function calcularConsumoLotesPonderadoPorTempo({
  evento,
  diasPeriodo,
  consumoTotal,
  todosLotesSupl,
  lotesAtivos,
  movimentacoes,
}) {
  const lotesDoEvento = todosLotesSupl.filter((l) => l.suplementacao_evento_id === evento.id);
  const lotesRelacionados = lotesAtivos.filter((lote) => lotesDoEvento.some((item) => item.lote_id === lote.id));
  const movimentosRelacionados = movimentacoes.filter((mov) => mov.empresa_id === evento.empresa_id && lotesDoEvento.some((item) => item.lote_id === mov.lote_id));

  const dataInicio = evento.data_lancamento;
  const inicio = parseDateLocal(evento.data_lancamento);
  // Sem data de início não há como ponderar por tempo. O legado estourava
  // `null.getTime()` no meio do fechamento; devolver lista vazia faz o
  // chamador cair no rateio simples por cabeças, que é o fallback já previsto.
  if (!inicio) return [];
  const dataFim = new Date(inicio.getTime() + Math.max(1, Number(diasPeriodo || 1)) * 86400000);

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
 * Métricas de fechamento de um período — puro.
 *
 * Recebe o evento, os lotes de suplementação do período e as alocações já
 * calculadas, e devolve **o que gravar**: o patch do evento e um patch por
 * lote. Quem grava é o service.
 *
 * O `??` de cada campo preserva o fallback do legado: quando não há alocação
 * ponderada para o lote, vale o rateio simples por cabeças.
 *
 * @returns {{consumoTotal: number, consumoDiarioGrupo: number, consumoPorCabecaDia: number,
 *            patchEvento: object, patchesDeLote: Array<{id: string, patch: object}>}}
 */
export function calcularFechamentoDePeriodo({ evento, diasPeriodo, sobraFinal, sobraInicial, lotesDoEvento, alocacoes }) {
  const { consumoTotal, consumoDiarioGrupo, consumoPorCabecaDia } = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    sobraInicial: sobraInicial ?? evento.sobra_kg,
    diasPeriodo,
    totalCabecas: evento.total_cabecas_afetadas,
  });

  const alocacaoMap = new Map((alocacoes || []).map((item) => [item.loteId, item]));

  const patchesDeLote = (lotesDoEvento || []).map((loteSupl) => {
    const alocacao = alocacaoMap.get(loteSupl.lote_id);
    const percentualLote = alocacao?.percentualParticipacao ?? safeDivide(loteSupl.cabecas_na_area, evento.total_cabecas_afetadas);
    const consumoDiarioLote = consumoDiarioGrupo * percentualLote;
    const consumoCabecaLote = alocacao?.consumoPorCabecaDiaKg ?? safeDivide(consumoDiarioLote, loteSupl.cabecas_na_area);
    const consumoTotalLotePeriodo = alocacao?.consumoTotalLotePeriodoKg ?? consumoDiarioLote * diasPeriodo;

    return {
      id: loteSupl.id,
      patch: {
        dias_periodo: diasPeriodo,
        consumo_unitario_dia: consumoPorCabecaDia,
        consumo_por_cabeca_dia_kg: consumoCabecaLote,
        consumo_total_lote_periodo_kg: consumoTotalLotePeriodo,
        percentual_consumo_lote: percentualLote,
        animal_dias_periodo: alocacao?.animalDias ?? null,
        dias_ativos_periodo: alocacao?.diasAtivos ?? null,
      },
    };
  });

  return {
    consumoTotal,
    consumoDiarioGrupo,
    consumoPorCabecaDia,
    patchEvento: {
      sobra_kg: Number(sobraFinal || 0),
      dias_periodo: diasPeriodo,
      consumo_diario_grupo_kg: consumoDiarioGrupo,
    },
    patchesDeLote,
  };
}

/** Patch que reabre um período: métricas de consumo zeradas no evento. */
export const PATCH_REABERTURA_EVENTO = Object.freeze({
  dias_periodo: null,
  consumo_diario_grupo_kg: null,
});

/** Patch que reabre um período em cada lote do evento. */
export const PATCH_REABERTURA_LOTE = Object.freeze({
  dias_periodo: null,
  consumo_unitario_dia: null,
  consumo_por_cabeca_dia_kg: null,
  consumo_total_lote_periodo_kg: null,
});