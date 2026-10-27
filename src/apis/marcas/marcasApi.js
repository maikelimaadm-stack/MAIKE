/** API do módulo Marcas — nativo desde P4.4-Marcas (D-PROD-42); página keyset via motor Base1. */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { marcaPort, operacoesNativas } from './marcaNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'Marca';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Página keyset — motor Base1 (`normalizarEnvelopePagina`).
 * Não passa pelo cache offline (página ≠ lista completa).
 * @param {Record<string, unknown>} [filtros]
 */
export const listMarcasPage = async (filtros = {}) => {
  const bruto = await runProviderCall(() => operacoesNativas.listPage(filtros), ctx('listMarcasPage'));
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
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
