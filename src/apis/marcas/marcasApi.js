/** API do módulo Marcas (P1.4). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { marcasProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Marca';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listMarcas = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => marcasProvider.list(opcoes.order), ctx('listMarcas')));

export const createMarca = async (dados) => {
  const contexto = ctx('createMarca');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => marcasProvider.create(dados), contexto);
};

export const updateMarca = async (id, dados) => {
  const contexto = ctx('updateMarca');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => marcasProvider.update(id, dados), { ...contexto, details: { id } });
};

export const deleteMarca = async (id) => {
  const contexto = ctx('deleteMarca');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => marcasProvider.delete(id), { ...contexto, details: { id } });
};
