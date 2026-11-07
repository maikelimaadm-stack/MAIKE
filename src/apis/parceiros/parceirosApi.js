/** API do módulo Parceiros (D-PROD-145). Online só; página keyset do motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './parceiroNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'Parceiro';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {Record<string, unknown>} [filtros] */
export const listParceirosPage = async (filtros = {}) => {
  const contexto = ctx('listParceirosPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getParceiro = async (id, empresaId) => {
  const contexto = ctx('getParceiro');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createParceiro = async (corpo) => {
  const contexto = ctx('createParceiro');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateParceiro = async (id, corpo) => {
  const contexto = ctx('updateParceiro');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};
