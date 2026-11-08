/**
 * API do módulo Naturezas Financeiras gerenciais (D-PROD-153). Online só;
 * página keyset do motor Base1; opções de pai paginadas no servidor (sem teto).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './naturezaFinanceiraNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'NaturezaFinanceira';
const TIPOS = new Set(['RECEITA', 'DESPESA']);
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {Record<string, unknown>} [filtros] */
export const listNaturezasFinanceirasPage = async (filtros = {}) => {
  const contexto = ctx('listNaturezasFinanceirasPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getNaturezaFinanceira = async (id, empresaId) => {
  const contexto = ctx('getNaturezaFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createNaturezaFinanceira = async (corpo) => {
  const contexto = ctx('createNaturezaFinanceira');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(typeof corpo.tipo === 'string' && TIPOS.has(corpo.tipo), 'tipo', contexto);
  return runProviderCall(() => operacoesNativas.create(corpo), contexto);
};

/** `tipo` nunca vai no PATCH (imutável no servidor). @param {string} id @param {Record<string, unknown>} corpo */
export const updateNaturezaFinanceira = async (id, corpo) => {
  const contexto = ctx('updateNaturezaFinanceira');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(!Object.prototype.hasOwnProperty.call(corpo, 'tipo'), 'tipo', contexto);
  return runProviderCall(() => operacoesNativas.update(id, corpo), { ...contexto, details: { id } });
};

/**
 * Uma página de opções de pai (ativas, mesmo tipo, sem a subárvore de `excluir_id`).
 * @param {{ empresa_id: string, tipo: string, q?: string, excluir_id?: string|null, limit?: number, cursor?: string|null }} filtros
 * @returns {Promise<{ itens: Array<{ id: string, numero?: number, nome: string, pai_id?: string|null, caminho?: string, nivel?: number }>, has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesPaiNaturezaFinanceira = async (filtros) => {
  const contexto = ctx('listOpcoesPaiNaturezaFinanceira');
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  assertArgument(typeof filtros.tipo === 'string' && TIPOS.has(filtros.tipo), 'tipo', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.opcoesPais(filtros), contexto));
  const itens = isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens : [];
  const proximo = isObjeto(bruto) && typeof bruto.next_cursor === 'string' && bruto.next_cursor ? bruto.next_cursor : null;
  return { itens, has_more: Boolean(isObjeto(bruto) && bruto.has_more === true && proximo), next_cursor: proximo };
};
