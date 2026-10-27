/**
 * API do módulo Anexos (P1.3, nativo P5.5).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import {
  filterRegistrosAnexoNativos,
  createRegistroAnexoNativo,
  deleteRegistroAnexoNativo,
} from '@/apis/registros-anexo';

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
  void ordenacao;
  return comoLista(await runProviderCall(() => filterRegistrosAnexoNativos(criterio), contexto));
};

export const createAnexo = async (dados) => {
  const contexto = ctx('createAnexo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => createRegistroAnexoNativo(dados), contexto);
};

export const deleteAnexo = async (id) => {
  const contexto = ctx('deleteAnexo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => deleteRegistroAnexoNativo(id), contexto);
};
