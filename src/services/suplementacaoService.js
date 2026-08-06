/**
 * Service de suplementação (P1.4).
 *
 * Recebeu o I/O que estava em `consumoUtils.jsx` (fechamento e reabertura de
 * período) e as leituras que o formulário de lançamento fazia direto no
 * provider — ponto atualizado, áreas, lotes, último evento, produtos, depósito,
 * lotes de nota e movimentações pecuárias.
 *
 * A aritmética continua pura em `consumoUtils` e em `timeWeightedAllocation`.
 */

import {
  listEventos,
  filterEventos,
  createEvento,
  updateEvento,
  listLotesSuplementacao,
  bulkCreateLotesSuplementacao,
  updateLoteSuplementacao,
  listProdutos,
  listLotesRebanho,
  listMovimentacoesPecuarias,
  listAreas,
  listPontosSuplementacao,
  listLotesNota,
} from '@/apis/suplementacao';
import {
  calcularConsumo,
  calcularConsumoLotesPonderadoPorTempo,
  calcularFechamentoDePeriodo,
  PATCH_REABERTURA_EVENTO,
  PATCH_REABERTURA_LOTE,
} from '@/components/utils/consumoUtils';

/**
 * @param {Array<any>} registros
 * @param {string} empresaId
 * @returns {Array<any>}
 */
const daEmpresa = (registros, empresaId) => registros.filter((item) => item.empresa_id === empresaId);

// ── Leituras do formulário de lançamento ──────────────────────────────────

/** Ponto de suplementação recarregado do provider, para pegar o estado atual. */
export const carregarPontoAtualizado = async (pontoId) => {
  const pontos = await listPontosSuplementacao();
  return pontos.find((ponto) => ponto.id === pontoId) || null;
};

export const listarPontosDaEmpresa = async (empresaId) => daEmpresa(await listPontosSuplementacao(), empresaId);
export const listarAreasDaEmpresa = async (empresaId) => daEmpresa(await listAreas(), empresaId);
export const listarLotesDaEmpresa = async (empresaId) => daEmpresa(await listLotesRebanho(), empresaId);
export const listarProdutosDaEmpresa = async (empresaId) => daEmpresa(await listProdutos(), empresaId);
export const listarLotesNotaDaEmpresa = async (empresaId) => daEmpresa(await listLotesNota(), empresaId);
export const listarMovimentacoesPecuariasDaEmpresa = async (empresaId) =>
  daEmpresa(await listMovimentacoesPecuarias(), empresaId);

/** Eventos de um ponto, do mais recente para o mais antigo. */
export const listarEventosDoPonto = async ({ empresaId, pontoId, limit }) => {
  const eventos = await filterEventos(
    { empresa_id: empresaId, ponto_suplementacao_id: pontoId },
    { order: '-data_lancamento', limit }
  );
  return eventos;
};

/** Último evento aberto de um ponto, ou `null`. */
export const ultimoEventoDoPonto = async ({ empresaId, pontoId }) => {
  const eventos = await listarEventosDoPonto({ empresaId, pontoId, limit: 1 });
  return eventos[0] || null;
};

export const listarEventosDaEmpresa = async (empresaId) => {
  const eventos = await listEventos({ order: '-data_lancamento' });
  return daEmpresa(eventos, empresaId);
};

// ── Escrita do lançamento ─────────────────────────────────────────────────

/** Cria o evento e, quando há lotes afetados, grava-os em lote. */
export const registrarLancamento = async ({ evento, lotes }) => {
  const criado = await createEvento(evento);
  if (Array.isArray(lotes) && lotes.length) {
    const comEvento = lotes.map((lote) => ({ ...lote, suplementacao_evento_id: criado.id }));
    await bulkCreateLotesSuplementacao(comEvento);
  }
  return criado;
};

// ── Fechamento e reabertura de período ────────────────────────────────────

/** Alocações ponderadas por tempo, com os dados carregados aqui. */
export const calcularAlocacoesDoPeriodo = async ({ evento, diasPeriodo, consumoTotal }) => {
  const [todosLotesSupl, lotesAtivos, movimentacoes] = await Promise.all([
    listLotesSuplementacao(),
    listLotesRebanho(),
    listMovimentacoesPecuarias(),
  ]);

  return calcularConsumoLotesPonderadoPorTempo({
    evento,
    diasPeriodo,
    consumoTotal,
    todosLotesSupl,
    lotesAtivos,
    movimentacoes,
  });
};

/**
 * Fecha o período: grava o evento e cada lote com as métricas calculadas.
 *
 * Mesma sequência e mesmos valores do legado. O `onProgress` continua sendo
 * chamado no mesmo ponto — depois do evento, antes dos lotes.
 *
 * @param {object} p
 * @param {any} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.sobraFinal
 * @param {number} [p.sobraInicial]
 * @param {(mensagem: string) => void} [p.onProgress]
 */
export const fecharPeriodoSuplementacao = async ({ evento, diasPeriodo, sobraFinal, sobraInicial, onProgress }) => {
  const lotesSupl = await listLotesSuplementacao();
  const lotesDoEvento = lotesSupl.filter((lote) => lote.suplementacao_evento_id === evento.id);

  // O evento é gravado antes dos lotes, como no legado: o `onProgress` da tela
  // marca exatamente essa fronteira.
  const metricas = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    sobraInicial: sobraInicial ?? evento.sobra_kg,
    diasPeriodo,
    totalCabecas: evento.total_cabecas_afetadas,
  });

  await updateEvento(evento.id, {
    sobra_kg: Number(sobraFinal || 0),
    dias_periodo: diasPeriodo,
    consumo_diario_grupo_kg: metricas.consumoDiarioGrupo,
  });
  onProgress?.('Atualizando lotes do período...');

  const alocacoes = await calcularAlocacoesDoPeriodo({
    evento,
    diasPeriodo,
    consumoTotal: metricas.consumoTotal,
  });

  const fechamento = calcularFechamentoDePeriodo({
    evento,
    diasPeriodo,
    sobraFinal,
    sobraInicial,
    lotesDoEvento,
    alocacoes,
  });

  await Promise.all(fechamento.patchesDeLote.map(({ id, patch }) => updateLoteSuplementacao(id, patch)));

  return {
    consumoTotal: fechamento.consumoTotal,
    consumoDiarioGrupo: fechamento.consumoDiarioGrupo,
    consumoPorCabecaDia: fechamento.consumoPorCabecaDia,
  };
};

/** Reabre um período: remove as métricas do evento e dos lotes. */
export const reabrirPeriodoSuplementacao = async ({ eventoId, lotesSupl }) => {
  await updateEvento(eventoId, { ...PATCH_REABERTURA_EVENTO });

  const lotesDoEvento = (lotesSupl || []).filter((item) => item.suplementacao_evento_id === eventoId);
  for (const lote of lotesDoEvento) {
    await updateLoteSuplementacao(lote.id, { ...PATCH_REABERTURA_LOTE });
  }
};
