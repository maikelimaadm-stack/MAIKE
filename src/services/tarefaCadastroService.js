/**
 * Service de cadastro de tarefas — grupos e tipos (P1.4).
 *
 * As duas telas repetiam o mesmo laço: `ensureDeleteAllowed(base44, …)` seguido
 * de `delete`, tudo dentro de um `try { … } catch { }` vazio. Quem clicava em
 * excluir cinco grupos e via "1 grupo excluído!" não tinha como saber por que os
 * outros quatro ficaram — nem se tinham sido bloqueados ou se a rede caiu.
 *
 * Aqui a exclusão devolve **resultado parcial explícito**: o que saiu, o que
 * ficou e com qual código. A tela decide o que dizer.
 */

import {
  listGrupos,
  listTipos,
  listLancamentos,
  createGrupo,
  updateGrupo,
  deleteGrupo,
  createTipo,
  updateTipo,
  deleteTipo,
  sincronizarReferenciasTarefa,
} from '@/apis/tarefas';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';

export const listarGrupos = () => listGrupos({ order: '-updated_date' });
export const listarGruposSimples = () => listGrupos();
export const listarTipos = () => listTipos({ order: '-updated_date' });

export const criarGrupo = (dados) => createGrupo(dados);

/** Atualiza o grupo e propaga o nome para as referências denormalizadas. */
export const atualizarGrupo = async ({ id, dados, oldData }) => {
  const atualizado = await updateGrupo(id, dados);
  await sincronizarReferenciasTarefa({ entidade: 'GrupoAtividade', data: atualizado, oldData });
  return atualizado;
};

export const criarTipo = (dados) => createTipo(dados);

export const atualizarTipo = async ({ id, dados, oldData }) => {
  const atualizado = await updateTipo(id, dados);
  await sincronizarReferenciasTarefa({ entidade: 'TipoTarefa', data: atualizado, oldData });
  return atualizado;
};

/** `GrupoAtividade` depende de `TipoTarefa` e `LancamentoTarefa`. */
const carregadoresDeGrupo = {
  TipoTarefa: () => listTipos(),
  LancamentoTarefa: () => listLancamentos(),
};

/** `TipoTarefa` depende de `LancamentoTarefa`. */
const carregadoresDeTipo = {
  LancamentoTarefa: () => listLancamentos(),
};

const excluirEmLote = async ({ ids, registros, entityName, carregadores, blockedCode, operation, remover }) => {
  const excluidos = [];
  const bloqueados = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const atual = (registros || []).find((item) => item.id === id) || null;
    try {
      await assertExclusaoPermitida({
        entityName,
        id,
        currentRecord: atual,
        carregadores,
        blockedCode,
        operation,
      });
      await remover(id);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({ id, code: erro?.code ?? API_ERROR_CODES.OPERATION_FAILED });
    }
  }

  return { excluidos, bloqueados };
};

export const excluirGrupos = (ids, { grupos = [] } = {}) =>
  excluirEmLote({
    ids,
    registros: grupos,
    entityName: 'GrupoAtividade',
    carregadores: carregadoresDeGrupo,
    blockedCode: API_ERROR_CODES.GRUPO_ATIVIDADE_DELETE_BLOCKED,
    operation: 'excluirGrupos',
    remover: deleteGrupo,
  });

export const excluirTipos = (ids, { tipos = [] } = {}) =>
  excluirEmLote({
    ids,
    registros: tipos,
    entityName: 'TipoTarefa',
    carregadores: carregadoresDeTipo,
    blockedCode: API_ERROR_CODES.TIPO_TAREFA_DELETE_BLOCKED,
    operation: 'excluirTipos',
    remover: deleteTipo,
  });
