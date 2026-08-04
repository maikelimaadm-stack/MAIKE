/**
 * API do módulo Anexos (P1.3, D-PROD-18).
 *
 * `RegistroAnexo` é genérica no provider — tem `entity_name` livre. A superfície
 * pública **não** é: hoje o único consumidor migrado é o Lote, e abrir a API
 * para qualquer entidade criaria um caminho sem dono para as slices seguintes.
 * A validação fica no service, que é quem conhece o domínio.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { anexosProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'RegistroAnexo';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const ANEXO_DEFAULT_ORDER = '-created_date';

export const filterAnexos = async (criterio, ordenacao = ANEXO_DEFAULT_ORDER) => {
  const contexto = ctx('filterAnexos');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => anexosProvider.filter(criterio, ordenacao), contexto));
};

export const createAnexo = async (dados) => {
  const contexto = ctx('createAnexo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => anexosProvider.create(dados), contexto);
};

export const deleteAnexo = async (id) => {
  const contexto = ctx('deleteAnexo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => anexosProvider.delete(id), contexto);
};
