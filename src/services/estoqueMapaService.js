/**
 * Service do estoque consumido pelos pontos do mapa (P1.2).
 *
 * Depósitos, cochos e transferência entre eles. Separado da geografia porque o
 * domínio é outro: aqui se fala de saldo, nota e movimentação.
 */

import {
  listLocais,
  createLocal,
  updateLocal,
  listLotesNota,
  filterLotesNota,
  updateLoteNota,
  listMovimentacoes,
  listTodasMovimentacoes,
  updateMovimentacao,
  listProdutos,
  filterProdutos,
} from '@/apis/estoque';

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

export const listarLocaisDaEmpresa = async (empresaId) => daEmpresa(await listLocais(), empresaId);
export const listarLocaisAtivos = async (empresaId) => ativos(await listarLocaisDaEmpresa(empresaId));
export const criarLocal = (dados) => createLocal(dados);
export const atualizarLocal = (id, dados) => updateLocal(id, dados);

export const listarLotesNotaDaEmpresa = async (empresaId) => daEmpresa(await listLotesNota(), empresaId);
export const listarTodosLotesNota = () => listLotesNota();
export const buscarLotesNotaPorCriterio = (criterio) => filterLotesNota(criterio);
export const atualizarLoteNota = (id, dados) => updateLoteNota(id, dados);

export const listarMovimentacoesDaEmpresa = async (empresaId) =>
  daEmpresa(await listTodasMovimentacoes(), empresaId);
export const listarTodasMovimentacoes = () => listTodasMovimentacoes();
export const listarTodosLocais = () => listLocais();
/** Movimentações recentes com o mesmo teto de 500 do legado. */
export const listarMovimentacoesRecentes = () => listMovimentacoes({ limit: 500 });
export const atualizarMovimentacao = (id, dados) => updateMovimentacao(id, dados);

export const listarProdutosDaEmpresa = async (empresaId) => daEmpresa(await listProdutos(), empresaId);
export const listarProdutosAtivos = async (empresaId) => ativos(await listarProdutosDaEmpresa(empresaId));
export const listarTodosProdutos = () => listProdutos();
export const buscarProdutosPorCriterio = (criterio) => filterProdutos(criterio);
