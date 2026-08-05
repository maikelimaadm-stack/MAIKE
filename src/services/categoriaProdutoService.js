/**
 * Service de Categorias de produto (P1.3, D-PROD-18).
 *
 * Cadastro hierárquico: uma categoria pode ser pai de outras via
 * `categoria_pai_id`. Excluir um pai que ainda tem filhos deixaria órfãos, e a
 * página não tinha guarda nenhuma — apenas exibia o erro cru do provider.
 */

import { listCategorias, createCategoria, updateCategoria, deleteCategoria } from '@/apis/categorias';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/** @param {any[]} items @param {string} empresaId @returns {any[]} */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/**
 * Todas as categorias.
 *
 * A tela de categorias de produto é global — não filtra por empresa, e estreitar
 * o alcance aqui esconderia cadastros existentes.
 * @returns {Promise<any[]>}
 */
export const listarTodasCategorias = async () => listCategorias();

/** @returns {Promise<any[]>} */
export const listarCategoriasDaEmpresa = async (empresaId) =>
  daEmpresa(await listCategorias(), empresaId);

/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarCategoria = async (dados, { empresaId } = {}) =>
  createCategoria({ ...dados, empresa_id: empresaId ?? dados.empresa_id });

export const atualizarCategoria = async (id, dados) => updateCategoria(id, dados);

/** Ids das categorias que têm `categoria_pai_id` apontando para `id`. */
export const filhasDe = (categorias, id) =>
  (categorias || []).filter((categoria) => categoria.categoria_pai_id === id);

/**
 * Exclui uma ou mais categorias.
 *
 * **Valida tudo antes de excluir qualquer coisa.** Com N ids, checar e excluir
 * item a item deixaria metade do lote excluído quando o sexto tivesse filhos —
 * uma falha parcial silenciosa que o usuário só descobriria recarregando.
 *
 * Mesmo assim a exclusão em si não é atômica: a Base44 não oferece transação
 * multi-registro. Se um `delete` falhar depois de outros terem passado, o
 * resultado é reportado com `CATEGORIA_PARTIAL_DELETE` e a lista do que saiu e
 * do que ficou — nunca escondido (QLT-P13-05).
 *
 * @param {string[]} ids
 * @returns {Promise<{excluidas: string[]}>}
 */
export const excluirCategorias = async (ids) => {
  const contexto = { operation: 'excluirCategorias', resource: 'Categoria' };
  const alvos = [...new Set((ids || []).filter(Boolean))];
  if (!alvos.length) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { ...contexto, details: { argumento: 'ids' } });
  }

  const todas = await listCategorias();
  const restantes = todas.filter((categoria) => !alvos.includes(categoria.id));

  // Filho que também está sendo excluído não bloqueia o pai.
  const comFilhos = alvos.filter((id) => filhasDe(restantes, id).length > 0);
  if (comFilhos.length) {
    throw new ApiError(API_ERROR_CODES.CATEGORIA_HAS_CHILDREN, {
      ...contexto,
      details: { bloqueadas: comFilhos },
    });
  }

  const excluidas = [];
  for (const id of alvos) {
    try {
      await deleteCategoria(id);
      excluidas.push(id);
    } catch (erro) {
      throw new ApiError(API_ERROR_CODES.CATEGORIA_PARTIAL_DELETE, {
        ...contexto,
        cause: erro,
        details: { excluidas, restantes: alvos.filter((alvo) => !excluidas.includes(alvo)) },
      });
    }
  }

  return { excluidas };
};
