/** API das Entradas do Estoque (D-PROD-257). Só online. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './estoqueEntradasNativePort.js';

const RESOURCE = 'EntradaEstoque';
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

/** @param {Record<string, unknown>} filtros */
export const listEntradasEstoque = async (filtros = {}) => {
  const contexto = ctx('listEntradasEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarPagina(await runProviderCall(() => operacoesNativas.listar(filtros), contexto), Number(filtros.limit) || 100);
};

/** @param {string} id @param {string} empresaId */
export const getEntradaEstoque = async (id, empresaId) => {
  const contexto = ctx('getEntradaEstoque');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.detalhar(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createEntradaEstoque = async (corpo) => {
  const contexto = ctx('createEntradaEstoque');
  assertArgument(isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.criar(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateEntradaEstoque = async (id, corpo) => {
  const contexto = ctx('updateEntradaEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.editar(id, corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const deleteEntradaEstoque = async (id, corpo) => {
  const contexto = ctx('deleteEntradaEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.excluir(id, corpo), contexto);
};

/** @param {Record<string, unknown>} filtros */
export const listOpcoesProdutosEntrada = async (filtros = {}) => {
  const contexto = ctx('listOpcoesProdutosEntrada');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarOpcoes(await runProviderCall(() => operacoesNativas.opcoesProdutos(filtros), contexto));
};

/** @param {Record<string, unknown>} [filtros] */
export const listOpcoesLocaisEntrada = async (filtros = {}) =>
  normalizarOpcoes(await runProviderCall(() => operacoesNativas.opcoesLocais(filtros), ctx('listOpcoesLocaisEntrada')));
