/** API do módulo Tarefas georreferenciadas do mapa (P1.2). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { referenciasProvider } from '../_providers/base44Provider.js';
import { grupoAtividadePort } from './grupoAtividadeNativePort.js';
import { tipoTarefaPort } from './tipoTarefaNativePort.js';
import { lancamentoTarefaPort } from './lancamentoTarefaNativePort.js';
import { historicoLancamentoTarefaPort } from './historicoLancamentoTarefaNativePort.js';

const RESOURCE = 'Tarefa';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const HISTORICO_DEFAULT_ORDER = '-created_date';
export const HISTORICO_DEFAULT_LIMIT = 500;

export const listLancamentos = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => lancamentoTarefaPort.list(), ctx('listLancamentos')));

export const createLancamento = async (dados) => {
  const contexto = ctx('createLancamento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lancamentoTarefaPort.create(dados), contexto);
};

export const updateLancamento = async (id, dados) => {
  const contexto = ctx('updateLancamento');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lancamentoTarefaPort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteLancamento = async (id) => {
  const contexto = ctx('deleteLancamento');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => lancamentoTarefaPort.delete(id), { ...contexto, details: { id } });
};

export const listHistorico = async (opcoes = {}) => {
  const contexto = ctx('listHistorico');
  const limite = opcoes.limit ?? HISTORICO_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => historicoLancamentoTarefaPort.list(limite), contexto));
};

export const createHistorico = async (dados) => {
  const contexto = ctx('createHistorico');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => historicoLancamentoTarefaPort.create(dados), contexto);
};

export const deleteHistorico = async (id) => {
  const contexto = ctx('deleteHistorico');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => historicoLancamentoTarefaPort.delete(id), { ...contexto, details: { id } });
};

export const listTipos = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => tipoTarefaPort.list(), ctx('listTipos')));

export const listGrupos = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => grupoAtividadePort.list(), ctx('listGrupos')));

// ── Cadastro de grupos e tipos (P1.4) ─────────────────────────────────────

export const createGrupo = async (dados) => {
  const contexto = ctx('createGrupo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => grupoAtividadePort.create(dados), contexto);
};

export const updateGrupo = async (id, dados) => {
  const contexto = ctx('updateGrupo');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => grupoAtividadePort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteGrupo = async (id) => {
  const contexto = ctx('deleteGrupo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => grupoAtividadePort.delete(id), { ...contexto, details: { id } });
};

export const createTipo = async (dados) => {
  const contexto = ctx('createTipo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoTarefaPort.create(dados), contexto);
};

export const updateTipo = async (id, dados) => {
  const contexto = ctx('updateTipo');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoTarefaPort.update(id, dados), { ...contexto, details: { id } });
};

export const deleteTipo = async (id) => {
  const contexto = ctx('deleteTipo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoTarefaPort.delete(id), { ...contexto, details: { id } });
};

/**
 * Sincroniza referências denormalizadas após renomear um cadastro de tarefa.
 *
 * O nome da entidade vem de um catálogo fechado — o chamador não escreve nome
 * de entidade nem de function.
 */
const ENTIDADES_SINCRONIZAVEIS = Object.freeze({
  GrupoAtividade: 'GrupoAtividade',
  TipoTarefa: 'TipoTarefa',
});

export const sincronizarReferenciasTarefa = async ({ entidade, data, oldData }) => {
  const contexto = ctx('sincronizarReferenciasTarefa');
  const nome = ENTIDADES_SINCRONIZAVEIS[entidade];
  assertArgument(Boolean(nome), 'entidade', contexto);
  assertArgument(isObjeto(data), 'data', contexto);
  return runProviderCall(
    () =>
      referenciasProvider.sincronizar({
        event: { type: 'update', entity_name: nome },
        data,
        old_data: oldData ?? null,
      }),
    contexto
  );
};
