/** API do Cadastro de Culturas (D-PROD-215). Online só; lista completa por fazenda. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './culturaNativePort.js';

const RESOURCE = 'Cultura';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {string} empresaId @returns {Promise<object[]>} */
export const listCulturas = async (empresaId) => {
  const contexto = ctx('listCulturas');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const lista = await runProviderCall(() => operacoesNativas.list(empresaId), contexto);
  return Array.isArray(lista) ? lista : [];
};

/** @param {string} id @param {string} empresaId */
export const getCultura = async (id, empresaId) => {
  const contexto = ctx('getCultura');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createCultura = async (corpo) => {
  const contexto = ctx('createCultura');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/**
 * Comando idempotente: inclui na fazenda as culturas de referência que ainda
 * não existem (pelo nome). Devolve `{ criadas, ja_existiam, culturas }`.
 * @param {string} empresaId
 * @returns {Promise<{ criadas: number, ja_existiam: number, culturas: object[] }>}
 */
export const incluirListaReferenciaCulturas = async (empresaId) => {
  const contexto = ctx('incluirListaReferenciaCulturas');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const resultado = /** @type {{ criadas: number, ja_existiam: number, culturas: object[] }} */ (
    await runProviderCall(() => operacoesNativas.listaReferencia(empresaId), contexto)
  );
  return resultado;
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateCultura = async (id, corpo) => {
  const contexto = ctx('updateCultura');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {string} empresaId */
export const deleteCultura = async (id, empresaId) => {
  const contexto = ctx('deleteCultura');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  await runProviderCall(() => operacoesNativas.remove(id, empresaId), { ...contexto, details: { id } });
};
