/** API do módulo Atividades — cadastro de tipos de atividade (D-PROD-181). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { tipoAtividadePort } from './tipoAtividadePort.js';

const RESOURCE = 'TipoAtividade';
/** @param {unknown} valor */
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
/** @param {unknown} valor */
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {unknown} registros */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listTiposAtividade = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => tipoAtividadePort.list(), ctx('listTiposAtividade')));

/** @param {string} id */
export const getTipoAtividade = async (id) => {
  const contexto = ctx('getTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoAtividadePort.get(id), { ...contexto, details: { id } });
};

/** @param {Record<string, unknown>} dados */
export const createTipoAtividade = async (dados) => {
  const contexto = ctx('createTipoAtividade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoAtividadePort.create(dados), contexto);
};

/** @param {string} id @param {Record<string, unknown>} dados */
export const updateTipoAtividade = async (id, dados) => {
  const contexto = ctx('updateTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoAtividadePort.update(id, dados), { ...contexto, details: { id } });
};

/** @param {string} id */
export const deleteTipoAtividade = async (id) => {
  const contexto = ctx('deleteTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoAtividadePort.delete(id), { ...contexto, details: { id } });
};
