/**
 * API do módulo Categorias de produto (P1.3, D-PROD-18).
 *
 * Cadastro hierárquico por `categoria_pai_id`. A regra de bloqueio de exclusão
 * de pai com filhos é de domínio e vive no service.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { categoriasProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Categoria';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listCategorias = async (ordenacao) =>
  comoLista(await runProviderCall(() => categoriasProvider.list(ordenacao), ctx('listCategorias')));

export const createCategoria = async (dados) => {
  const contexto = ctx('createCategoria');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriasProvider.create(dados), contexto);
};

export const updateCategoria = async (id, dados) => {
  const contexto = ctx('updateCategoria');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriasProvider.update(id, dados), contexto);
};

export const deleteCategoria = async (id) => {
  const contexto = ctx('deleteCategoria');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => categoriasProvider.delete(id), contexto);
};
