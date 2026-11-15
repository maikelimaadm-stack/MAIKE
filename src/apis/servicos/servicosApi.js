/** API do módulo Serviços da fazenda (D-PROD-207). Online só; página keyset do motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './servicoNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'Servico';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {Record<string, unknown>} [filtros] */
export const listServicosPage = async (filtros = {}) => {
  const contexto = ctx('listServicosPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getServico = async (id, empresaId) => {
  const contexto = ctx('getServico');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createServico = async (corpo) => {
  const contexto = ctx('createServico');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateServico = async (id, corpo) => {
  const contexto = ctx('updateServico');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/** Inativar (`ativo = false`) ou reativar (`true`). @param {string} id @param {string} empresaId @param {boolean} ativo */
export const setSituacaoServico = async (id, empresaId, ativo) => {
  const contexto = ctx(ativo ? 'reativarServico' : 'inativarServico');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.situacao(id, empresaId, ativo === true), { ...contexto, details: { id } });
};

/** @param {string} empresaId @returns {Promise<object[]>} */
export const listOpcoesCentrosCustoServico = async (empresaId) => {
  const contexto = ctx('listOpcoesCentrosCustoServico');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const r = await runProviderCall(() => operacoesNativas.opcoesCentrosCusto(empresaId), contexto);
  return isObjeto(r) && Array.isArray(r.itens) ? /** @type {object[]} */ (r.itens) : [];
};
