/** API da Leitura de cocho (D-PROD-205). Lista do tenant (o cache do mapa filtra a fazenda); criação também offline. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { leituraCochoPort } from './leituraCochoNativePort.js';

const RESOURCE = 'LeituraCocho';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @returns {Promise<object[]>} */
export const listLeiturasCocho = async () => {
  const lista = await runProviderCall(() => leituraCochoPort.list(), ctx('listLeiturasCocho'));
  return Array.isArray(lista) ? lista : [];
};

/** @param {Record<string, unknown>} corpo */
export const createLeituraCocho = async (corpo) => {
  const contexto = ctx('createLeituraCocho');
  assertArgument(Boolean(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.ponto_suplementacao_id), 'ponto_suplementacao_id', contexto);
  return runProviderCall(() => leituraCochoPort.create(corpo), contexto);
};

/** @param {string} id */
export const deleteLeituraCocho = async (id) => {
  const contexto = ctx('deleteLeituraCocho');
  assertArgument(isId(id), 'id', contexto);
  await runProviderCall(() => leituraCochoPort.delete(id), { ...contexto, details: { id } });
};
