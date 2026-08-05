/** API do módulo Unidades de Medida (P1.4). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { unidadesMedidaProvider, produtosProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'UnidadeMedida';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listUnidades = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => unidadesMedidaProvider.list(opcoes.order), ctx('listUnidades')));

export const createUnidade = async (dados) => {
  const contexto = ctx('createUnidade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => unidadesMedidaProvider.create(dados), contexto);
};

export const updateUnidade = async (id, dados) => {
  const contexto = ctx('updateUnidade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => unidadesMedidaProvider.update(id, dados), { ...contexto, details: { id } });
};

export const deleteUnidade = async (id) => {
  const contexto = ctx('deleteUnidade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => unidadesMedidaProvider.delete(id), { ...contexto, details: { id } });
};

/** Produtos — leitura usada pela guarda: o Produto referencia a **sigla**. */
export const listProdutosVinculados = async () =>
  comoLista(await runProviderCall(() => produtosProvider.list(), ctx('listProdutosVinculados')));
