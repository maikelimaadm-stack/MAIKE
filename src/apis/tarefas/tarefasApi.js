/** API do módulo Tarefas georreferenciadas do mapa (P1.2). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { tarefasProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Tarefa';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const HISTORICO_DEFAULT_ORDER = '-created_date';
export const HISTORICO_DEFAULT_LIMIT = 500;

export const listLancamentos = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => tarefasProvider.listLancamentos(opcoes.order), ctx('listLancamentos')));

export const createLancamento = async (dados) => {
  const contexto = ctx('createLancamento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tarefasProvider.createLancamento(dados), contexto);
};

export const updateLancamento = async (id, dados) => {
  const contexto = ctx('updateLancamento');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tarefasProvider.updateLancamento(id, dados), { ...contexto, details: { id } });
};

export const deleteLancamento = async (id) => {
  const contexto = ctx('deleteLancamento');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tarefasProvider.deleteLancamento(id), { ...contexto, details: { id } });
};

export const listHistorico = async (opcoes = {}) => {
  const contexto = ctx('listHistorico');
  const ordem = opcoes.order ?? HISTORICO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? HISTORICO_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => tarefasProvider.listHistorico(ordem, limite), contexto));
};

export const createHistorico = async (dados) => {
  const contexto = ctx('createHistorico');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tarefasProvider.createHistorico(dados), contexto);
};

export const deleteHistorico = async (id) => {
  const contexto = ctx('deleteHistorico');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tarefasProvider.deleteHistorico(id), { ...contexto, details: { id } });
};

export const listTipos = async () =>
  comoLista(await runProviderCall(() => tarefasProvider.listTipos(), ctx('listTipos')));

export const listGrupos = async () =>
  comoLista(await runProviderCall(() => tarefasProvider.listGrupos(), ctx('listGrupos')));
