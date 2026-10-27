/** API do módulo Unidades de Medida — nativo desde P4.5 (D-PROD-44). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { produtosProvider } from '../_providers/base44Provider.js';
import { unidadeMedidaPort } from './unidadeMedidaNativePort.js';

const RESOURCE = 'UnidadeMedida';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listUnidades = async () =>
  comoLista(await runProviderCall(() => unidadeMedidaPort.list(), ctx('listUnidades')));

export const createUnidade = async (dados) => {
  const contexto = ctx('createUnidade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  const { numero_unidade: _ignorado, ...resto } = dados;
  return runProviderCall(() => unidadeMedidaPort.create(resto), contexto);
};

export const updateUnidade = async (id, dados) => {
  const contexto = ctx('updateUnidade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => unidadeMedidaPort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteUnidade = async (id) => {
  const contexto = ctx('deleteUnidade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => unidadeMedidaPort.delete(id), { ...contexto, details: { id } });
};

/** Produtos — leitura usada pela guarda: o Produto referencia a **sigla**. */
export const listProdutosVinculados = async () =>
  comoLista(await runProviderCall(() => produtosProvider.list(), ctx('listProdutosVinculados')));
