/**
 * Service do cadastro de tipos de atividade (D-PROD-182).
 *
 * Espelha o cadastro de tipos de tarefa, sem as flags legadas e sem
 * sincronização de referências: nenhum outro registro guarda cópia do nome de
 * um TipoAtividade. Os grupos vêm do mesmo cadastro de GrupoAtividade.
 *
 * A exclusão devolve **resultado parcial explícito** (o que saiu, o que ficou
 * e com qual código), como em `tarefaCadastroService`. Não há guarda de
 * vínculo antes do `DELETE`: o tipo usado num apontamento de atividade é
 * barrado no SERVIDOR pela FK RESTRICT (409 `TIPO_ATIVIDADE_DELETE_BLOCKED`,
 * D-PROD-190) e volta aqui em `bloqueados`, com o código.
 */

import {
  listTiposAtividade,
  createTipoAtividade,
  updateTipoAtividade,
  deleteTipoAtividade,
} from '@/apis/atividades';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

export { listarGruposSimples } from './tarefaCadastroService';

export const listarTiposAtividade = () => listTiposAtividade({ order: '-updated_date' });

/** @param {Record<string, unknown>} dados */
export const criarTipoAtividade = (dados) => createTipoAtividade(dados);

/**
 * @param {{ id: string, dados: Record<string, unknown>, oldData?: object }} p
 */
export const atualizarTipoAtividade = ({ id, dados }) => updateTipoAtividade(id, dados);

/**
 * @param {string | string[]} ids
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string }[] }>}
 */
export const excluirTiposAtividade = async (ids) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string }[]} */
  const bloqueados = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteTipoAtividade(id);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({
        id,
        code: /** @type {{ code?: string }} */ (erro)?.code ?? API_ERROR_CODES.OPERATION_FAILED,
      });
    }
  }

  return { excluidos, bloqueados };
};
