/** API do módulo Estoque consumido pelos pontos de suplementação (P1.2). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { estoqueProvider } from '../_providers/base44Provider.js';
import { listLocais, createLocal, updateLocal, deleteLocal } from '@/apis/locais-estoque';
import { listProdutos as listProdutosNativos, filterProdutos as filterProdutosNativos } from '@/apis/produtos';

const RESOURCE = 'Estoque';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export { listLocais, createLocal, updateLocal, deleteLocal };

export const listLotesNota = async () =>
  comoLista(await runProviderCall(() => estoqueProvider.listLotesNota(), ctx('listLotesNota')));

export const filterLotesNota = async (criterio) => {
  const contexto = ctx('filterLotesNota');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => estoqueProvider.filterLotesNota(criterio), contexto));
};

export const updateLoteNota = async (id, dados) => {
  const contexto = ctx('updateLoteNota');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => estoqueProvider.updateLoteNota(id, dados), { ...contexto, details: { id } });
};

export const MOVIMENTACAO_ESTOQUE_DEFAULT_ORDER = '-data_movimentacao';
export const MOVIMENTACAO_ESTOQUE_DEFAULT_LIMIT = 500;

export const listMovimentacoes = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoes');
  const ordem = opcoes.order ?? MOVIMENTACAO_ESTOQUE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? MOVIMENTACAO_ESTOQUE_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => estoqueProvider.listMovimentacoes(ordem, limite), contexto));
};

/** Sem ordenação/limite: o consumidor legado lista tudo e filtra em memória. */
export const listTodasMovimentacoes = async () =>
  comoLista(await runProviderCall(() => estoqueProvider.listMovimentacoes(), ctx('listTodasMovimentacoes')));

export const updateMovimentacao = async (id, dados) => {
  const contexto = ctx('updateMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => estoqueProvider.updateMovimentacao(id, dados), { ...contexto, details: { id } });
};

export const listProdutos = async () => listProdutosNativos();

export const filterProdutos = async (criterio) => filterProdutosNativos(criterio);
