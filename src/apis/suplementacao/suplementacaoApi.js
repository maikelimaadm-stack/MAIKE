/**
 * API do módulo Suplementação (P1.4).
 *
 * Fronteira, não redesenho de domínio: as regras de período, consumo, FIFO,
 * rateio e formatação continuam puras em `src/components/suplementacao/*`. Aqui
 * mora só o I/O que estava espalhado por componentes e por arquivos `*Utils`.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { suplementacaoProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Suplementacao';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const MOVIMENTACAO_RECENTE_ORDER = '-created_date';
export const MOVIMENTACAO_RECENTE_LIMIT = 200;

// ── Evento de suplementação ───────────────────────────────────────────────

export const listEventos = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => suplementacaoProvider.listEventos(opcoes.order), ctx('listEventos')));

export const filterEventos = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterEventos');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(
    await runProviderCall(
      () => suplementacaoProvider.filterEventos(criterio, opcoes.order, opcoes.limit),
      contexto
    )
  );
};

export const createEvento = async (dados) => {
  const contexto = ctx('createEvento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.createEvento(dados), contexto);
};

export const updateEvento = async (id, dados) => {
  const contexto = ctx('updateEvento');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.updateEvento(id, dados), { ...contexto, details: { id } });
};

export const deleteEvento = async (id) => {
  const contexto = ctx('deleteEvento');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => suplementacaoProvider.deleteEvento(id), { ...contexto, details: { id } });
};

// ── Lote de suplementação ─────────────────────────────────────────────────

export const listLotesSuplementacao = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => suplementacaoProvider.listLotes(opcoes.order, opcoes.limit),
      ctx('listLotesSuplementacao')
    )
  );

export const bulkCreateLotesSuplementacao = async (registros) => {
  const contexto = ctx('bulkCreateLotesSuplementacao');
  assertArgument(Array.isArray(registros) && registros.length > 0, 'registros', contexto);
  return runProviderCall(() => suplementacaoProvider.bulkCreateLotes(registros), contexto);
};

export const updateLoteSuplementacao = async (id, dados) => {
  const contexto = ctx('updateLoteSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.updateLote(id, dados), { ...contexto, details: { id } });
};

export const deleteLoteSuplementacao = async (id) => {
  const contexto = ctx('deleteLoteSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => suplementacaoProvider.deleteLote(id), { ...contexto, details: { id } });
};

// ── Estoque consumido pela suplementação ──────────────────────────────────

export const listMovimentacoesEstoque = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => suplementacaoProvider.listMovimentacoesEstoque(opcoes.order, opcoes.limit),
      ctx('listMovimentacoesEstoque')
    )
  );

export const createMovimentacaoEstoque = async (dados) => {
  const contexto = ctx('createMovimentacaoEstoque');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.createMovimentacaoEstoque(dados), contexto);
};

export const updateMovimentacaoEstoque = async (id, dados) => {
  const contexto = ctx('updateMovimentacaoEstoque');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.updateMovimentacaoEstoque(id, dados), {
    ...contexto,
    details: { id },
  });
};

export const deleteMovimentacaoEstoque = async (id) => {
  const contexto = ctx('deleteMovimentacaoEstoque');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => suplementacaoProvider.deleteMovimentacaoEstoque(id), {
    ...contexto,
    details: { id },
  });
};

export const listLotesNota = async () =>
  comoLista(await runProviderCall(() => suplementacaoProvider.listLotesNota(), ctx('listLotesNota')));

export const filterLotesNota = async (criterio) => {
  const contexto = ctx('filterLotesNota');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => suplementacaoProvider.filterLotesNota(criterio), contexto));
};

export const createLoteNota = async (dados) => {
  const contexto = ctx('createLoteNota');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.createLoteNota(dados), contexto);
};

export const updateLoteNota = async (id, dados) => {
  const contexto = ctx('updateLoteNota');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.updateLoteNota(id, dados), { ...contexto, details: { id } });
};

export const deleteLoteNota = async (id) => {
  const contexto = ctx('deleteLoteNota');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => suplementacaoProvider.deleteLoteNota(id), { ...contexto, details: { id } });
};

// ── Leituras de apoio ─────────────────────────────────────────────────────

export const listProdutos = async () =>
  comoLista(await runProviderCall(() => suplementacaoProvider.listProdutos(), ctx('listProdutos')));

export const updateProduto = async (id, dados) => {
  const contexto = ctx('updateProduto');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => suplementacaoProvider.updateProduto(id, dados), { ...contexto, details: { id } });
};

export const listLotesRebanho = async () =>
  comoLista(await runProviderCall(() => suplementacaoProvider.listLotesRebanho(), ctx('listLotesRebanho')));

export const listMovimentacoesPecuarias = async () =>
  comoLista(
    await runProviderCall(() => suplementacaoProvider.listMovimentacoesPecuarias(), ctx('listMovimentacoesPecuarias'))
  );

export const listAreas = async () =>
  comoLista(await runProviderCall(() => suplementacaoProvider.listAreas(), ctx('listAreas')));

export const listPontosSuplementacao = async () =>
  comoLista(
    await runProviderCall(() => suplementacaoProvider.listPontosSuplementacao(), ctx('listPontosSuplementacao'))
  );
