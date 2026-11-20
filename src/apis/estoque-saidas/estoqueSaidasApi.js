/** API das Saídas do Estoque (D-PROD-263). Só online. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './estoqueSaidasNativePort.js';

const RESOURCE = 'SaidaEstoque';
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
export const listSaidasEstoque = async (filtros = {}) => {
  const contexto = ctx('listSaidasEstoque');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  return normalizarPagina(await runProviderCall(() => operacoesNativas.listar(filtros), contexto), Number(filtros.limit) || 100);
};

/** @param {string} id @param {string} empresaId */
export const getSaidaEstoque = async (id, empresaId) => {
  const contexto = ctx('getSaidaEstoque');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.detalhar(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createSaidaEstoque = async (corpo) => {
  const contexto = ctx('createSaidaEstoque');
  assertArgument(isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.criar(corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const updateSaidaEstoque = async (id, corpo) => {
  const contexto = ctx('updateSaidaEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.editar(id, corpo), contexto);
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const deleteSaidaEstoque = async (id, corpo) => {
  const contexto = ctx('deleteSaidaEstoque');
  assertArgument(isId(id) && isId(corpo?.empresa_id) && isId(corpo?.operation_id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.excluir(id, corpo), contexto);
};

/** Motivos de saída do cliente (os padrões nascem na 1ª leitura). @param {{ ativos?: boolean }} [filtros] */
export const listMotivosSaida = async (filtros = {}) => {
  const bruto = await runProviderCall(() => operacoesNativas.listarMotivos(filtros.ativos ? { ativos: 'true' } : {}), ctx('listMotivosSaida'));
  const o = isObjeto(bruto) ? bruto : {};
  return Array.isArray(o.items) ? o.items.filter(isObjeto) : [];
};

/** @param {{ nome: string }} corpo */
export const createMotivoSaida = async (corpo) => runProviderCall(() => operacoesNativas.criarMotivo(corpo), ctx('createMotivoSaida'));

/** @param {string} id @param {{ nome?: string, ativo?: boolean }} corpo */
export const updateMotivoSaida = async (id, corpo) => {
  const contexto = ctx('updateMotivoSaida');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.editarMotivo(id, corpo), contexto);
};
