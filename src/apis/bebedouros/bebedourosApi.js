/**
 * API do módulo Bebedouros (P1.3, D-PROD-18).
 *
 * Substitui `src/repositories/bebedouroRepository.js`, que falava direto com o
 * SDK. O cadastro (`Bebedouro`) já existia no registry para leitura do mapa; a
 * escrita e os agregados de histórico, sanidade e alerta entram aqui.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { bebedourosProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Bebedouro';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {any} registros @returns {any[]} */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** Ordenações preservadas do repositório removido. */
export const BEBEDOURO_DEFAULT_ORDER = '-updated_date';
export const HISTORICO_DEFAULT_ORDER = '-data_lancamento';
export const SANIDADE_DEFAULT_ORDER = '-data_avaliacao';
export const ALERTA_DEFAULT_ORDER = '-data_alerta';

export const listBebedouros = async (ordenacao = BEBEDOURO_DEFAULT_ORDER) =>
  comoLista(await runProviderCall(() => bebedourosProvider.listBebedouros(ordenacao), ctx('listBebedouros')));

export const createBebedouro = async (dados) => {
  const contexto = ctx('createBebedouro');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => bebedourosProvider.createBebedouro(dados), contexto);
};

export const updateBebedouro = async (id, dados) => {
  const contexto = ctx('updateBebedouro');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => bebedourosProvider.updateBebedouro(id, dados), contexto);
};

export const listHistorico = async (ordenacao = HISTORICO_DEFAULT_ORDER) =>
  comoLista(await runProviderCall(() => bebedourosProvider.listHistorico(ordenacao), ctx('listHistorico')));

export const createHistorico = async (dados) => {
  const contexto = ctx('createHistorico');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => bebedourosProvider.createHistorico(dados), contexto);
};

export const deleteHistorico = async (id) => {
  const contexto = ctx('deleteHistorico');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => bebedourosProvider.deleteHistorico(id), contexto);
};

export const listSanidade = async (ordenacao = SANIDADE_DEFAULT_ORDER) =>
  comoLista(await runProviderCall(() => bebedourosProvider.listSanidade(ordenacao), ctx('listSanidade')));

export const createSanidade = async (dados) => {
  const contexto = ctx('createSanidade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => bebedourosProvider.createSanidade(dados), contexto);
};

export const listAlertas = async (ordenacao = ALERTA_DEFAULT_ORDER) =>
  comoLista(await runProviderCall(() => bebedourosProvider.listAlertas(ordenacao), ctx('listAlertas')));
