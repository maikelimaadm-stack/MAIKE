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

/**
 * Calcula os dias entre duas datas (mínimo 1 dia).
 */
export function calcularDiasPeriodo(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) return 0;
  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) return 0;
  return Math.max(1, Math.ceil((fim - inicio) / 86400000));
}

/**
 * Calcula o consumo de um período de suplementação.
 * 
 * Fórmula: consumo_total = fornecido - sobra_final
 * (sobra_inicial não é usado pois cada período começa com um novo fornecimento)
 * 
 * @param {number} fornecido - Quantidade total fornecida no período (kg)
 * @param {number} sobraFinal - Sobra encontrada ao final do período (kg)
 * @param {number} diasPeriodo - Número de dias do período
 * @param {number} pesoTotalConsumo - Soma dos pesos de consumo (cabeças × fatores)
 * @returns {{ consumoTotal, consumoDiarioGrupo, consumoUnitarioDia }}
 */
export function calcularConsumo({ fornecido, sobraFinal, diasPeriodo, pesoTotalConsumo }) {
  const fornecidoNum = Number(fornecido || 0);
  const sobraNum = Number(sobraFinal || 0);
  const dias = Math.max(1, Number(diasPeriodo || 1));
  const pesoConsumo = Number(pesoTotalConsumo || 0);

  const consumoTotal = Math.max(0, fornecidoNum - sobraNum);
  const consumoDiarioGrupo = safeDivide(consumoTotal, dias);
  const consumoUnitarioDia = safeDivide(consumoTotal, dias * pesoConsumo);

  return { consumoTotal, consumoDiarioGrupo, consumoUnitarioDia };
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
export function calcularConsumoLote({ consumoUnitarioDia, fatorConsumo, cabecas, diasPeriodo }) {
  const fator = Number(fatorConsumo || 1);
  const cab = Number(cabecas || 0);
  const dias = Math.max(1, Number(diasPeriodo || 1));
  const unitario = Number(consumoUnitarioDia || 0);

  const consumoPorCabecaDia = unitario * fator;
  const consumoTotalLotePeriodo = consumoPorCabecaDia * cab * dias;

  return { consumoPorCabecaDia, consumoTotalLotePeriodo };
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
export async function fecharPeriodoSupplementacao({ evento, diasPeriodo, sobraFinal, onProgress }) {
  const { consumoTotal, consumoDiarioGrupo, consumoUnitarioDia } = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    diasPeriodo,
    pesoTotalConsumo: evento.peso_total_consumo,
  });

  // Atualiza o evento
  await base44.entities.SuplementacaoEvento.update(evento.id, {
    sobra_kg: Number(sobraFinal || 0),
    dias_periodo: diasPeriodo,
    consumo_diario_grupo_kg: consumoDiarioGrupo,
  });

  if (onProgress) onProgress("Atualizando lotes do período...");

  // Atualiza todos os lotes do evento
  const todosLotesSupl = await base44.entities.SuplementacaoLote.list();
  const lotesDoEvento = todosLotesSupl.filter((l) => l.suplementacao_evento_id === evento.id);

  for (const loteSupl of lotesDoEvento) {
    const { consumoPorCabecaDia, consumoTotalLotePeriodo } = calcularConsumoLote({
      consumoUnitarioDia,
      fatorConsumo: loteSupl.fator_consumo,
      cabecas: loteSupl.cabecas_na_area,
      diasPeriodo,
    });

    await base44.entities.SuplementacaoLote.update(loteSupl.id, {
      dias_periodo: diasPeriodo,
      consumo_unitario_dia: consumoUnitarioDia,
      consumo_por_cabeca_dia_kg: consumoPorCabecaDia,
      consumo_total_lote_periodo_kg: consumoTotalLotePeriodo,
    });
  }

  return { consumoTotal, consumoDiarioGrupo, consumoUnitarioDia };
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