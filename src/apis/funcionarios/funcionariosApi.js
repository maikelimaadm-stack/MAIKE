/** API do módulo Funcionários da fazenda (D-PROD-204). Online só; página keyset do motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './funcionarioNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'Funcionario';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {Record<string, unknown>} [filtros] */
export const listFuncionariosPage = async (filtros = {}) => {
  const contexto = ctx('listFuncionariosPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getFuncionario = async (id, empresaId) => {
  const contexto = ctx('getFuncionario');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createFuncionario = async (corpo) => {
  const contexto = ctx('createFuncionario');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateFuncionario = async (id, corpo) => {
  const contexto = ctx('updateFuncionario');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** Inativar (`ativo = false`) ou reativar (`true`). @param {string} id @param {string} empresaId @param {boolean} ativo */
export const setSituacaoFuncionario = async (id, empresaId, ativo) => {
  const contexto = ctx(ativo ? 'reativarFuncionario' : 'inativarFuncionario');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.situacao(id, empresaId, ativo === true), { ...contexto, details: { id } });
};
