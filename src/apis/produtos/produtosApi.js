/** API do módulo Produtos (P1.4). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { produtosProvider, estoqueProvider, referenciasProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Produto';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listProdutos = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => produtosProvider.list(opcoes.order), ctx('listProdutos')));

export const filterProdutos = async (criterio) => {
  const contexto = ctx('filterProdutos');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => produtosProvider.filter(criterio), contexto));
};

export const createProduto = async (dados) => {
  const contexto = ctx('createProduto');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => produtosProvider.create(dados), contexto);
};

export const updateProduto = async (id, dados) => {
  const contexto = ctx('updateProduto');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => produtosProvider.update(id, dados), { ...contexto, details: { id } });
};

export const deleteProduto = async (id) => {
  const contexto = ctx('deleteProduto');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => produtosProvider.delete(id), { ...contexto, details: { id } });
};

/** Movimentações de estoque — leitura usada pela guarda de exclusão. */
export const listMovimentacoesEstoque = async () =>
  comoLista(await runProviderCall(() => estoqueProvider.listMovimentacoes(), ctx('listMovimentacoesEstoque')));

/**
 * Sincroniza referências denormalizadas após renomear um produto.
 *
 * O nome da function é literal no provider; esta API não aceita nome de função
 * do chamador (QLT-P13-09).
 */
export const sincronizarReferenciasProduto = async ({ data, oldData }) => {
  const contexto = ctx('sincronizarReferenciasProduto');
  assertArgument(isObjeto(data), 'data', contexto);
  return runProviderCall(
    () =>
      referenciasProvider.sincronizar({
        event: { type: 'update', entity_name: RESOURCE },
        data,
        old_data: oldData ?? null,
      }),
    contexto
  );
};
