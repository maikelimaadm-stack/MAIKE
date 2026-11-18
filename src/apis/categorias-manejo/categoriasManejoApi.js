/**
 * API do módulo Categorias de Manejo (P1.3, D-PROD-18).
 *
 * Os ícones de lote (`ConfiguracaoIcone`) **não** são relidos aqui: a
 * capacidade já existe na superfície pública de `src/apis/mapa/`, e duplicá-la
 * criaria duas leituras da mesma entidade com contratos que poderiam divergir
 * (QLT-P13-04). O service consome a API de mapa para isso.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { categoriaManejoPort, listarOpcoesCurvasGanho } from './categoriaManejoNativePort.js';

const RESOURCE = 'CategoriaManejo';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listCategoriasManejo = async (ordenacao) =>
  comoLista(await runProviderCall(() => categoriaManejoPort.list(ordenacao), ctx('listCategoriasManejo')));

export const createCategoriaManejo = async (dados) => {
  const contexto = ctx('createCategoriaManejo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriaManejoPort.create(dados), contexto);
};

export const updateCategoriaManejo = async (id, dados) => {
  const contexto = ctx('updateCategoriaManejo');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => categoriaManejoPort.update(id, dados), contexto);
};

export const deleteCategoriaManejo = async (id) => {
  const contexto = ctx('deleteCategoriaManejo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => categoriaManejoPort.delete(id), contexto);
};

/**
 * Curvas de ganho da fazenda para o seletor da categoria (D-PROD-195).
 * @param {string} empresaId
 * @returns {Promise<Array<{ id: string, nome: string, ativo: boolean }>>}
 */
export const listOpcoesCurvasGanhoCategoriaManejo = async (empresaId) => {
  const contexto = ctx('listOpcoesCurvasGanhoCategoriaManejo');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return comoLista(await runProviderCall(() => listarOpcoesCurvasGanho(empresaId), contexto));
};
