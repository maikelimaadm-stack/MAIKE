/**
 * API do módulo Categorias de Manejo (P1.3, D-PROD-18).
 *
 * Os ícones de lote (`ConfiguracaoIcone`) **não** são relidos aqui: a
 * capacidade já existe na superfície pública de `src/apis/mapa/`, e duplicá-la
 * criaria duas leituras da mesma entidade com contratos que poderiam divergir
 * (QLT-P13-04). O service consome a API de mapa para isso.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { categoriasManejoProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'CategoriaManejo';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listCategoriasManejo = async (ordenacao) =>
  comoLista(await runProviderCall(() => categoriasManejoProvider.list(ordenacao), ctx('listCategoriasManejo')));

export const createCategoriaManejo = async (dados) => {
  const contexto = ctx('createCategoriaManejo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriasManejoProvider.create(dados), contexto);
};

export const updateCategoriaManejo = async (id, dados) => {
  const contexto = ctx('updateCategoriaManejo');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriasManejoProvider.update(id, dados), contexto);
};

export const deleteCategoriaManejo = async (id) => {
  const contexto = ctx('deleteCategoriaManejo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => categoriasManejoProvider.delete(id), contexto);
};
