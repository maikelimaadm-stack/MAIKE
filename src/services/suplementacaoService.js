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
  updateEvento,
  listLotesSuplementacao,
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
import { comandoLancamentoComLotes } from '@/apis/suplementacao-eventos';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const novaOperationId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const exigirConexaoParaComando = () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'registrarLancamento',
      resource: 'Suplementacao',
      details: { motivo: 'offline_comando_composto', mensagem: 'Lançamento requer conexão para confirmar.' },
    });
  }
};

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

/**
 * Cria evento + lotes rateados em comando transacional único (ESTAB-P0-01).
 * @param {{ evento: Record<string, unknown>, lotes?: Array<Record<string, unknown>>, operationId?: string }} params
 */
export const registrarLancamento = async ({ evento, lotes, operationId }) => {
  exigirConexaoParaComando();
  const resposta = await comandoLancamentoComLotes({
    operation_id: operationId || novaOperationId(),
    evento,
    lotes: Array.isArray(lotes) ? lotes : [],
  });
  return resposta.evento;
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
 * Calcula o fechamento do período SEM gravar nada (D-PROD-137, SUP-01).
 *
 * Só leituras (lotes do período, lotes, movimentações) e a aritmética pura de
 * `consumoUtils`. Quem fecha o consumo ao MOVER o gado prepara aqui e grava com
 * `aplicarFechamentoPeriodo` só depois de o servidor confirmar a transferência:
 * antes, o fechamento era gravado primeiro e uma transferência recusada,
 * cancelada ou offline deixava o período fechado sem o gado ter saído.
 *
 * @param {object} p
 * @param {any} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.sobraFinal
 * @param {number} [p.sobraInicial]
 */
export const prepararFechamentoPeriodo = async ({ evento, diasPeriodo, sobraFinal, sobraInicial }) => {
  const lotesSupl = await listLotesSuplementacao();
  const lotesDoEvento = lotesSupl.filter((lote) => lote.suplementacao_evento_id === evento.id);

  const metricas = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    sobraInicial: sobraInicial ?? evento.sobra_kg,
    diasPeriodo,
    totalCabecas: evento.total_cabecas_afetadas,
  });

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

  return {
    eventoId: evento.id,
    patchEvento: fechamento.patchEvento,
    patchesDeLote: fechamento.patchesDeLote,
    consumoTotal: fechamento.consumoTotal,
    consumoDiarioGrupo: fechamento.consumoDiarioGrupo,
    consumoPorCabecaDia: fechamento.consumoPorCabecaDia,
  };
};

/**
 * Grava um fechamento preparado: o evento e depois cada lote do período (a
 * mesma ordem do legado; o `onProgress` marca essa fronteira).
 * @param {Awaited<ReturnType<typeof prepararFechamentoPeriodo>>} preparado
 * @param {{ onProgress?: (mensagem: string) => void }} [opcoes]
 */
export const aplicarFechamentoPeriodo = async (preparado, { onProgress } = {}) => {
  await updateEvento(preparado.eventoId, preparado.patchEvento);
  onProgress?.('Atualizando lotes do período...');
  await Promise.all(preparado.patchesDeLote.map(({ id, patch }) => updateLoteSuplementacao(id, patch)));
};

/**
 * Grava o fechamento preparado só se o período AINDA estiver aberto: entre o
 * preparo (passo do consumo) e a confirmação da transferência, outra pessoa
 * pode ter fechado o mesmo período — não se sobrescreve o fechamento dela.
 * @param {Awaited<ReturnType<typeof prepararFechamentoPeriodo>>} preparado
 * @returns {Promise<{ aplicado: boolean, motivo?: 'ja_fechado' | 'nao_encontrado' }>}
 */
export const aplicarFechamentoSeAindaAberto = async (preparado) => {
  const atual = (await listEventos()).find((evento) => evento.id === preparado.eventoId) || null;
  if (!atual) return { aplicado: false, motivo: 'nao_encontrado' };
  if (atual.dias_periodo !== null && atual.dias_periodo !== undefined) return { aplicado: false, motivo: 'ja_fechado' };
  await aplicarFechamentoPeriodo(preparado);
  return { aplicado: true };
};

/**
 * Fecha o período: calcula e grava o evento e cada lote (lançamento novo no
 * cocho, que fecha o período anterior DEPOIS de gravar o novo).
 *
 * Mesmos valores do legado. Agora todas as leituras vêm antes da primeira
 * escrita: uma falha de leitura não deixa mais o evento fechado e os lotes não.
 *
 * @param {object} p
 * @param {any} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.sobraFinal
 * @param {number} [p.sobraInicial]
 * @param {(mensagem: string) => void} [p.onProgress]
 */
export const fecharPeriodoSuplementacao = async ({ evento, diasPeriodo, sobraFinal, sobraInicial, onProgress }) => {
  const preparado = await prepararFechamentoPeriodo({ evento, diasPeriodo, sobraFinal, sobraInicial });
  await aplicarFechamentoPeriodo(preparado, { onProgress });
  return {
    consumoTotal: preparado.consumoTotal,
    consumoDiarioGrupo: preparado.consumoDiarioGrupo,
    consumoPorCabecaDia: preparado.consumoPorCabecaDia,
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
