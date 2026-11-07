/** API do módulo Centros de Custo (D-PROD-145). Online só; página keyset do motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './centroCustoNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'CentroCusto';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });
/** @param {unknown} r @returns {object[]} */
const itensDe = (r) => (isObjeto(r) && Array.isArray(r.itens) ? /** @type {object[]} */ (r.itens) : []);

/** @param {Record<string, unknown>} [filtros] */
export const listCentrosCustoPage = async (filtros = {}) => {
  const contexto = ctx('listCentrosCustoPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getCentroCusto = async (id, empresaId) => {
  const contexto = ctx('getCentroCusto');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createCentroCusto = async (corpo) => {
  const contexto = ctx('createCentroCusto');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateCentroCusto = async (id, corpo) => {
  const contexto = ctx('updateCentroCusto');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} empresaId */
export const listOpcoesPaiCentroCusto = async (empresaId) => {
  const contexto = ctx('listOpcoesPaiCentroCusto');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return itensDe(await runProviderCall(() => operacoesNativas.opcoesPai(empresaId), contexto));
};

/** @param {string} empresaId */
export const listOpcoesCentrosResultadoParaVinculo = async (empresaId) => {
  const contexto = ctx('listOpcoesVinculoCentroCusto');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return itensDe(await runProviderCall(() => operacoesNativas.opcoesCentrosResultado(empresaId), contexto));
};

/** @param {string} id @param {string} empresaId */
export const listCentrosResultadoDoCentroCusto = async (id, empresaId) => {
  const contexto = ctx('listVinculosCentroCusto');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return itensDe(await runProviderCall(() => operacoesNativas.vinculos(id, empresaId), contexto));
};

/** @param {string} id @param {string} empresaId @param {string[]} centroResultadoIds */
export const definirCentrosResultadoDoCentroCusto = async (id, empresaId, centroResultadoIds) => {
  const contexto = ctx('definirVinculosCentroCusto');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  assertArgument(Array.isArray(centroResultadoIds) && centroResultadoIds.every(isId), 'centro_resultado_ids', contexto);
  return runProviderCall(
    () => operacoesNativas.definirVinculos(id, { empresa_id: empresaId, centro_resultado_ids: [...new Set(centroResultadoIds)] }),
    { ...contexto, details: { id } },
  );
};
