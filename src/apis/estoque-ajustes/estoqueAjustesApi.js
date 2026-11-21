/** API dos Ajustes de inventário do Estoque (D-PROD-271). Só online. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './estoqueAjustesNativePort.js';

const RESOURCE = 'AjusteEstoque';
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** @param {unknown} bruto @param {number} limite */
const normalizarPagina = (bruto, limite) => {
  const o = isObjeto(bruto) ? bruto : {};
  return {
    items: Array.isArray(o.items) ? o.items.filter(isObjeto) : [],
    next_cursor: typeof o.next_cursor === 'string' ? o.next_cursor : null,
    has_more: o.has_more === true,
    total: Number.isFinite(o.total) ? Number(o.total) : 0,
    limit: Number.isFinite(o.limit) ? Number(o.limit) : limite,
  };
};

/** @param {Record<string, unknown>} filtros */
export const listAjustesEstoque = async (filtros = {}) => {
  const contexto = ctx('listAjustesEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarPagina(await runProviderCall(() => operacoesNativas.listar(filtros), contexto), Number(filtros.limit) || 100);
};

/** @param {string} id @param {string} empresaId */
export const getAjusteEstoque = async (id, empresaId) => {
  const contexto = ctx('getAjusteEstoque');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.detalhar(id, empresaId), contexto);
};

/**
 * Saldo atual e custo médio de um produto num depósito. @param {{ empresa_id: string, produto_id: string, local_estoque_id: string }} filtros
 * @returns {Promise<{ produto_id: string, local_estoque_id: string, unidade_estoque: 'KG'|'L', saldo: string, custo_medio: string|null }>}
 */
export const getSaldoAjusteEstoque = async (filtros) => {
  const contexto = ctx('getSaldoAjusteEstoque');
  assertArgument(isId(filtros?.empresa_id) && isId(filtros?.produto_id) && isId(filtros?.local_estoque_id), 'produto_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.saldo(filtros), contexto);
  const o = isObjeto(bruto) ? bruto : {};
  return {
    produto_id: String(o.produto_id ?? filtros.produto_id),
    local_estoque_id: String(o.local_estoque_id ?? filtros.local_estoque_id),
    unidade_estoque: o.unidade_estoque === 'L' ? 'L' : 'KG',
    saldo: typeof o.saldo === 'string' ? o.saldo : '0',
    custo_medio: typeof o.custo_medio === 'string' ? o.custo_medio : null,
  };
};

/** @param {Record<string, unknown>} corpo */
export const createAjusteEstoque = async (corpo) => {
  const contexto = ctx('createAjusteEstoque');
  assertArgument(isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.criar(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateAjusteEstoque = async (id, corpo) => {
  const contexto = ctx('updateAjusteEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.editar(id, corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const deleteAjusteEstoque = async (id, corpo) => {
  const contexto = ctx('deleteAjusteEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.excluir(id, corpo), contexto);
};
