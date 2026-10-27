/** API pública de MovimentacaoEstoque (P5.4). */
import { movimentacaoEstoquePort } from './movimentacaoEstoqueNativePort.js';

export const listMovimentacoesEstoque = (ordenacao, limite) =>
  movimentacaoEstoquePort.list(ordenacao, limite);

export const createMovimentacaoEstoque = (dados) => movimentacaoEstoquePort.create(dados);
export const updateMovimentacaoEstoque = (id, dados) => movimentacaoEstoquePort.update(id, dados);
export const deleteMovimentacaoEstoque = (id) => movimentacaoEstoquePort.delete(id);
