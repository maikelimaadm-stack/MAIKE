/** API do módulo Marcas — nativo desde P4.4-Marcas (D-PROD-42); página keyset D-PROD-54. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { marcaPort, operacoesNativas } from './marcaNativePort.js';

const RESOURCE = 'Marca';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * @typedef {{
 *   items: object[],
 *   next_cursor: string|null,
 *   has_more: boolean,
 *   total: number,
 *   limit: number,
 * }} MarcasPage
 */

/**
 * Página keyset — não passa pelo cache offline (página ≠ lista completa).
 * @param {Record<string, unknown>} [filtros]
 * @returns {Promise<MarcasPage>}
 */
export const listMarcasPage = async (filtros = {}) => {
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), ctx('listMarcasPage'));
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return {
      items: [],
      next_cursor: null,
      has_more: false,
      total: 0,
      limit: Number(filtros.limit) || 100,
    };
  }
  const page = /** @type {Record<string, unknown>} */ (bruto);
  const items = Array.isArray(page.items) ? page.items : [];
  return {
    items,
    next_cursor: typeof page.next_cursor === 'string' ? page.next_cursor : null,
    has_more: Boolean(page.has_more),
    total: Number(page.total) || 0,
    limit: Number(page.limit) || items.length,
  };
};

/**
 * Compat: itens da primeira página. Preferir `listMarcasPage` na lista Base1.
 * @param {Record<string, unknown>} [filtros]
 */
export const listMarcas = async (filtros = {}) => {
  const page = await listMarcasPage({ limit: 500, ...filtros });
  return page.items;
};

export const createMarca = async (dados) => {
  const contexto = ctx('createMarca');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => marcaPort.create(dados), contexto);
};

export const updateMarca = async (id, dados) => {
  const contexto = ctx('updateMarca');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => marcaPort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteMarca = async (id) => {
  const contexto = ctx('deleteMarca');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => marcaPort.delete(id), { ...contexto, details: { id } });
};
