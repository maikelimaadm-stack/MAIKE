/**
 * Service do cadastro de Estações da fazenda (D-PROD-188), tabela CADESTACOES.
 *
 * Toda operação leva a fazenda (`empresa_id`) selecionada no topo: a lista e o
 * detalhe são por fazenda e o servidor confere que ela é do tenant. A exclusão
 * devolve **resultado parcial explícito** (o que saiu, o que ficou e com qual
 * código), como nos demais cadastros do motor Base1.
 */

import { listEstacoes, createEstacao, updateEstacao, deleteEstacao } from '@/apis/estacoes';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Tipos aceitos pelo servidor, com o rótulo exibido. */
export const TIPOS_ESTACAO = Object.freeze([
  Object.freeze({ value: 'AGUAS', label: 'ÁGUAS' }),
  Object.freeze({ value: 'TRANSICAO', label: 'TRANSIÇÃO' }),
  Object.freeze({ value: 'SECA', label: 'SECA' }),
]);

/** @param {unknown} tipo @returns {string} */
export const rotuloTipoEstacao = (tipo) => TIPOS_ESTACAO.find((t) => t.value === tipo)?.label ?? '';

/** @param {string} empresaId */
export const listarEstacoes = (empresaId) => listEstacoes(empresaId);

/** @param {Record<string, unknown>} dados @param {{ empresaId: string }} escopo */
export const criarEstacao = (dados, { empresaId }) => createEstacao({ ...dados, empresa_id: empresaId });

/**
 * @param {{ id: string, dados: Record<string, unknown>, empresaId: string }} p
 */
export const atualizarEstacao = ({ id, dados, empresaId }) => updateEstacao(id, { ...dados, empresa_id: empresaId });

/**
 * @param {string | string[]} ids
 * @param {{ empresaId: string }} escopo
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string }[] }>}
 */
export const excluirEstacoes = async (ids, { empresaId }) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string }[]} */
  const bloqueados = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteEstacao(id, empresaId);
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
