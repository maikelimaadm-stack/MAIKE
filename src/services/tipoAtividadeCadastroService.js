/**
 * Service do cadastro de tipos de atividade (D-PROD-182; padrões e flags,
 * D-PROD-196).
 *
 * Espelha o cadastro de tipos de tarefa, sem as flags legadas e sem
 * sincronização de referências: nenhum outro registro guarda cópia do nome de
 * um TipoAtividade. Os grupos vêm do mesmo cadastro de GrupoAtividade.
 *
 * D-PROD-196: o tipo guarda os padrões que a atividade herda e as 8 flags de
 * como ela funciona. Os centros padrão são escolhidos entre os ATIVOS da
 * fazenda selecionada, pela rota própria do tipo (quem cria ou edita tipo não
 * depende das telas de centros); a unidade de produção vem do cadastro de
 * Unidades de Medida (`GET /unidades-medida`, a mesma API daquela tela).
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
  listOpcoesTipoAtividade,
} from '@/apis/atividades';
import { listUnidades } from '@/apis/unidades-medida';
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
 * Centros ATIVOS da fazenda para o centro de custo padrão (`centros-custo`) ou
 * o centro de resultado padrão (`centros-resultado`): `[{ id, numero, nome }]`.
 * @param {'centros-custo'|'centros-resultado'} recurso
 * @param {string} empresaId
 */
export const listarCentrosDaFazenda = async (recurso, empresaId) =>
  (await listOpcoesTipoAtividade(recurso, empresaId)).itens;

/** Unidades de medida (ativas e inativas) para a unidade de produção. */
export const listarUnidadesDeMedida = () => listUnidades();

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
