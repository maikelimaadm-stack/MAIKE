/** API do módulo Formulações de suplemento da fazenda (D-PROD-202). Online só; lista completa por fazenda. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './formulacaoNativePort.js';

const RESOURCE = 'Formulacao';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {string} empresaId @returns {Promise<object[]>} */
export const listFormulacoes = async (empresaId) => {
  const contexto = ctx('listFormulacoes');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const lista = await runProviderCall(() => operacoesNativas.list(empresaId), contexto);
  return Array.isArray(lista) ? lista : [];
};

/** Formulações ATIVAS da fazenda para o lançamento de suplementação. @param {string} empresaId @returns {Promise<object[]>} */
export const listFormulacoesOpcoesLancamento = async (empresaId) => {
  const contexto = ctx('listFormulacoesOpcoesLancamento');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const lista = await runProviderCall(() => operacoesNativas.opcoesLancamento(empresaId), contexto);
  return Array.isArray(lista) ? lista : [];
};

/** @param {string} id @param {string} empresaId */
export const getFormulacao = async (id, empresaId) => {
  const contexto = ctx('getFormulacao');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createFormulacao = async (corpo) => {
  const contexto = ctx('createFormulacao');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateFormulacao = async (id, corpo) => {
  const contexto = ctx('updateFormulacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {string} empresaId */
export const deleteFormulacao = async (id, empresaId) => {
  const contexto = ctx('deleteFormulacao');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  await runProviderCall(() => operacoesNativas.remove(id, empresaId), { ...contexto, details: { id } });
};
