/**
 * Service das tarefas georreferenciadas do mapa (P1.2).
 *
 * Bounded context próprio: tarefa tem ciclo de vida, histórico e anexo, e nada
 * disso pertence à geografia nem ao manejo de lote (QLT-P12-02).
 */

import {
  listLancamentos,
  createLancamento,
  updateLancamento,
  deleteLancamento,
  listHistorico,
  createHistorico,
  deleteHistorico,
  listTipos,
  listGrupos,
} from '@/apis/tarefas';
import { listPermissoes, listUsuarios } from '@/apis/session';
import { listIcones as listIconesApi } from '@/apis/mapa';
import { uploadArquivo } from '@/apis/arquivos';

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);
/**
 * @param {any[]} items
 * @returns {any[]}
 */
const ativos = (items) => items.filter((item) => item.ativo !== false);

export const listarTarefasDaEmpresa = async (empresaId, opcoes) =>
  daEmpresa(await listLancamentos(opcoes), empresaId);

/** Ícones da empresa — configuração local, diferente do ícone global do cache. */
export const listarIconesDaEmpresa = async (empresaId) => ativos(daEmpresa(await listIconesApi(), empresaId));
export const listarTiposAtivos = async (empresaId) => ativos(daEmpresa(await listTipos(), empresaId));
export const listarGruposAtivos = async (empresaId) => ativos(daEmpresa(await listGrupos(), empresaId));
export const listarTodosTipos = () => listTipos();
/** Ícones ativos de um tipo de entidade — configuração global. */
export const listarIconesPorTipo = async (tipoEntidade) =>
  (await listIconesApi()).filter((i) => i.ativo !== false && i.tipo_entidade === tipoEntidade);
export const listarTodosGrupos = () => listGrupos();
export const listarPermissoes = () => listPermissoes();
export const listarUsuarios = (opcoes) => listUsuarios(opcoes);

export const criarTarefa = (dados) => createLancamento(dados);
export const atualizarTarefa = (id, dados) => updateLancamento(id, dados);
export const excluirTarefa = (id) => deleteLancamento(id);

export const listarHistorico = (opcoes) => listHistorico(opcoes);
export const registrarHistorico = (dados) => createHistorico(dados);
export const excluirHistorico = (id) => deleteHistorico(id);

/**
 * Envia um anexo de tarefa.
 *
 * O formato do payload e o retorno são os mesmos de antes — esta slice move a
 * fronteira, não muda o fluxo de upload.
 */
export const enviarAnexo = (payload) => uploadArquivo(payload);
