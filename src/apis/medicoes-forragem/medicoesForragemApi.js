/** API da Medição de Forragem (D-PROD-219). Lista do tenant (o cache do mapa filtra a fazenda); criação também offline. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { medicaoForragemPort, descansoDosPastosNativo } from './medicaoForragemNativePort.js';

const RESOURCE = 'MedicaoForragem';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @returns {Promise<object[]>} */
export const listMedicoesForragem = async () => {
  const lista = await runProviderCall(() => medicaoForragemPort.list(), ctx('listMedicoesForragem'));
  return Array.isArray(lista) ? lista : [];
};

/** @param {Record<string, unknown>} corpo */
export const createMedicaoForragem = async (corpo) => {
  const contexto = ctx('createMedicaoForragem');
  assertArgument(Boolean(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.area_id), 'area_id', contexto);
  return runProviderCall(() => medicaoForragemPort.create(corpo), contexto);
};

/** @param {string} id */
export const deleteMedicaoForragem = async (id) => {
  const contexto = ctx('deleteMedicaoForragem');
  assertArgument(isId(id), 'id', contexto);
  await runProviderCall(() => medicaoForragemPort.delete(id), { ...contexto, details: { id } });
};

/**
 * D-PROD-223 — ocupação e última saída de lote por pasto da fazenda
 * (`{ area_id, ocupada, ultima_saida }`), para o farol estimado pelos dias de descanso.
 * @param {string} empresaId
 * @returns {Promise<Array<{area_id: string, ocupada: boolean, ultima_saida: string|null}>>}
 */
export const listDescansoPastos = async (empresaId) => {
  const contexto = ctx('listDescansoPastos');
  assertArgument(isId(empresaId), 'empresaId', contexto);
  const lista = await runProviderCall(() => descansoDosPastosNativo(empresaId), { ...contexto, details: { empresa_id: empresaId } });
  return Array.isArray(lista) ? lista : [];
};
