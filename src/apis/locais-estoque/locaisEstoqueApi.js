/** API pública de locais de estoque (P5.2). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { localEstoquePort, operacoesNativas } from './localEstoqueNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'LocalEstoque';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listLocais = async () =>
  comoLista(await runProviderCall(() => localEstoquePort.list(), ctx('listLocais')));

/**
 * Página keyset — motor Base1. Sem cache offline (página ≠ array legado).
 * @param {Record<string, unknown>} [filtros]
 */
export const listLocaisPage = async (filtros = {}) => {
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), ctx('listLocaisPage'));
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

export const createLocal = async (dados) => {
  const contexto = ctx('createLocal');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => localEstoquePort.create(dados), contexto);
};

export const updateLocal = async (id, dados) => {
  const contexto = ctx('updateLocal');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => localEstoquePort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteLocal = async (id) => {
  const contexto = ctx('deleteLocal');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => localEstoquePort.delete(id), { ...contexto, details: { id } });
};
