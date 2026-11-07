/** API do módulo Centros de Resultado (D-PROD-145). Online só; página keyset do motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './centroResultadoNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'CentroResultado';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });
/** @param {unknown} r @returns {object[]} */
const itensDe = (r) => (isObjeto(r) && Array.isArray(r.itens) ? /** @type {object[]} */ (r.itens) : []);

/** @param {Record<string, unknown>} [filtros] */
export const listCentrosResultadoPage = async (filtros = {}) => {
  const contexto = ctx('listCentrosResultadoPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getCentroResultado = async (id, empresaId) => {
  const contexto = ctx('getCentroResultado');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createCentroResultado = async (corpo) => {
  const contexto = ctx('createCentroResultado');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateCentroResultado = async (id, corpo) => {
  const contexto = ctx('updateCentroResultado');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} empresaId */
export const listOpcoesPaiCentroResultado = async (empresaId) => {
  const contexto = ctx('listOpcoesPaiCentroResultado');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return itensDe(await runProviderCall(() => operacoesNativas.opcoesPai(empresaId), contexto));
};

/** @param {string} id @param {string} empresaId */
export const listCentrosCustoDoCentroResultado = async (id, empresaId) => {
  const contexto = ctx('listVinculosCentroResultado');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return itensDe(await runProviderCall(() => operacoesNativas.vinculos(id, empresaId), contexto));
};
