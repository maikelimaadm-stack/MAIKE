/** Superfície pública do módulo Estoque. */

export {
  listLocais,
  createLocal,
  updateLocal,
  deleteLocal,
  listLotesNota,
  filterLotesNota,
  updateLoteNota,
  listMovimentacoes,
  listTodasMovimentacoes,
  updateMovimentacao,
  listProdutos,
  filterProdutos,
  MOVIMENTACAO_ESTOQUE_DEFAULT_ORDER,
  MOVIMENTACAO_ESTOQUE_DEFAULT_LIMIT,
} from './estoqueApi.js';
