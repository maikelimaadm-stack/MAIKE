/** API das consultas de Estoque (D-PROD-255). Somente leitura, só online. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './estoqueConsultaNativePort.js';

const RESOURCE = 'Estoque';
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

/** @param {unknown} bruto */
const normalizarOpcoes = (bruto) => {
  const o = isObjeto(bruto) ? bruto : {};
  return {
    itens: Array.isArray(o.itens) ? o.itens.filter(isObjeto) : [],
    has_more: o.has_more === true,
    next_cursor: typeof o.next_cursor === 'string' ? o.next_cursor : null,
  };
};

/**
 * D-PROD-282: lotes disponíveis (FEFO) de um produto num depósito.
 * @param {{ empresa_id: string, produto_id: string, local_estoque_id: string }} filtros
 */
export const listLotesDisponiveis = async (filtros) => {
  const contexto = ctx('listLotesDisponiveis');
  assertArgument(isId(filtros?.empresa_id), 'empresa_id', contexto);
  const o = await runProviderCall(() => operacoesNativas.lotesDisponiveis(filtros), contexto);
  const b = isObjeto(o) ? o : {};
  return { ...b, lotes: Array.isArray(b.lotes) ? b.lotes.filter(isObjeto) : [] };
};

/** @param {Record<string, unknown>} filtros */
export const listSaldoEstoque = async (filtros = {}) => {
  const contexto = ctx('listSaldoEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarPagina(await runProviderCall(() => operacoesNativas.saldo(filtros), contexto), Number(filtros.limit) || 100);
};

/** @param {Record<string, unknown>} filtros */
export const listMovimentosEstoque = async (filtros = {}) => {
  const contexto = ctx('listMovimentosEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarPagina(await runProviderCall(() => operacoesNativas.movimentos(filtros), contexto), Number(filtros.limit) || 100);
};

/** @param {string} id @param {string} empresaId */
export const getMovimentoEstoque = async (id, empresaId) => {
  const contexto = ctx('getMovimentoEstoque');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.movimento(id, empresaId), contexto);
};

/** D-PROD-273: o que a exclusão do movimento recalcularia (nada é gravado). @param {string} id @param {string} empresaId */
export const getPreviaExclusaoMovimento = async (id, empresaId) => {
  const contexto = ctx('getPreviaExclusaoMovimento');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.previaExclusao(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} filtros */
export const listOpcoesProdutosEstoque = async (filtros = {}) => {
  const contexto = ctx('listOpcoesProdutosEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarOpcoes(await runProviderCall(() => operacoesNativas.opcoesProdutos(filtros), contexto));
};

/** @param {Record<string, unknown>} [filtros] */
export const listOpcoesLocaisEstoque = async (filtros = {}) =>
  normalizarOpcoes(await runProviderCall(() => operacoesNativas.opcoesLocais(filtros), ctx('listOpcoesLocaisEstoque')));
