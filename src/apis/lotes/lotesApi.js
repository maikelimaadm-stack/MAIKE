/**
 * API do módulo Lotes (P1.2, D-PROD-18).
 *
 * Criada nesta slice já com o domínio do manejo iniciado pelo mapa, para que a
 * P1.3 a reutilize em vez de criar uma segunda API de lote (QLT-P12-01).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { lotesProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Lote';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listLotes = async () =>
  comoLista(await runProviderCall(() => lotesProvider.listLotes(), ctx('listLotes')));

export const filterLotes = async (criterio) => {
  const contexto = ctx('filterLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => lotesProvider.filterLotes(criterio), contexto));
};

export const createLote = async (dados) => {
  const contexto = ctx('createLote');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createLote(dados), contexto);
};

export const updateLote = async (id, dados) => {
  const contexto = ctx('updateLote');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.updateLote(id, dados), { ...contexto, details: { id } });
};

// ── Movimentações do mapa ─────────────────────────────────────────────────

export const MOVIMENTACAO_DEFAULT_ORDER = '-data_movimentacao';
export const MOVIMENTACAO_DEFAULT_LIMIT = 500;

export const listMovimentacoes = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoes');
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? MOVIMENTACAO_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => lotesProvider.listMovimentacoes(ordem, limite), contexto));
};

/** Sem limite: preserva o `list('-data_movimentacao')` sem teto do legado. */
export const listTodasMovimentacoes = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => lotesProvider.listTodasMovimentacoes(opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER),
      ctx('listTodasMovimentacoes')
    )
  );

export const filterMovimentacoes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterMovimentacoes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => lotesProvider.filterMovimentacoes(criterio, ordem, limite), contexto));
};

export const createMovimentacao = async (dados) => {
  const contexto = ctx('createMovimentacao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createMovimentacao(dados), contexto);
};

/**
 * Movimentações pecuárias — leitura usada pela regra de bloqueio de exclusão.
 *
 * Escopo estreito: a P1.2 só precisa listar. O CRUD entra quando a slice que
 * possui esse domínio tiver consumidor migrado.
 */
export const listMovimentacoesPecuarias = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoesPecuarias');
  const ordem = opcoes.order ?? '-created_date';
  const limite = opcoes.limit ?? 5000;
  return comoLista(await runProviderCall(() => lotesProvider.listMovimentacoesPecuarias(ordem, limite), contexto));
};

export const deleteMovimentacao = async (id) => {
  const contexto = ctx('deleteMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => lotesProvider.deleteMovimentacao(id), { ...contexto, details: { id } });
};

// ── Suplementação ─────────────────────────────────────────────────────────

export const SUPLEMENTACAO_LOTE_DEFAULT_ORDER = '-data_lancamento';
export const SUPLEMENTACAO_LOTE_DEFAULT_LIMIT = 500;

export const listSuplementacaoEventos = async () =>
  comoLista(await runProviderCall(() => lotesProvider.listSuplementacaoEventos(), ctx('listSuplementacaoEventos')));

export const createSuplementacaoEvento = async (dados) => {
  const contexto = ctx('createSuplementacaoEvento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createSuplementacaoEvento(dados), contexto);
};

export const listSuplementacaoLotes = async (opcoes = {}) => {
  const contexto = ctx('listSuplementacaoLotes');
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? SUPLEMENTACAO_LOTE_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => lotesProvider.listSuplementacaoLotes(ordem, limite), contexto));
};

export const filterSuplementacaoLotes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterSuplementacaoLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => lotesProvider.filterSuplementacaoLotes(criterio, ordem, limite), contexto));
};

export const bulkCreateSuplementacaoLote = async (registros) => {
  const contexto = ctx('bulkCreateSuplementacaoLote');
  assertArgument(Array.isArray(registros) && registros.length > 0, 'registros', contexto);
  return runProviderCall(() => lotesProvider.bulkCreateSuplementacaoLote(registros), contexto);
};
