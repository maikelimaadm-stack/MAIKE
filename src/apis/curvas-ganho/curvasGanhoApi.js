/** API do módulo Curvas de Ganho de Peso da fazenda (D-PROD-189). Online só; lista completa por fazenda. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './curvaGanhoNativePort.js';

const RESOURCE = 'CurvaGanho';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {string} empresaId @returns {Promise<object[]>} */
export const listCurvasGanho = async (empresaId) => {
  const contexto = ctx('listCurvasGanho');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const lista = await runProviderCall(() => operacoesNativas.list(empresaId), contexto);
  return Array.isArray(lista) ? lista : [];
};

/** @param {string} id @param {string} empresaId */
export const getCurvaGanho = async (id, empresaId) => {
  const contexto = ctx('getCurvaGanho');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createCurvaGanho = async (corpo) => {
  const contexto = ctx('createCurvaGanho');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateCurvaGanho = async (id, corpo) => {
  const contexto = ctx('updateCurvaGanho');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {string} empresaId */
export const deleteCurvaGanho = async (id, empresaId) => {
  const contexto = ctx('deleteCurvaGanho');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  await runProviderCall(() => operacoesNativas.remove(id, empresaId), { ...contexto, details: { id } });
};
